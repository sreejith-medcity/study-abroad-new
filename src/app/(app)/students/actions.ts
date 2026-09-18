"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, isAdmin, isStaff } from "@/lib/permissions";
import { adminIds, notifyUsers } from "@/server/notify";
import { getStudentForUser } from "@/server/queries";

export type FormState = { error?: string; ok?: string; fieldErrors?: Record<string, string[] | undefined> };

const CONSENT_TEXT =
  "I agree to Medcity Overseas collecting and processing my personal data, including passport and academic documents, to assess my eligibility and apply to institutions and employers on my behalf.";

const optionalText = z.string().trim().max(200).optional().transform((v) => v || null);
const optionalDate = z.string().optional().transform((v) => (v ? new Date(v) : null));
const optionalInt = z.string().optional().transform((v) => (v === undefined || v === "" ? null : Number(v))).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 100), "Enter a whole number");

const newStudent = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().regex(/^\+?[\d\s-]{8,16}$/, "Enter a valid mobile number with country code"),
  preferredCountry: optionalText,
  preferredPathway: z.enum(schema.pathway.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  assignedToId: optionalText,
  consent: z.literal("on", { message: "The student's consent is required before saving their data" }),
});

export async function createStudentAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const parsed = newStudent.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const orgId = isStaff(user) ? String(formData.get("orgId") || user.orgId) : user.orgId;
  if (d.assignedToId) {
    const assignee = await db.query.users.findFirst({ where: eq(schema.users.id, d.assignedToId) });
    if (!assignee || assignee.orgId !== orgId) return { error: "Pick a counsellor from this organisation." };
  }

  const existing = await db.query.students.findFirst({ where: and(eq(schema.students.email, d.email), eq(schema.students.orgId, orgId)) });
  if (existing) return { error: `A student with ${d.email} already exists.`, fieldErrors: { email: ["Already registered"] } };

  const [student] = await db
    .insert(schema.students)
    .values({
      orgId,
      createdById: user.id,
      assignedToId: d.assignedToId ?? (user.role === "COUNSELLOR" ? user.id : null),
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone,
      preferredCountry: d.preferredCountry,
      preferredPathway: d.preferredPathway,
      consentAt: new Date(),
      consentText: CONSENT_TEXT,
    })
    .returning();
  await audit(user.id, "student.create", "student", student.id, { consent: true });

  // Registered straight from an enquiry: close the enquiry against this student.
  const enquiryId = String(formData.get("enquiryId") || "");
  if (enquiryId) {
    const enquiry = await db.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId) });
    if (enquiry && (isStaff(user) || enquiry.orgId === user.orgId)) {
      await db
        .update(schema.enquiries)
        .set({ stage: "CONVERTED", studentId: student.id, nextFollowUpAt: null, updatedAt: new Date() })
        .where(eq(schema.enquiries.id, enquiry.id));
      await db.insert(schema.enquiryNotes).values({
        enquiryId: enquiry.id,
        authorId: user.id,
        body: `Registered as a student: ${d.firstName} ${d.lastName}.`,
        stageAfter: "CONVERTED",
      });
      await audit(user.id, "enquiry.convert", "enquiry", enquiry.id, { studentId: student.id });
    }
  }
  redirect(`/students/${student.id}/profile`);
}

export async function reassignStudentAction(formData: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  const assignedToId = String(formData.get("assignedToId") || "") || null;
  const student = await getStudentForUser(user, studentId);
  if (assignedToId) {
    const assignee = await db.query.users.findFirst({ where: eq(schema.users.id, assignedToId) });
    if (!assignee || assignee.orgId !== student.orgId) return;
  }
  await db.update(schema.students).set({ assignedToId, updatedAt: new Date() }).where(eq(schema.students.id, studentId));
  await audit(user.id, "student.reassign", "student", studentId, { from: student.assignedToId, to: assignedToId });
  if (assignedToId) await notifyUsers([assignedToId], "Student assigned to you", `${student.firstName} ${student.lastName}`, `/students/${studentId}/profile`);
  revalidatePath("/students");
}

export async function archiveStudentAction(formData: FormData) {
  const user = await requireUser(["PARTNER", ...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  const [{ n }] = await db.select({ n: count() }).from(schema.applications).where(eq(schema.applications.studentId, studentId));
  if (n > 0) {
    await db.update(schema.students).set({ archived: !student.archived }).where(eq(schema.students.id, studentId));
    await audit(user.id, student.archived ? "student.unarchive" : "student.archive", "student", studentId);
  } else {
    await db.delete(schema.students).where(eq(schema.students.id, studentId));
    await audit(user.id, "student.delete", "student", studentId);
  }
  revalidatePath("/students");
}

// ---------- Profile ----------

async function editableStudent(studentId: string) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const student = await getStudentForUser(user, studentId);
  if (student.profileLocked && !isAdmin(user)) {
    return { user, student, locked: true as const };
  }
  return { user, student, locked: false as const };
}

const personal = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(/^\+?[\d\s-]{8,16}$/, "Enter a valid mobile number"),
  dateOfBirth: optionalDate,
  gender: optionalText,
  maritalStatus: optionalText,
  nationality: z.string().trim().min(1).max(60),
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  pincode: optionalText,
  passportNumber: z.string().trim().toUpperCase().max(20).optional().transform((v) => v || null),
  passportIssue: optionalDate,
  passportExpiry: optionalDate,
  passportIssueCountry: optionalText,
  cityOfBirth: optionalText,
  backlogs: optionalInt,
  gapYears: optionalInt,
  preferredLanguage: z.enum(["en", "ml"]).default("en"),
  whatsappOptIn: z.string().optional().transform((v) => v === "on"),
});

export async function savePersonalAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, student, locked } = await editableStudent(studentId);
  if (locked) return { error: "This profile is locked because an application was submitted. Use Request edit." };
  const parsed = personal.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const data = parsed.data;
  // Counsellors see a masked passport; an unchanged masked value must not overwrite the real number.
  if (data.passportNumber?.includes("•")) data.passportNumber = student.passportNumber;
  await db.update(schema.students).set({ ...data, updatedAt: new Date() }).where(eq(schema.students.id, studentId));
  await audit(user.id, "student.profile.update", "student", studentId, { section: "personal" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: "Saved." };
}

const academic = z.object({
  level: z.enum(schema.studyLevel.enumValues),
  institution: z.string().trim().min(1, "Institution is required").max(150),
  course: optionalText,
  gradingSystem: optionalText,
  score: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (v >= 0 && v <= 100), "Score must be between 0 and 100"),
  yearCompleted: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (v > 1970 && v < 2100), "Enter a valid year"),
});

export async function addAcademicAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return { error: "Profile is locked. Use Request edit." };
  const parsed = academic.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  await db.insert(schema.academicRecords).values({ studentId, ...parsed.data });
  await audit(user.id, "student.profile.update", "student", studentId, { section: "academics" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: "Qualification added." };
}

const test = z.object({
  test: z.enum(["IELTS", "PTE", "OET", "TOEFL", "DUOLINGO", "GERMAN"]),
  overall: z.string().trim().min(1, "Score is required").max(10),
  takenOn: optionalDate,
});

export async function addTestAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return { error: "Profile is locked. Use Request edit." };
  const parsed = test.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  await db.insert(schema.testScores).values({ studentId, ...parsed.data });
  await audit(user.id, "student.profile.update", "student", studentId, { section: "tests" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: "Test score added." };
}

const work = z.object({
  employer: z.string().trim().min(1, "Employer is required").max(150),
  title: z.string().trim().min(1, "Job title is required").max(150),
  startDate: z.string().min(1, "Start date is required").transform((v) => new Date(v)),
  endDate: optionalDate,
});

export async function addWorkAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return { error: "Profile is locked. Use Request edit." };
  const parsed = work.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  await db.insert(schema.workExperience).values({ studentId, ...parsed.data });
  await audit(user.id, "student.profile.update", "student", studentId, { section: "work" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: "Work experience added." };
}

export async function deleteProfileRowAction(formData: FormData) {
  const studentId = String(formData.get("studentId"));
  const kind = String(formData.get("kind"));
  const rowId = String(formData.get("rowId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return;
  const table = kind === "academic" ? schema.academicRecords : kind === "test" ? schema.testScores : kind === "work" ? schema.workExperience : null;
  if (!table) return;
  await db.delete(table).where(and(eq(table.id, rowId), eq(table.studentId, studentId)));
  await audit(user.id, "student.profile.delete", "student", studentId, { kind, rowId });
  revalidatePath(`/students/${studentId}`, "layout");
}

export async function requestEditAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR"]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  const section = String(formData.get("section") || "profile");
  const message = String(formData.get("message") || "").trim();
  if (message.length < 5) return { error: "Say what needs to change." };
  await db.insert(schema.editRequests).values({ studentId, section, message, requestedById: user.id });
  await notifyUsers(await adminIds(), "Profile edit requested", `${student.firstName} ${student.lastName}: ${section}`, `/students/${studentId}/profile`);
  await audit(user.id, "student.edit_request", "student", studentId, { section });
  return { ok: "Edit request sent to the Medcity Overseas team." };
}

export async function toggleLockAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  await db.update(schema.students).set({ profileLocked: !student.profileLocked }).where(eq(schema.students.id, studentId));
  await db
    .update(schema.editRequests)
    .set({ status: "APPROVED" })
    .where(and(eq(schema.editRequests.studentId, studentId), eq(schema.editRequests.status, "OPEN")));
  await audit(user.id, student.profileLocked ? "student.unlock" : "student.lock", "student", studentId);
  revalidatePath(`/students/${studentId}`, "layout");
}

export async function revealPassportAction(formData: FormData) {
  const user = await requireUser(["ADMIN", "SUPER_ADMIN", "OPS_MANAGER", "DOCUMENTATION", "PARTNER", "COUNSELLOR"]);
  const studentId = String(formData.get("studentId"));
  await getStudentForUser(user, studentId);
  await audit(user.id, "passport.reveal", "student", studentId);
  redirect(`/students/${studentId}/profile?reveal=1`);
}

/** A one-time password the student changes at first sign in. */
function portalPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = randomBytes(10);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/**
 * Gives a student their own login: they see their applications, upload what is
 * missing and message their counsellor, and nothing else.
 */
export async function invitePortalAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  if (!student.email) return { error: "Add an email address to the student's profile first." };

  const existing = await db.query.users.findFirst({ where: eq(schema.users.studentId, studentId) });
  const password = portalPassword();
  const passwordHash = await hashPassword(password);

  if (existing) {
    await db
      .update(schema.users)
      .set({ passwordHash, mustChangePassword: true, active: true, passwordUpdatedAt: new Date(), email: student.email })
      .where(eq(schema.users.id, existing.id));
    await audit(user.id, "portal.reinvite", "student", studentId, { email: student.email });
  } else {
    const clash = await db.query.users.findFirst({ where: eq(schema.users.email, student.email) });
    if (clash) return { error: `${student.email} is already used by another account.` };
    await db.insert(schema.users).values({
      name: `${student.firstName} ${student.lastName}`,
      email: student.email,
      phone: student.phone,
      passwordHash,
      role: "STUDENT",
      orgId: student.orgId,
      studentId,
      mustChangePassword: true,
    });
    await audit(user.id, "portal.invite", "student", studentId, { email: student.email });
  }

  revalidatePath(`/students/${studentId}`, "layout");
  return {
    ok: `Portal access for ${student.email}. One-time password: ${password}. Shown once, and they must change it at sign in.`,
  };
}

export async function togglePortalAccessAction(formData: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  await getStudentForUser(user, studentId);
  const account = await db.query.users.findFirst({ where: eq(schema.users.studentId, studentId) });
  if (!account) return;
  await db.update(schema.users).set({ active: !account.active }).where(eq(schema.users.id, account.id));
  await audit(user.id, account.active ? "portal.disable" : "portal.enable", "student", studentId, {});
  revalidatePath(`/students/${studentId}`, "layout");
}
