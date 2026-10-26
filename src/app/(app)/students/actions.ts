"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { phoneKey } from "@/lib/phone";
import { ADMIN_ROLES, APP_ROLES, DESK_ASSIGNING_ROLES, PARTNER_ROLES, PROCESSING_ROLES, canAssignStudents, isAdmin, isStaff, STUDENT_WORK_ROLES } from "@/lib/permissions";
import { convertedStudentOwner } from "@/lib/conversion";
import { can } from "@/server/capabilities";
import { readAim } from "@/lib/aims";
import { adminIds, notifyUsers, partnerRecipients, deskRecipients } from "@/server/notify";
import { getStudentForUser } from "@/server/queries";
import { tryMintStudentId } from "@/server/medcity-id";
import { openEarningForStudent } from "@/server/agent-actions";
import { handEnquiryToDocumentation } from "@/server/enquiry-handover";
import { BACKGROUND_QUESTIONS, CONTACT_RELATIONS } from "@/lib/background";
import { ledgerCreated, updateTracked } from "@/server/record-history";
import { appendLedger } from "@/server/ledger";

import type { FormState } from "@/lib/form-state";
export type { FormState };

const CONSENT_TEXT =
  "I agree to Medcity Overseas collecting and processing my personal data, including passport and academic documents, to assess my eligibility and apply to institutions and employers on my behalf.";

const optionalText = z.string().trim().max(200).optional().transform((v) => v || null);
const optionalDate = z.string().optional().transform((v) => (v ? new Date(v) : null));
const optionalInt = z.string().optional().transform((v) => (v === undefined || v === "" ? null : Number(v))).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 100), "Enter a whole number");

const newStudent = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  // Not everybody has an email. The mobile number is what a branch always has.
  email: z.string().trim().toLowerCase().max(160).optional().transform((v) => v || null).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
  phone: z.string().trim().regex(/^\+?[\d\s-]{8,16}$/, "Enter a valid mobile number with country code"),
  preferredCountry: optionalText,
  preferredPathway: z.enum(schema.pathway.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  /** The single question the form asks; the pair behind it is read from AIMS. */
  aim: z.string().optional().transform((v) => v || ""),
  assignedToId: optionalText,
  consent: z.literal("on", { message: "The student's consent is required before saving their data" }),
});

export async function createStudentAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...APP_ROLES]);
  if (!(await can(user, "REGISTER_STUDENT"))) return { error: "You are not set up to register students. Ask an admin on the Access screen." };
  const parsed = newStudent.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const aim = readAim(d.aim);

  // A branch registers into itself. The Overseas team has to say which branch,
  // because a student sitting on the head office belongs to nobody: every screen
  // that scopes by organisation would lose them, and commission is per branch.
  let orgId = user.orgId;
  if (isStaff(user)) {
    const chosen = String(formData.get("orgId") || "");
    const branch = chosen ? await db.query.organizations.findFirst({ where: eq(schema.organizations.id, chosen) }) : null;
    if (!branch || branch.type === "HQ" || !branch.active) {
      return { error: "Choose the branch this student belongs to.", fieldErrors: { orgId: ["Pick a branch"] } };
    }
    orgId = branch.id;
  }
  if (d.assignedToId) {
    const assignee = await db.query.users.findFirst({ where: eq(schema.users.id, d.assignedToId) });
    if (!assignee || assignee.orgId !== orgId) return { error: "Pick a counsellor from this organisation." };
  }

  /**
   * Who already has it, and where they are.
   *
   * "A student with that email already exists" sent the branch hunting through
   * a list that does not show archived students, so they could not find who it
   * was and could not get past the screen. The name, the Medcity ID and the
   * fact that the file is archived are the three things that end the hunt.
   */
  const says = (who: { firstName: string; lastName: string; medcityId: string | null; archived: boolean }, what: string) =>
    `${who.firstName} ${who.lastName}${who.medcityId ? ` (${who.medcityId})` : ""} is already registered on ${what}.${
      who.archived ? " That file is archived, which is why it is not in the student list; open Archived students to bring it back." : " Open them from the student list rather than registering them twice."
    }`;

  if (d.email) {
    const existing = await db.query.students.findFirst({
      where: and(eq(schema.students.email, d.email), eq(schema.students.orgId, orgId)),
      columns: { firstName: true, lastName: true, medcityId: true, archived: true },
    });
    if (existing) return { error: says(existing, d.email), fieldErrors: { email: ["Already registered"] } };
  }
  // Without an email, the number and the name together are the student, so the
  // same pair twice in one branch is the same person being registered again.
  const digits = phoneKey(d.phone);
  if (!d.email && digits) {
    const sameNumber = await db.query.students.findFirst({
      where: and(
        eq(schema.students.orgId, orgId),
        sql`right(regexp_replace(${schema.students.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`,
        sql`lower(${schema.students.firstName}) = ${d.firstName.toLowerCase()}`,
        sql`lower(${schema.students.lastName}) = ${d.lastName.toLowerCase()}`,
      ),
      columns: { firstName: true, lastName: true, medcityId: true, archived: true },
    });
    if (sameNumber) return { error: says(sameNumber, "that number"), fieldErrors: { phone: ["Already registered"] } };
  }

  // Registered straight from an enquiry: read it now, because who the
  // student is given to depends on who the enquiry was with. A branch head
  // converting a counsellor's enquiry without choosing "Assign to" used to
  // land the student unassigned and registered by the head, which under the
  // rule that a counsellor sees only their own files meant the counsellor
  // could no longer open the student their enquiry now linked to.
  const enquiryId = String(formData.get("enquiryId") || "");
  const enquiry = enquiryId ? await db.query.enquiries.findFirst({ where: eq(schema.enquiries.id, enquiryId), with: { mergedInto: { columns: { id: true, name: true, phone: true } } } }) : null;
  // A merged enquiry is the same person as the one it was folded into, and
  // registering from it would leave that one open beside a student. Refused
  // here, whatever the form sent, saying where to go instead.
  if (enquiry && enquiry.stage === "MERGED" && (isStaff(user) || enquiry.orgId === user.orgId)) {
    return {
      error: enquiry.mergedInto
        ? `This enquiry was merged into ${enquiry.mergedInto.name}'s enquiry (${enquiry.mergedInto.phone}). Open that enquiry and register the student from there.`
        : "This enquiry was merged into another enquiry. Register the student from that one.",
    };
  }
  const enquiryOwner =
    enquiry?.assignedToId && (isStaff(user) || enquiry.orgId === user.orgId)
      ? await db.query.users.findFirst({ where: eq(schema.users.id, enquiry.assignedToId), columns: { id: true, role: true, orgId: true, active: true } })
      : null;
  const assignedToId = convertedStudentOwner(d.assignedToId, user, orgId, enquiryOwner ?? null);

  const [student] = await db
    .insert(schema.students)
    .values({
      orgId,
      createdById: user.id,
      assignedToId,
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone,
      preferredCountry: d.preferredCountry,
      // One question on the form, two columns here: the journey the file
      // follows, and the level the courses are picked at.
      preferredPathway: aim.pathway ?? d.preferredPathway,
      preferredLevel: aim.level,
      consentAt: new Date(),
      consentText: CONSENT_TEXT,
      medcityId: await tryMintStudentId(orgId),
    })
    .returning();
  await audit(user.id, "student.create", "student", student.id, { consent: true, orgId });
  await ledgerCreated(db, "student", [student], user.id, enquiryId && enquiry ? "Registered from an enquiry" : null);
  // Registered by the desk rather than by the branch: the branch is told, so the
  // file does not sit unassigned in a list nobody is watching.
  if (isStaff(user)) {
    await notifyUsers(
      await partnerRecipients(orgId),
      "A student registered for you",
      assignedToId
        ? `${d.firstName} ${d.lastName} was registered by the Overseas team.`
        : `${d.firstName} ${d.lastName} was registered by the Overseas team. Assign a counsellor when you can.`,
      `/students/${student.id}/profile`,
    );
  }
  // Whoever the student was given to, when that is not the person
  // registering: the counsellor an enquiry was with learns the file is
  // theirs, the same notice a reassignment sends.
  if (assignedToId && assignedToId !== user.id) {
    await notifyUsers([assignedToId], "Student assigned to you", `${d.firstName} ${d.lastName}`, `/students/${student.id}/profile`);
  }

  // Registered straight from an enquiry: close the enquiry against this student.
  if (enquiry) {
    if (isStaff(user) || enquiry.orgId === user.orgId) {
      await updateTracked("enquiry", enquiry.id, { stage: "CONVERTED", studentId: student.id, nextFollowUpAt: null, updatedAt: new Date() }, { by: user.id, action: "enquiry.convert" });
      // The enquiry's line on the ledger ends here, pointing at the student
      // file that carries it on.
      await appendLedger(db, [
        {
          kind: "CONVERTED",
          entity: "enquiry",
          entityId: enquiry.id,
          orgId: enquiry.orgId,
          ownerId: enquiry.assignedToId,
          detail: student.medcityId ? `Student ${student.medcityId}` : "Student registered without a Medcity ID",
          actorId: user.id,
        },
      ]);
      await db.insert(schema.enquiryNotes).values({
        enquiryId: enquiry.id,
        authorId: user.id,
        body: `Registered as a student: ${d.firstName} ${d.lastName}.`,
        stageAfter: "CONVERTED",
      });
      await audit(user.id, "enquiry.convert", "enquiry", enquiry.id, { studentId: student.id });

      // The desk used to learn a student existed when an application turned
      // up, which can be weeks later, and the document list did not exist
      // until somebody opened the tab that builds it. Registration hands the
      // file over now: the list is opened, somebody at the desk is put on it,
      // and the desk is told.
      await handEnquiryToDocumentation(student.id, user.id, `${d.firstName} ${d.lastName}`);

      // A lead a sub-agent referred keeps its referrer on the student file, and
      // the earning is opened the same day so the sub-agent can see it coming.
      // The branch owns the student; the sub-agent is who gets paid for them.
      if (enquiry.submittedByOrgId) {
        await updateTracked("student", student.id, { referredByOrgId: enquiry.submittedByOrgId }, { by: user.id, action: "student.referral" });
        await openEarningForStudent(student.id, enquiry.submittedByOrgId);
        await notifyUsers(
          await partnerRecipients(enquiry.submittedByOrgId),
          "Your referral has been registered",
          `${d.firstName} ${d.lastName} is now a Medcity student.`,
          "/referrals",
        );
      }
    }
  }
  redirect(`/students/${student.id}/profile`);
}

/**
 * Hands a student to somebody.
 *
 * A branch may only hand a file to its own people, which is the rule that has
 * always applied here. An admin may also hand it to the head office, because
 * the documentation team and the Overseas desk are where a file goes once the
 * branch has done its part, and there was no way to say so before.
 *
 * Whoever receives it must be able to work a student's file. Handing it to
 * somebody who can only read it would be handing it to a dead end.
 */
export async function reassignStudentAction(formData: FormData) {
  const user = await requireUser([...PARTNER_ROLES, ...DESK_ASSIGNING_ROLES]);
  if (!canAssignStudents(user)) return;
  const studentId = String(formData.get("studentId"));
  const assignedToId = String(formData.get("assignedToId") || "") || null;
  const student = await getStudentForUser(user, studentId);
  if (assignedToId) {
    const assignee = await db.query.users.findFirst({
      where: eq(schema.users.id, assignedToId),
      with: { org: { columns: { type: true } } },
    });
    if (!assignee || !assignee.active) return;
    if (!(STUDENT_WORK_ROLES as readonly string[]).includes(assignee.role)) return;
    const sameBranch = assignee.orgId === student.orgId;
    const headOffice = assignee.org?.type === "HQ";
    if (!sameBranch && !(headOffice && isStaff(user))) return;
  }
  await updateTracked("student", studentId, { assignedToId, updatedAt: new Date() }, { by: user.id, action: "student.reassign" });
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
    await updateTracked("student", studentId, { archived: !student.archived }, { by: user.id, action: student.archived ? "student.unarchive" : "student.archive" });
    await audit(user.id, student.archived ? "student.unarchive" : "student.archive", "student", studentId);
  } else {
    await db.transaction(async (tx) => {
      await tx.delete(schema.students).where(eq(schema.students.id, studentId));
      // The ledger keeps the file's line, closed: who held it when it went.
      await appendLedger(tx, [{ kind: "REMOVED", entity: "student", entityId: studentId, orgId: student.orgId, ownerId: student.assignedToId, actorId: user.id }]);
    });
    await audit(user.id, "student.delete", "student", studentId);
  }
  revalidatePath("/students");
}

// ---------- Profile ----------

/**
 * Who may change a student's own details.
 *
 * The branch that registered them, and the Overseas desk that works their file.
 * The desk was left out of this when it was written, which is why a
 * documentation user could open a profile, type into it, and be shown the
 * forbidden screen on save: the screen said yes and the button said no.
 */
async function editableStudent(studentId: string) {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const student = await getStudentForUser(user, studentId);
  if (student.profileLocked && !isAdmin(user)) {
    return { user, student, locked: true as const };
  }
  return { user, student, locked: false as const };
}

const personal = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().max(160).optional().transform((v) => v || null).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
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
  mailingSameAsPermanent: z.string().optional().transform((v) => v === "on"),
  mailingAddress: z.string().trim().max(400).optional().transform((v) => v || null),
  otherCitizenship: optionalText,
  livingInCountry: optionalText,
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
  if (data.mailingSameAsPermanent) data.mailingAddress = null;
  else if (!data.mailingAddress) return { fieldErrors: { mailingAddress: ["Enter the mailing address, or tick that it is the same as the permanent one"] }, error: "Check the highlighted fields." };
  // Counsellors see a masked passport; an unchanged masked value must not overwrite the real number.
  if (data.passportNumber?.includes("•")) data.passportNumber = student.passportNumber;
  await updateTracked("student", studentId, { ...data, updatedAt: new Date() }, { by: user.id, action: "student.profile" });
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

const section = z.string().trim().max(10).optional().transform((v) => v || null);
const test = z
  .object({
    test: z.enum(["IELTS", "PTE", "OET", "TOEFL", "DUOLINGO", "GERMAN", "GRE", "GMAT", "SAT", "ACT"]),
    // Optional, because a test can be booked or still to be sat. It used to be
    // required, so a student without a result was written down as a nought,
    // which every eligibility check then read as a real and terrible score.
    overall: z.string().trim().max(10).optional().transform((v) => v || null),
    state: z.enum(["TAKEN", "BOOKED", "NOT_TAKEN"]).optional().transform((v) => v ?? "TAKEN"),
    listening: section,
    reading: section,
    writing: section,
    speaking: section,
    takenOn: optionalDate,
  })
  .superRefine((t, ctx) => {
    if (t.state === "TAKEN" && !t.overall) {
      ctx.addIssue({ code: "custom", path: ["overall"], message: "Give the score, or say the test has not been taken yet" });
    }
  });

export async function addTestAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return { error: "Profile is locked. Use Request edit." };
  const parsed = test.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  // A result the student does not have yet is not a score, whatever was typed.
  const d = parsed.data;
  const waiting = d.state !== "TAKEN";
  await db.insert(schema.testScores).values({
    studentId,
    ...d,
    overall: waiting ? null : d.overall,
    listening: waiting ? null : d.listening,
    reading: waiting ? null : d.reading,
    writing: waiting ? null : d.writing,
    speaking: waiting ? null : d.speaking,
  });
  await audit(user.id, "student.profile.update", "student", studentId, { section: "tests" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: waiting ? `${d.test} recorded as not taken yet.` : "Test score added." };
}

export async function saveBackgroundAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return { error: "Profile is locked. Use Request edit." };
  const answers: Record<string, { answer: boolean; details: string | null }> = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const q of BACKGROUND_QUESTIONS) {
    const a = formData.get(`bg_${q.key}`);
    const details = String(formData.get(`bg_${q.key}_details`) ?? "").trim().slice(0, 1000) || null;
    if (a !== "yes" && a !== "no") {
      fieldErrors[`bg_${q.key}`] = ["Answer yes or no"];
      continue;
    }
    if (a === "yes" && !details) {
      fieldErrors[`bg_${q.key}_details`] = ["Give the details: the institution will ask"];
      continue;
    }
    answers[q.key] = { answer: a === "yes", details: a === "yes" ? details : null };
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Answer every question; a yes needs details." };
  await updateTracked("student", studentId, { background: answers, updatedAt: new Date() }, { by: user.id, action: "student.background" });
  await audit(user.id, "student.profile.update", "student", studentId, { section: "background" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: "Background answers saved." };
}

const contact = z.object({
  relation: z.enum(CONTACT_RELATIONS),
  name: z.string().trim().min(1, "Name is required").max(120),
  phone: z.string().trim().max(20).optional().transform((v) => v || null).refine((v) => v === null || /^\+?[\d\s-]{8,16}$/.test(v), "Enter a valid phone number"),
  email: z.string().trim().toLowerCase().max(160).optional().transform((v) => v || null).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
  emergency: z.string().optional().transform((v) => v === "on"),
});

export async function addContactAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return { error: "Profile is locked. Use Request edit." };
  const parsed = contact.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  if (!parsed.data.phone && !parsed.data.email) return { fieldErrors: { phone: ["Give a phone number or an email"] }, error: "Check the highlighted fields." };
  const [{ n }] = await db.select({ n: count() }).from(schema.studentContacts).where(eq(schema.studentContacts.studentId, studentId));
  if (n >= 6) return { error: "Six contacts at most. Remove one first." };
  await db.insert(schema.studentContacts).values({ studentId, ...parsed.data });
  await audit(user.id, "student.profile.update", "student", studentId, { section: "contacts" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: "Contact added." };
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
  const table =
    kind === "academic" ? schema.academicRecords
    : kind === "test" ? schema.testScores
    : kind === "work" ? schema.workExperience
    : kind === "contact" ? schema.studentContacts
    : null;
  if (!table) return;
  await db.delete(table).where(and(eq(table.id, rowId), eq(table.studentId, studentId)));
  await audit(user.id, "student.profile.delete", "student", studentId, { kind, rowId });
  revalidatePath(`/students/${studentId}`, "layout");
}

export async function requestEditAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...PARTNER_ROLES]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  const section = String(formData.get("section") || "profile");
  const message = String(formData.get("message") || "").trim();
  if (message.length < 5) return { error: "Say what needs to change." };
  await db.insert(schema.editRequests).values({ studentId, section, message, requestedById: user.id });
  await notifyUsers(await deskRecipients(student.orgId), "Profile edit requested", `${student.firstName} ${student.lastName}: ${section}`, `/students/${studentId}/profile`);
  await audit(user.id, "student.edit_request", "student", studentId, { section });
  return { ok: "Edit request sent to the Medcity Overseas team." };
}

export async function toggleLockAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  await updateTracked("student", studentId, { profileLocked: !student.profileLocked }, { by: user.id, action: student.profileLocked ? "student.unlock" : "student.lock" });
  await db
    .update(schema.editRequests)
    .set({ status: "APPROVED" })
    .where(and(eq(schema.editRequests.studentId, studentId), eq(schema.editRequests.status, "OPEN")));
  await audit(user.id, student.profileLocked ? "student.unlock" : "student.lock", "student", studentId);
  revalidatePath(`/students/${studentId}`, "layout");
}

export async function revealPassportAction(formData: FormData) {
  const user = await requireUser(["ADMIN", "SUPER_ADMIN", "OPS_MANAGER", "DOCUMENTATION", ...PARTNER_ROLES]);
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
  // The desk is who asks a student for documents through the portal, so the desk
  // is who needs to be able to let them into it.
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  if (!student.email) return { error: "Add an email address to the student's profile first." };

  // A parent's sign-in carries the same student id, so the role has to be in
  // the test: without it a family account is mistaken for the student's own.
  const existing = await db.query.users.findFirst({ where: and(eq(schema.users.studentId, studentId), eq(schema.users.role, "STUDENT")) });
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
    keep: true,
    ok: `Portal access for ${student.email}. One-time password: ${password}. They must change it at sign in.`,
  };
}

export async function togglePortalAccessAction(formData: FormData) {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(formData.get("studentId"));
  await getStudentForUser(user, studentId);
  const account = await db.query.users.findFirst({ where: and(eq(schema.users.studentId, studentId), eq(schema.users.role, "STUDENT")) });
  if (!account) return;
  await db.update(schema.users).set({ active: !account.active }).where(eq(schema.users.id, account.id));
  await audit(user.id, account.active ? "portal.disable" : "portal.enable", "student", studentId, {});
  revalidatePath(`/students/${studentId}`, "layout");
}

const passportFields = z.object({
  passportNumber: z.string().trim().toUpperCase().max(20).optional().transform((v) => v || null).refine((v) => v === null || /^[A-Z][0-9]{7}$/.test(v), "An Indian passport number is a letter and seven digits"),
  passportIssue: optionalDate,
  passportExpiry: optionalDate,
  passportIssueCountry: optionalText,
  dateOfBirth: optionalDate,
  cityOfBirth: optionalText,
});

/** Saves the passport details a person checked after a document was read. Blank boxes leave what is on file. */
export async function applyPassportAction(_: FormState, formData: FormData): Promise<FormState> {
  const studentId = String(formData.get("studentId"));
  const { user, locked } = await editableStudent(studentId);
  if (locked) return { error: "This profile is locked. Use Request edit." };
  const parsed = passportFields.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const set = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== null));
  if (!Object.keys(set).length) return { error: "Nothing to save." };
  if (parsed.data.passportIssue && parsed.data.passportExpiry && parsed.data.passportExpiry <= parsed.data.passportIssue) return { fieldErrors: { passportExpiry: ["Expiry must be after issue"] }, error: "Check the highlighted fields." };
  await updateTracked("student", studentId, { ...set, updatedAt: new Date() }, { by: user.id, action: "student.passport" });
  await audit(user.id, "student.profile.update", "student", studentId, { section: "passport", source: "document" });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: "Passport details saved." };
}
