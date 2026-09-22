"use server";

import { revalidatePath } from "next/cache";
import { dayText, daysUntil } from "@/lib/catalogue";
import { toPlain, toWhatsApp } from "@/lib/rich-text";
import { DEADLINE_LABEL, DEADLINE_TYPES } from "@/lib/deadline-types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextAckNo } from "@/lib/ack";
import { summarise } from "@/lib/checks";
import { intakeLabel } from "@/lib/format";
import { ADMIN_ROLES, PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { changeStatus, checkApplication, StatusChangeError } from "@/server/applications";
import { adminIds, notifyUsers, partnerRecipients } from "@/server/notify";
import { getApplicationForUser, getStudentForUser } from "@/server/queries";
import { saveUpload, UploadError } from "@/server/storage";
import { sendWhatsApp } from "@/server/whatsapp";

import type { FormState } from "@/lib/form-state";
export type { FormState };

const createSchema = z.object({
  studentId: z.string().min(1),
  programId: z.string().min(1, "Choose a program"),
  intake: z.string().regex(/^\d{4}-\d{1,2}$/, "Choose an intake"),
});

export async function createApplicationAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Choose a program and intake." };
  const student = await getStudentForUser(user, parsed.data.studentId);
  const [year, month] = parsed.data.intake.split("-").map(Number);

  const program = await db.query.programs.findFirst({ where: eq(schema.programs.id, parsed.data.programId), with: { university: true } });
  if (!program || program.status !== "LIVE") return { error: "That program is not open for applications." };
  // Where intakes are on record the choice must be one of them. Where none are
  // (register imports carry no intake dates) any future month is accepted and
  // the team confirms it with the institution.
  if (program.intakeMonths.length && !program.intakeMonths.includes(month)) return { error: `${program.name} has no ${intakeLabel(month, year)} intake.` };
  if (new Date(year, month - 1, 1) < new Date(new Date().getFullYear(), new Date().getMonth(), 1)) return { error: "That intake has already started." };

  const duplicate = await db.query.applications.findFirst({
    where: and(eq(schema.applications.studentId, student.id), eq(schema.applications.programId, program.id), eq(schema.applications.intakeYear, year), eq(schema.applications.intakeMonth, month)),
    with: { status: true },
  });
  if (duplicate && duplicate.status.group !== "CLOSED") return { error: `There is already an open application for this program and intake (${duplicate.ackNo}).` };

  const [first] = await db
    .select()
    .from(schema.statusDefinitions)
    .where(and(eq(schema.statusDefinitions.pathway, program.pathway), eq(schema.statusDefinitions.group, "NEW"), eq(schema.statusDefinitions.active, true)))
    .orderBy(asc(schema.statusDefinitions.sortOrder))
    .limit(1);
  if (!first) return { error: "No starting status is configured for this pathway. Ask an admin." };

  const ackNo = await nextAckNo();
  const [app] = await db
    .insert(schema.applications)
    .values({
      ackNo,
      studentId: student.id,
      programId: program.id,
      orgId: student.orgId,
      intakeMonth: month,
      intakeYear: year,
      statusId: first.id,
      createdById: user.id,
      // An unverified fee is treated as due, so someone confirms it before submission.
      feeStatus: program.applicationFee === 0 ? "NOT_APPLICABLE" : "DUE",
    })
    .returning();
  await db.insert(schema.statusHistory).values({ applicationId: app.id, toStatusId: first.id, changedById: user.id });
  if (!student.preferredPathway) await db.update(schema.students).set({ preferredPathway: program.pathway }).where(eq(schema.students.id, student.id));

  const deadline = await db.query.programDeadlines.findFirst({
    where: and(eq(schema.programDeadlines.programId, program.id), eq(schema.programDeadlines.intakeYear, year), eq(schema.programDeadlines.intakeMonth, month)),
  });
  const late = deadline && daysUntil(deadline.deadline) < 0 ? `. The deadline for this intake passed on ${dayText(deadline.deadline)}` : "";
  await notifyUsers(await adminIds(), `New application ${ackNo}`, `${student.firstName} ${student.lastName}: ${program.name}, ${program.university.name}${program.intakeMonths.length ? "" : ". Intake not on record: confirm it with the institution"}${late}`, `/students/${student.id}/applications?app=${app.id}`);
  await audit(user.id, "application.create", "application", app.id, { programId: program.id, intake: `${month}/${year}` });
  return { redirectTo: `/students/${student.id}/applications?app=${app.id}` };
}

export async function changeStatusAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const applicationId = String(formData.get("applicationId"));
  const statusId = String(formData.get("statusId"));
  const reason = String(formData.get("reason") ?? "");
  try {
    await changeStatus(user, applicationId, statusId, reason);
  } catch (e) {
    if (e instanceof StatusChangeError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: "Status updated. Partner notified." };
}

export async function addCommentAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const applicationId = String(formData.get("applicationId"));
  const channel = formData.get("channel") === "STUDENT" ? "STUDENT" : "TEAM";
  const body = String(formData.get("body") ?? "").trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!body && !hasFile) return { error: "Write a message or attach a file." };
  if (body.length > 5000) return { error: "Messages can be up to 5,000 characters." };

  const app = await getApplicationForUser(user, applicationId);
  const full = await db.query.applications.findFirst({ where: eq(schema.applications.id, app.id), with: { student: true, program: true } });
  if (!full) return { error: "Application not found." };

  let upload: Awaited<ReturnType<typeof saveUpload>> | null = null;
  if (hasFile) {
    try {
      upload = await saveUpload(file, `students/${full.studentId}`);
    } catch (e) {
      if (e instanceof UploadError) return { error: e.message };
      throw e;
    }
  }

  const [comment] = await db
    .insert(schema.comments)
    .values({ applicationId: app.id, channel, body: body || `Attached ${(file as File).name}`, authorId: user.id })
    .returning();
  if (upload && hasFile) {
    await db.insert(schema.documents).values({ studentId: full.studentId, applicationId: app.id, commentId: comment.id, typeCode: "OTHER", fileName: file.name, uploadedById: user.id, ...upload });
  }

  const href = `/students/${full.studentId}/applications?app=${app.id}&ch=${channel}`;
  const title = `New ${channel === "TEAM" ? "team" : "student"} comment on ${full.ackNo}`;
  if (isStaff(user)) {
    await notifyUsers(await partnerRecipients(full.orgId, full.student.assignedToId), title, toPlain(body).slice(0, 120), href);
  } else {
    await notifyUsers(full.officerId ? [full.officerId] : await adminIds(), title, toPlain(body).slice(0, 120), href);
  }

  const branch = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, full.orgId), columns: { studentWhatsappMessages: true } });
  const viaWhatsapp = channel === "STUDENT" && full.student.whatsappOptIn && branch?.studentWhatsappMessages !== false;
  if (viaWhatsapp && body) {
    const sent = await sendWhatsApp({ to: full.student.phone, body: `${toWhatsApp(body)}\n\n(${full.ackNo}, Medcity Overseas. Reply to this chat to respond.)` });
    if (sent) await db.update(schema.comments).set({ deliveredAt: new Date() }).where(eq(schema.comments.id, comment.id));
  }

  revalidatePath(`/students/${full.studentId}`, "layout");
  return { ok: viaWhatsapp ? "Sent. Also delivered on WhatsApp." : "Comment posted." };
}

/** Pre-submission check: turn every blocker and warning into one request to the partner. */
export async function askPartnerAction(formData: FormData) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const applicationId = String(formData.get("applicationId"));
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, applicationId), with: { status: true, student: true } });
  if (!app) return;
  const results = (await checkApplication(app.id)).filter((r) => r.severity !== "pass");
  if (!results.length) return;

  const lines = results.map((r) => `• ${r.severity === "blocker" ? "Required" : "Please check"}: ${r.message}`).join("\n");
  await db.insert(schema.comments).values({
    applicationId: app.id,
    channel: "TEAM",
    authorId: user.id,
    body: `Dear team,\n\nBefore we can submit this application, please resolve the following:\n\n${lines}\n\nRegards`,
  });

  const pending = await db.query.statusDefinitions.findFirst({
    where: and(eq(schema.statusDefinitions.pathway, app.status.pathway), eq(schema.statusDefinitions.code, "PENDING_PARTNER")),
  });
  if (pending && pending.id !== app.statusId) {
    await changeStatus(user, app.id, pending.id, `${summarise(results).blockers} blocker(s) from pre-submission check`);
  } else {
    await notifyUsers(await partnerRecipients(app.orgId, app.student.assignedToId), `${app.ackNo}: action needed`, `${results.length} item(s) to fix`, `/students/${app.studentId}/applications?app=${app.id}`);
  }
  await audit(user.id, "application.ask_partner", "application", app.id, { items: results.map((r) => r.code) });
  revalidatePath("/", "layout");
}

export async function setDocumentTypeAction(formData: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const documentId = String(formData.get("documentId"));
  const typeCode = String(formData.get("typeCode"));
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
  if (!doc) return;
  await getStudentForUser(user, doc.studentId);
  const type = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, typeCode) });
  if (!type) return;
  await db.update(schema.documents).set({ typeCode }).where(eq(schema.documents.id, documentId));
  await audit(user.id, "document.classify", "document", documentId, { typeCode });
  revalidatePath(`/students/${doc.studentId}`, "layout");
}

export async function markFeePaidAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const applicationId = String(formData.get("applicationId"));
  await db.update(schema.applications).set({ feeStatus: "PAID" }).where(and(eq(schema.applications.id, applicationId), inArray(schema.applications.feeStatus, ["DUE"])));
  await audit(user.id, "application.fee_paid", "application", applicationId);
  revalidatePath("/", "layout");
}

const isoDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date")]).transform((v) => v || null);
const offerVisa = z
  .object({
    applicationId: z.string().min(1),
    offerType: z.union([z.literal(""), z.enum(["CONDITIONAL", "UNCONDITIONAL"])]).transform((v) => v || null),
    offerDate: isoDate,
    offerConditions: z.string().trim().max(2000).transform((v) => v || null),
    offerAcceptBy: isoDate,
    depositAmount: z.union([z.literal(""), z.coerce.number().int("Whole number").min(0)]).transform((v) => (v === "" ? null : v)),
    depositPaidOn: isoDate,
    confirmationNumber: z.string().trim().max(60).transform((v) => v || null),
    confirmationIssuedOn: isoDate,
    visaLodgedOn: isoDate,
    visaDecision: z.union([z.literal(""), z.enum(["GRANTED", "REFUSED"])]).transform((v) => v || null),
    visaDecisionOn: isoDate,
  })
  .superRefine((v, ctx) => {
    if (v.offerType && !v.offerDate) ctx.addIssue({ code: "custom", path: ["offerDate"], message: "When was the offer issued?" });
    if (!v.offerType && (v.offerDate || v.offerAcceptBy || v.offerConditions)) ctx.addIssue({ code: "custom", path: ["offerType"], message: "Say which kind of offer it is" });
    if (v.offerDate && v.offerAcceptBy && v.offerAcceptBy < v.offerDate) ctx.addIssue({ code: "custom", path: ["offerAcceptBy"], message: "Before the offer date" });
    if (v.depositPaidOn && v.depositAmount == null) ctx.addIssue({ code: "custom", path: ["depositAmount"], message: "How much was paid?" });
    if (v.visaDecision && !v.visaDecisionOn) ctx.addIssue({ code: "custom", path: ["visaDecisionOn"], message: "When was the decision?" });
    if (v.visaDecisionOn && !v.visaDecision) ctx.addIssue({ code: "custom", path: ["visaDecision"], message: "Granted or refused?" });
    if (v.visaLodgedOn && v.visaDecisionOn && v.visaDecisionOn < v.visaLodgedOn) ctx.addIssue({ code: "custom", path: ["visaDecisionOn"], message: "Before the visa was lodged" });
  });

/** The offer, deposit, CAS / I-20 / CoE and visa facts on one application. */
export async function saveOfferVisaAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = offerVisa.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const { applicationId, ...values } = parsed.data;
  const app = await getApplicationForUser(user, applicationId);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(values)) {
    const before = app[k as keyof typeof app] ?? null;
    if (String(before ?? "") !== String(v ?? "")) changed[k] = { from: before, to: v };
  }
  if (!Object.keys(changed).length) return { ok: "Nothing changed." };
  await db.update(schema.applications).set({ ...values, updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
  await audit(user.id, "application.offer_visa", "application", app.id, { changed });
  // An accept-by date is a deadline like any other, so it shows on dashboards.
  if (changed.offerAcceptBy) {
    const d = schema.applicationDeadlines;
    await db.delete(d).where(and(eq(d.applicationId, app.id), eq(d.type, "OFFER_ACCEPTANCE"), isNull(d.doneAt)));
    if (values.offerAcceptBy) await db.insert(d).values({ applicationId: app.id, type: "OFFER_ACCEPTANCE", dueOn: values.offerAcceptBy, note: "From the offer", createdById: user.id });
  }
  const student = await db.query.students.findFirst({ where: eq(schema.students.id, app.studentId), columns: { assignedToId: true } });
  const headline = changed.visaDecision
    ? `Visa ${values.visaDecision === "GRANTED" ? "granted" : "refused"}`
    : changed.offerType
      ? `${values.offerType === "UNCONDITIONAL" ? "Unconditional" : "Conditional"} offer recorded`
      : "Offer and visa details updated";
  await notifyUsers(await partnerRecipients(app.orgId, student?.assignedToId), `${app.ackNo}: ${headline}`, Object.keys(changed).join(", "), `/students/${app.studentId}/applications?app=${app.id}`);
  revalidatePath(`/students/${app.studentId}/applications`);
  return { ok: `Saved ${Object.keys(changed).length} change${Object.keys(changed).length === 1 ? "" : "s"}.` };
}

const deadlineInput = z.object({
  applicationId: z.string().min(1),
  type: z.enum(DEADLINE_TYPES, { message: "Choose what is due" }),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date"),
  note: z.string().trim().max(300).transform((v) => v || null),
});

/** The team dates a milestone on an application; the partner is told. */
export async function addDeadlineAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = deadlineInput.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const app = await getApplicationForUser(user, parsed.data.applicationId);
  await db.insert(schema.applicationDeadlines).values({ applicationId: app.id, type: parsed.data.type, dueOn: parsed.data.dueOn, note: parsed.data.note, createdById: user.id });
  await audit(user.id, "application.deadline", "application", app.id, { type: parsed.data.type, dueOn: parsed.data.dueOn });
  const student = await db.query.students.findFirst({ where: eq(schema.students.id, app.studentId), columns: { assignedToId: true } });
  await notifyUsers(await partnerRecipients(app.orgId, student?.assignedToId), `${app.ackNo}: ${DEADLINE_LABEL[parsed.data.type]} due ${dayText(parsed.data.dueOn)}`, parsed.data.note ?? undefined, `/students/${app.studentId}/applications?app=${app.id}`);
  revalidatePath(`/students/${app.studentId}/applications`);
  return { ok: "Deadline added." };
}

/** Either side can tick a milestone off; the team can also remove one. */
export async function setDeadlineDoneAction(fd: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const d = await db.query.applicationDeadlines.findFirst({ where: eq(schema.applicationDeadlines.id, String(fd.get("id") ?? "")) });
  if (!d) return;
  const app = await getApplicationForUser(user, d.applicationId);
  if (fd.get("remove") === "1") {
    if (!(PROCESSING_ROLES as readonly string[]).includes(user.role)) return;
    await db.delete(schema.applicationDeadlines).where(eq(schema.applicationDeadlines.id, d.id));
  } else {
    await db.update(schema.applicationDeadlines).set({ doneAt: d.doneAt ? null : new Date() }).where(eq(schema.applicationDeadlines.id, d.id));
  }
  await audit(user.id, "application.deadline_done", "application", app.id, { type: d.type });
  revalidatePath(`/students/${app.studentId}/applications`);
}

/** Branch's own ordering of its applications: which to chase first. */
export async function setPriorityAction(fd: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const priority = String(fd.get("priority") ?? "");
  if (!(schema.applicationPriority.enumValues as readonly string[]).includes(priority)) return;
  const app = await getApplicationForUser(user, String(fd.get("applicationId") ?? ""));
  if (app.priority === priority) return;
  await db.update(schema.applications).set({ priority: priority as "HIGH" }).where(eq(schema.applications.id, app.id));
  await audit(user.id, "application.priority", "application", app.id, { from: app.priority, to: priority });
  revalidatePath(`/students/${app.studentId}/applications`);
  revalidatePath("/applications");
}
