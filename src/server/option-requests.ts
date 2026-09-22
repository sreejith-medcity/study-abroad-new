"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SHORTLIST_LIMIT } from "@/lib/catalogue";
import type { FormState } from "@/lib/form-state";
import { EDUCATION_LEVELS, MAX_CHOICES, newRequestNo } from "@/lib/options";
import { PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { adminIds, notifyUsers } from "@/server/notify";
import { optionRequestForUser } from "@/server/option-access";
import { getStudentForUser } from "@/server/queries";
import { saveUpload, UploadError } from "@/server/storage";

const PARTNERS = ["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES] as const;
const LEVELS = ["UG_DIPLOMA", "UG", "PG_DIPLOMA", "PG", "PHD", "VOCATIONAL", "CERTIFICATE"];

/** A partner asks the team which programs suit a student. */
export async function createOptionRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PARTNERS]);
  const errors: Record<string, string[]> = {};
  const studentId = String(fd.get("studentId") ?? "").trim();
  let studentName = String(fd.get("studentName") ?? "").trim();
  let student: { id: string; orgId: string; firstName: string; lastName: string } | null = null;
  if (studentId) {
    student = await getStudentForUser(user, studentId);
    studentName = `${student.firstName} ${student.lastName}`;
  } else if (studentName.length < 2) errors.studentName = ["The student's name, or pick an existing student"];
  const educationCountry = String(fd.get("educationCountry") ?? "").trim() || null;
  const highestLevel = String(fd.get("highestLevel") ?? "");
  if (!(EDUCATION_LEVELS as readonly string[]).includes(highestLevel)) errors.highestLevel = ["Choose the highest level completed"];
  const destinations = [...new Set(fd.getAll("destination").map(String).filter(Boolean))];
  if (!destinations.length) errors.destination = ["At least one destination"];
  if (destinations.length > MAX_CHOICES) errors.destination = [`Up to ${MAX_CHOICES}`];
  const studyLevels = [...new Set(fd.getAll("studyLevel").map(String).filter((l) => LEVELS.includes(l)))];
  if (!studyLevels.length) errors.studyLevel = ["At least one level"];
  if (studyLevels.length > MAX_CHOICES) errors.studyLevel = [`Up to ${MAX_CHOICES}`];
  const studyAreas = [0, 1, 2].map((i) => String(fd.get(`studyArea${i}`) ?? "").trim()).filter(Boolean);
  if (!studyAreas.length) errors.studyArea0 = ["At least one study area"];
  const additionalInfo = String(fd.get("additionalInfo") ?? "").trim().slice(0, 4000) || null;
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length && !student) errors.files = ["The student's marksheets, so the team can judge eligibility"];
  if (files.length > 8) errors.files = ["Up to 8 files"];
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };

  const saved = [];
  try {
    for (const f of files) saved.push({ ...(await saveUpload(f, "program-options")), fileName: f.name.slice(0, 200) });
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message, fieldErrors: { files: [e.message] } };
    throw e;
  }
  const [row] = await db
    .insert(schema.optionRequests)
    .values({
      requestNo: newRequestNo(),
      orgId: student?.orgId ?? user.orgId,
      requestedById: user.id,
      studentId: student?.id ?? null,
      studentName,
      educationCountry,
      highestLevel,
      destinations,
      studyLevels,
      studyAreas,
      additionalInfo,
    })
    .returning();
  if (saved.length) await db.insert(schema.optionRequestFiles).values(saved.map((s) => ({ requestId: row.id, storageKey: s.storageKey, fileName: s.fileName, mimeType: s.mimeType, sizeBytes: s.sizeBytes, uploadedById: user.id })));
  await audit(user.id, "options.request", "option_request", row.id, { requestNo: row.requestNo });
  await notifyUsers(await adminIds(), `Program options requested: ${studentName}`, `${row.requestNo} · ${destinations.join(", ")}`, `/program-options?id=${row.id}`);
  return { redirectTo: `/program-options?id=${row.id}` };
}

/** The team adds a program to the options for a request. */
export async function addOptionAction(fd: FormData) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const requestId = String(fd.get("requestId") ?? "");
  const programId = String(fd.get("programId") ?? "");
  const r = await optionRequestForUser(user, requestId);
  if (!r) return;
  const program = await db.query.programs.findFirst({ where: and(eq(schema.programs.id, programId), eq(schema.programs.status, "LIVE")) });
  if (!program) return;
  await db.insert(schema.optionRequestPrograms).values({ requestId, programId, note: String(fd.get("note") ?? "").trim() || null }).onConflictDoNothing();
  if (!r.assignedToId) await db.update(schema.optionRequests).set({ assignedToId: user.id }).where(eq(schema.optionRequests.id, requestId));
  revalidatePath("/program-options");
}

export async function removeOptionAction(fd: FormData) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const id = String(fd.get("id") ?? "");
  const row = await db.query.optionRequestPrograms.findFirst({ where: eq(schema.optionRequestPrograms.id, id) });
  if (!row || !(await optionRequestForUser(user, row.requestId))) return;
  await db.delete(schema.optionRequestPrograms).where(eq(schema.optionRequestPrograms.id, id));
  revalidatePath("/program-options");
}

/** Tells the partner the list is ready. */
export async function sendOptionsAction(fd: FormData) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const r = await optionRequestForUser(user, String(fd.get("requestId") ?? ""));
  if (!r) return;
  const [{ n }] = await db.select({ n: count() }).from(schema.optionRequestPrograms).where(eq(schema.optionRequestPrograms.requestId, r.id));
  if (!n) return;
  await db.update(schema.optionRequests).set({ status: "OPTIONS_SENT", assignedToId: r.assignedToId ?? user.id, updatedAt: new Date() }).where(eq(schema.optionRequests.id, r.id));
  await audit(user.id, "options.sent", "option_request", r.id, { programs: n });
  await notifyUsers([r.requestedById], `${n} program option${n === 1 ? "" : "s"} for ${r.studentName}`, r.requestNo, `/program-options?id=${r.id}`);
  revalidatePath("/program-options");
}

export async function optionMessageAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PARTNERS]);
  const r = await optionRequestForUser(user, String(fd.get("requestId") ?? ""));
  if (!r) return { error: "That request is not available." };
  const body = String(fd.get("body") ?? "").trim();
  if (!body) return { fieldErrors: { body: ["Write a message"] }, error: "Write a message." };
  await db.insert(schema.optionRequestMessages).values({ requestId: r.id, authorId: user.id, body: body.slice(0, 4000) });
  const to = isStaff(user) ? [r.requestedById] : r.assignedToId ? [r.assignedToId] : await adminIds();
  await notifyUsers(to, `Message on ${r.requestNo}: ${r.studentName}`, body.slice(0, 120), `/program-options?id=${r.id}`);
  revalidatePath("/program-options");
  return { ok: "Sent." };
}

export async function setArchivedAction(fd: FormData) {
  const user = await requireUser([...PARTNERS]);
  const r = await optionRequestForUser(user, String(fd.get("requestId") ?? ""));
  if (!r) return;
  await db.update(schema.optionRequests).set({ archived: fd.get("archived") === "true", updatedAt: new Date() }).where(eq(schema.optionRequests.id, r.id));
  revalidatePath("/program-options");
}

/** Ties a request made before the student had a file to the student, once registered. */
export async function linkStudentAction(fd: FormData) {
  const user = await requireUser([...PARTNERS]);
  const r = await optionRequestForUser(user, String(fd.get("requestId") ?? ""));
  if (!r) return;
  const student = await getStudentForUser(user, String(fd.get("studentId") ?? ""));
  if (!isStaff(user) && student.orgId !== r.orgId) return;
  await db.update(schema.optionRequests).set({ studentId: student.id, updatedAt: new Date() }).where(eq(schema.optionRequests.id, r.id));
  revalidatePath("/program-options");
}

/** Shortlists every recommended program for the linked student, up to the shortlist limit. */
export async function shortlistAllAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const r = await optionRequestForUser(user, String(fd.get("requestId") ?? ""));
  if (!r || !r.studentId) return { error: "Link the request to a student first." };
  const picks = await db.select({ programId: schema.optionRequestPrograms.programId }).from(schema.optionRequestPrograms).where(eq(schema.optionRequestPrograms.requestId, r.id));
  const sl = schema.shortlists;
  const [{ n }] = await db.select({ n: count() }).from(sl).where(eq(sl.studentId, r.studentId));
  let room = SHORTLIST_LIMIT - n;
  let added = 0;
  for (const p of picks) {
    if (room <= 0) break;
    const res = await db.insert(sl).values({ studentId: r.studentId, programId: p.programId, addedById: user.id }).onConflictDoNothing().returning();
    if (res.length) { added++; room--; }
  }
  await db.update(schema.optionRequests).set({ status: "APPLIED", updatedAt: new Date() }).where(eq(schema.optionRequests.id, r.id));
  await audit(user.id, "options.shortlist_all", "option_request", r.id, { added });
  return { redirectTo: `/students/${r.studentId}/shortlist` };
}
