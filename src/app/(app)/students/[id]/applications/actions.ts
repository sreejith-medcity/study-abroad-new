"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextAckNo } from "@/lib/ack";
import { summarise } from "@/lib/checks";
import { intakeLabel } from "@/lib/format";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import { changeStatus, checkApplication, StatusChangeError } from "@/server/applications";
import { adminIds, notifyUsers, partnerRecipients } from "@/server/notify";
import { getApplicationForUser, getStudentForUser } from "@/server/queries";
import { saveUpload, UploadError } from "@/server/storage";
import { sendWhatsApp } from "@/server/whatsapp";

export type FormState = { error?: string; ok?: string; fieldErrors?: Record<string, string[] | undefined> };

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
  if (!program.intakeMonths.includes(month)) return { error: `${program.name} has no ${intakeLabel(month, year)} intake.` };

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
      feeStatus: program.applicationFee > 0 ? "DUE" : "NOT_APPLICABLE",
    })
    .returning();
  await db.insert(schema.statusHistory).values({ applicationId: app.id, toStatusId: first.id, changedById: user.id });
  if (!student.preferredPathway) await db.update(schema.students).set({ preferredPathway: program.pathway }).where(eq(schema.students.id, student.id));

  await notifyUsers(await adminIds(), `New application ${ackNo}`, `${student.firstName} ${student.lastName}: ${program.name}, ${program.university.name}`, `/students/${student.id}/applications?app=${app.id}`);
  await audit(user.id, "application.create", "application", app.id, { programId: program.id, intake: `${month}/${year}` });
  redirect(`/students/${student.id}/applications?app=${app.id}`);
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
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
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
    await notifyUsers(await partnerRecipients(full.orgId, full.student.assignedToId), title, body.slice(0, 120), href);
  } else {
    await notifyUsers(full.officerId ? [full.officerId] : await adminIds(), title, body.slice(0, 120), href);
  }

  if (channel === "STUDENT" && full.student.whatsappOptIn && body) {
    const sent = await sendWhatsApp({ to: full.student.phone, body: `${body}\n\n(${full.ackNo}, Medcity Overseas. Reply to this chat to respond.)` });
    if (sent) await db.update(schema.comments).set({ deliveredAt: new Date() }).where(eq(schema.comments.id, comment.id));
  }

  revalidatePath(`/students/${full.studentId}`, "layout");
  return { ok: channel === "STUDENT" && full.student.whatsappOptIn ? "Sent. Also delivered on WhatsApp." : "Comment posted." };
}

/** Pre-submission check: turn every blocker and warning into one request to the partner. */
export async function askPartnerAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
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
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
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
