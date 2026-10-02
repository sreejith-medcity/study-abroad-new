"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, isAdmin, PROCESSING_ROLES } from "@/lib/permissions";
import { claimHeld, CLAIM_MINUTES, stageLabel, validUntil } from "@/lib/journey";
import { getStudentForUser } from "@/server/queries";
import { sendWhatsAppRecorded } from "@/server/whatsapp";
import { stageGate, studentChecklist, studentContext, syncChecklist } from "@/server/documentation";
import { packContents } from "@/server/pack";
import type { FormState } from "@/lib/form-state";
import type { JourneyStage } from "@/db/schema";
import { sendDocumentDecision, sendStageChange } from "@/server/crm-out";

const { checklistItems: ci, checklistFiles: cf } = schema;

const asDate = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Everyone who may open a file may see the list. Only these may move an item. */
async function itemForUser(user: SessionUser, itemId: string) {
  const item = await db.query.checklistItems.findFirst({ where: eq(ci.id, itemId), with: { type: { columns: { label: true } } } });
  if (!item) return null;
  await getStudentForUser(user, item.studentId);
  return item;
}

const refresh = (studentId: string) => {
  revalidatePath(`/students/${studentId}`, "layout");
  revalidatePath("/documentation");
};

/** Builds the list from the requirements as they stand, without touching history. */
export async function syncChecklistAction(fd: FormData): Promise<void> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  await getStudentForUser(user, studentId);
  const { added } = await syncChecklist(studentId);
  await audit(user.id, "checklist.sync", "student", studentId, { added });
  refresh(studentId);
}

const askSchema = z.object({ itemId: z.string().min(1), dueOn: z.string().optional(), channel: z.string().optional() });

/** Records that the student has been asked, with the day it is wanted by. */
export async function markAskedAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const parsed = askSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Something was missing from that request." };
  const item = await itemForUser(user, parsed.data.itemId);
  if (!item) return { error: "That item is no longer on the list." };
  if (item.state === "ACCEPTED") return { error: `${item.type.label} is already accepted.` };
  const due = asDate(parsed.data.dueOn);
  const already = item.state === "ASKED" || item.state === "REJECTED";
  await db
    .update(ci)
    .set({
      state: item.state === "REJECTED" ? "REJECTED" : "ASKED",
      askedAt: item.askedAt ?? new Date(),
      askedById: item.askedById ?? user.id,
      askedChannel: parsed.data.channel?.trim() || item.askedChannel || "Portal",
      dueOn: dueOn(due, item.dueOn),
      lastChasedAt: already ? new Date() : item.lastChasedAt,
      chaseCount: already ? item.chaseCount + 1 : item.chaseCount,
      updatedAt: new Date(),
    })
    .where(eq(ci.id, item.id));
  await audit(user.id, already ? "checklist.chase" : "checklist.ask", "student", item.studentId, { typeCode: item.typeCode });
  refresh(item.studentId);
  return { ok: already ? `${item.type.label} chased.` : `${item.type.label} asked for.` };
}

const dueOn = (given: Date | null, held: string | null) => (given ? dateOnly(given) : held);

/** Opening a document claims it for twenty minutes, so two people never check it twice. */
export async function claimItemAction(fd: FormData): Promise<void> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const item = await itemForUser(user, String(fd.get("itemId") ?? ""));
  if (!item) return;
  if (item.claimedById && item.claimedById !== user.id && claimHeld(item.claimedAt)) return;
  await db.update(ci).set({ state: item.state === "UPLOADED" ? "IN_REVIEW" : item.state, claimedById: user.id, claimedAt: new Date(), updatedAt: new Date() }).where(eq(ci.id, item.id));
  await audit(user.id, "checklist.claim", "student", item.studentId, { typeCode: item.typeCode, minutes: CLAIM_MINUTES });
  refresh(item.studentId);
}

/** Lets go of a claim without deciding anything. */
export async function releaseItemAction(fd: FormData): Promise<void> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const item = await itemForUser(user, String(fd.get("itemId") ?? ""));
  if (!item || item.claimedById !== user.id) return;
  await db.update(ci).set({ state: item.state === "IN_REVIEW" ? "UPLOADED" : item.state, claimedById: null, claimedAt: null, updatedAt: new Date() }).where(eq(ci.id, item.id));
  refresh(item.studentId);
}

const acceptSchema = z.object({
  itemId: z.string().min(1),
  issuedOn: z.string().optional(),
  validTo: z.string().optional(),
  validityMonths: z.string().optional(),
});

/**
 * Good enough to send on. The date it runs out is read from the document: either
 * the date given, or the date on it plus the validity the team recorded. Where
 * neither is on record the portal records no expiry rather than inventing one.
 */
export async function acceptItemAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = acceptSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Something was missing from that decision." };
  const item = await itemForUser(user, parsed.data.itemId);
  if (!item) return { error: "That item is no longer on the list." };
  const issuedOn = asDate(parsed.data.issuedOn);
  const months = parsed.data.validityMonths?.trim() ? Number(parsed.data.validityMonths) : item.validityMonths;
  if (months != null && (!Number.isInteger(months) || months < 0 || months > 600)) return { fieldErrors: { validityMonths: ["A whole number of months"] }, error: "Check the highlighted fields." };
  const given = asDate(parsed.data.validTo);
  const worked = validUntil(issuedOn ?? item.issuedOn, months ?? null);
  const validTo = given ?? worked;
  const now = new Date();
  await db
    .update(ci)
    .set({
      state: "ACCEPTED",
      issuedOn: dateOnly(issuedOn) ?? item.issuedOn,
      validityMonths: months ?? null,
      validTo: dateOnly(validTo),
      reasonCode: null,
      reason: null,
      decidedAt: now,
      decidedById: user.id,
      claimedById: null,
      claimedAt: null,
      updatedAt: now,
    })
    .where(eq(ci.id, item.id));
  if (item.version > 0) {
    await db.update(cf).set({ outcome: "ACCEPTED", decidedAt: now, decidedById: user.id }).where(and(eq(cf.itemId, item.id), eq(cf.version, item.version)));
  }
  await audit(user.id, "checklist.accept", "student", item.studentId, { typeCode: item.typeCode, validTo: dateOnly(validTo) });
  await sendDocumentDecision(item.studentId, {
    decision: "ACCEPTED",
    typeCode: item.typeCode,
    document: item.type.label,
    validTo: dateOnly(validTo),
    decidedBy: user.name,
  });
  refresh(item.studentId);
  return { ok: `${item.type.label} accepted.` };
}

const rejectSchema = z.object({
  itemId: z.string().min(1),
  reasonCode: z.string().min(1, "Pick a reason"),
  reason: z.string().trim().max(400).optional(),
});

/**
 * Sent back. A rejection needs a reason, because a reason the student cannot act
 * on is how a file stalls for a fortnight, and the reason is what they read.
 */
export async function rejectItemAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = rejectSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Pick a reason the student can act on." };
  const item = await itemForUser(user, parsed.data.itemId);
  if (!item) return { error: "That item is no longer on the list." };
  const reason = await db.query.rejectionReasons.findFirst({ where: eq(schema.rejectionReasons.code, parsed.data.reasonCode) });
  if (!reason) return { fieldErrors: { reasonCode: ["Pick a reason from the list"] }, error: "Pick a reason the student can act on." };
  const now = new Date();
  await db
    .update(ci)
    .set({ state: "REJECTED", reasonCode: reason.code, reason: parsed.data.reason || null, decidedAt: now, decidedById: user.id, claimedById: null, claimedAt: null, updatedAt: now })
    .where(eq(ci.id, item.id));
  if (item.version > 0) {
    await db.update(cf).set({ outcome: "REJECTED", reasonCode: reason.code, reason: parsed.data.reason || null, decidedAt: now, decidedById: user.id }).where(and(eq(cf.itemId, item.id), eq(cf.version, item.version)));
  }
  await audit(user.id, "checklist.reject", "student", item.studentId, { typeCode: item.typeCode, reason: reason.label });
  await sendDocumentDecision(item.studentId, {
    decision: "REJECTED",
    typeCode: item.typeCode,
    document: item.type.label,
    reason: reason.label,
    note: parsed.data.reason || null,
    decidedBy: user.name,
  });
  refresh(item.studentId);
  return { ok: `${item.type.label} sent back: ${reason.label}.` };
}

const skipSchema = z.object({ itemId: z.string().min(1), reason: z.string().trim().min(3, "Say why it is not needed").max(400) });

/** Not needed for this student, with a reason, which stays on the row. */
export async function notNeededAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const parsed = skipSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say why it is not needed." };
  const item = await itemForUser(user, parsed.data.itemId);
  if (!item) return { error: "That item is no longer on the list." };
  const now = new Date();
  await db.update(ci).set({ state: "NOT_NEEDED", reason: parsed.data.reason, reasonCode: null, decidedAt: now, decidedById: user.id, updatedAt: now }).where(eq(ci.id, item.id));
  await audit(user.id, "checklist.not_needed", "student", item.studentId, { typeCode: item.typeCode, reason: parsed.data.reason });
  refresh(item.studentId);
  return { ok: `${item.type.label} marked not needed.` };
}

/** Puts an item back on the list after it was marked not needed. */
export async function needAgainAction(fd: FormData): Promise<void> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const item = await itemForUser(user, String(fd.get("itemId") ?? ""));
  if (!item || item.state !== "NOT_NEEDED") return;
  await db.update(ci).set({ state: item.documentId ? "UPLOADED" : "NOT_ASKED", reason: null, decidedAt: null, decidedById: null, updatedAt: new Date() }).where(eq(ci.id, item.id));
  await audit(user.id, "checklist.needed_again", "student", item.studentId, { typeCode: item.typeCode });
  refresh(item.studentId);
}

const addSchema = z.object({
  studentId: z.string().min(1),
  typeCode: z.string().min(1, "Choose a document"),
  stage: z.string().min(1),
  owedBy: z.enum(["STUDENT", "MEDCITY", "UNIVERSITY", "VENDOR"]),
  note: z.string().trim().min(3, "Say why this student needs it").max(400),
  dueOn: z.string().optional(),
  required: z.string().optional(),
});

/** One document this student alone needs, with the reason it was added. */
export async function addChecklistItemAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const parsed = addSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  await getStudentForUser(user, d.studentId);
  const stage = d.stage as JourneyStage;
  const type = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, d.typeCode) });
  if (!type) return { fieldErrors: { typeCode: ["Choose a document"] }, error: "Check the highlighted fields." };
  const held = await db.query.checklistItems.findFirst({ where: and(eq(ci.studentId, d.studentId), eq(ci.typeCode, d.typeCode)) });
  if (held) return { fieldErrors: { typeCode: ["Already on this student's list"] }, error: "Check the highlighted fields." };
  await db.insert(ci).values({
    studentId: d.studentId,
    stage,
    typeCode: d.typeCode,
    source: "STUDENT",
    sourceLabel: "Added for this student",
    required: fd.get("required") !== "off",
    owedBy: d.owedBy,
    note: d.note,
    dueOn: dateOnly(asDate(d.dueOn)),
    addedById: user.id,
  });
  await audit(user.id, "checklist.add", "student", d.studentId, { typeCode: d.typeCode, stage, note: d.note });
  refresh(d.studentId);
  return { ok: `${type.label} added to ${stageLabel(stage)}.` };
}

/** Takes off an item that was added by hand and has nothing against it. */
export async function removeChecklistItemAction(fd: FormData): Promise<void> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const item = await itemForUser(user, String(fd.get("itemId") ?? ""));
  if (!item || item.source !== "STUDENT" || item.version > 0) return;
  await db.delete(ci).where(eq(ci.id, item.id));
  await audit(user.id, "checklist.remove", "student", item.studentId, { typeCode: item.typeCode });
  refresh(item.studentId);
}

const stageSchema = z.object({ studentId: z.string().min(1), stage: z.string().min(1), reason: z.string().trim().max(400).optional() });

/**
 * Moves the file to another stage. A stage cannot be left while a required
 * document is missing, rejected or out of date, and the refusal names what is
 * missing rather than being a bare error. An ops manager may let it through with
 * a reason, which is logged and shown on the file.
 */
export async function setStageAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const parsed = stageSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Choose a stage." };
  const { studentId, reason } = parsed.data;
  const stage = parsed.data.stage as JourneyStage;
  const student = await getStudentForUser(user, studentId);
  if (student.journeyStage === stage) return { ok: `Already on ${stageLabel(stage)}.` };
  const rows = await studentChecklist(studentId);
  const ctx = await studentContext(studentId);
  const leaving = stageGate(rows, student.journeyStage, ctx.courseStart);
  const forward = rows.length > 0 && stageRankOf(stage) > stageRankOf(student.journeyStage);
  if (forward && !leaving.clear) {
    if (!isAdmin(user)) {
      return { error: `${stageLabel(student.journeyStage)} is not clear yet. Still needed: ${leaving.missing.map((m) => m.label).join(", ")}.` };
    }
    if (!reason) {
      return {
        fieldErrors: { reason: [`Still needed: ${leaving.missing.map((m) => m.label).join(", ")}`] },
        error: "Give a reason for letting this through, which is logged on the file.",
      };
    }
    await db.insert(schema.gateOverrides).values({ studentId, stage: student.journeyStage, reason, missing: leaving.missing.map((m) => m.label), actorId: user.id });
    await audit(user.id, "gate.override", "student", studentId, { stage: student.journeyStage, reason, missing: leaving.missing.map((m) => m.label) });
  }
  await db.update(schema.students).set({ journeyStage: stage, stageEnteredAt: new Date(), updatedAt: new Date() }).where(eq(schema.students.id, studentId));
  await audit(user.id, "student.stage", "student", studentId, { from: student.journeyStage, to: stage });
  await sendStageChange(studentId, {
    medcityId: student.medcityId,
    crmId: student.crmId,
    name: `${student.firstName} ${student.lastName}`,
    from: student.journeyStage,
    to: stage,
    movedBy: user.name,
  });
  await syncChecklist(studentId);
  refresh(studentId);
  return { ok: `Moved to ${stageLabel(stage)}.` };
}

const stageRankOf = (stage: JourneyStage) => schema.journeyStage.enumValues.indexOf(stage);

/** Adds a reason to the team's own list, which grows and is never emptied. */
export async function addRejectionReasonAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const label = String(fd.get("label") ?? "").trim();
  if (label.length < 3) return { fieldErrors: { label: ["Write the reason as the student will read it"] }, error: "Check the highlighted fields." };
  const code = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
  const held = await db.query.rejectionReasons.findFirst({ where: eq(schema.rejectionReasons.code, code) });
  if (held) {
    await db.update(schema.rejectionReasons).set({ label, active: true }).where(eq(schema.rejectionReasons.code, code));
  } else {
    const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${schema.rejectionReasons.sortOrder}), 0) + 10`.mapWith(Number) }).from(schema.rejectionReasons);
    await db.insert(schema.rejectionReasons).values({ code, label, sortOrder: next });
  }
  await audit(user.id, "rejection_reason.save", "rejection_reason", code, { label });
  revalidatePath("/admin/documents");
  revalidatePath("/documentation");
  return { ok: `"${label}" is on the list.` };
}


// ---------- What the Overseas team keeps ----------

const reqSchema = z.object({
  requirementId: z.string().optional(),
  stage: z.string().min(1),
  typeCode: z.string().min(1, "Choose a document"),
  source: z.enum(["ALWAYS", "DESTINATION", "ROUTE", "UNIVERSITY"]),
  countryId: z.string().optional(),
  vendorId: z.string().optional(),
  universityId: z.string().optional(),
  programId: z.string().optional(),
  owedBy: z.enum(["STUDENT", "MEDCITY", "UNIVERSITY", "VENDOR"]),
  validityMonths: z.string().optional(),
  guidance: z.string().trim().max(600).optional(),
  guidanceMl: z.string().trim().max(600).optional(),
  sortOrder: z.string().optional(),
});

/**
 * Adds a requirement to a stage, or changes one. Scope is read from the source:
 * a destination row needs a country, a route row a vendor, a university row a
 * university or one course. Nothing here is about one student.
 */
export async function saveRequirementAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const parsed = reqSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const months = d.validityMonths?.trim() ? Number(d.validityMonths) : null;
  if (months != null && (!Number.isInteger(months) || months < 1 || months > 600)) {
    return { fieldErrors: { validityMonths: ["A whole number of months, or leave it empty"] }, error: "Check the highlighted fields." };
  }
  const sortOrder = d.sortOrder?.trim() ? Number(d.sortOrder) : 100;
  if (!Number.isInteger(sortOrder)) return { fieldErrors: { sortOrder: ["A whole number"] }, error: "Check the highlighted fields." };
  const countryId = d.source === "DESTINATION" ? (d.countryId || null) : null;
  const vendorId = d.source === "ROUTE" ? (d.vendorId || null) : null;
  const universityId = d.source === "UNIVERSITY" ? (d.universityId || null) : null;
  const programId = d.source === "UNIVERSITY" ? (d.programId || null) : null;
  if (d.source === "DESTINATION" && !countryId) return { fieldErrors: { countryId: ["Choose the destination"] }, error: "Check the highlighted fields." };
  if (d.source === "ROUTE" && !vendorId) return { fieldErrors: { vendorId: ["Choose the vendor"] }, error: "Check the highlighted fields." };
  if (d.source === "UNIVERSITY" && !universityId && !programId) return { fieldErrors: { universityId: ["Choose a university, or one course"] }, error: "Check the highlighted fields." };

  const values = {
    stage: d.stage as JourneyStage,
    typeCode: d.typeCode,
    source: d.source,
    countryId,
    vendorId,
    universityId,
    programId,
    required: fd.get("required") !== "off",
    owedBy: d.owedBy,
    validityMonths: months,
    guidance: d.guidance || null,
    guidanceMl: d.guidanceMl || null,
    sortOrder,
    active: fd.get("active") !== "off",
    updatedAt: new Date(),
  };
  if (d.requirementId) {
    await db.update(schema.documentRequirements).set(values).where(eq(schema.documentRequirements.id, d.requirementId));
    await audit(user.id, "requirement.update", "requirement", d.requirementId, values);
  } else {
    const [made] = await db.insert(schema.documentRequirements).values({ ...values, createdById: user.id }).returning({ id: schema.documentRequirements.id });
    await audit(user.id, "requirement.create", "requirement", made.id, values);
  }
  revalidatePath("/admin/documents");
  return { ok: `Recorded on ${stageLabel(values.stage)}. Student files pick it up as they are opened.` };
}

/** Takes a requirement out of use without disturbing the files it has already made. */
export async function setRequirementActiveAction(fd: FormData): Promise<void> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const id = String(fd.get("requirementId") ?? "");
  const active = fd.get("active") === "1";
  const held = await db.query.documentRequirements.findFirst({ where: eq(schema.documentRequirements.id, id) });
  if (!held) return;
  await db.update(schema.documentRequirements).set({ active, updatedAt: new Date() }).where(eq(schema.documentRequirements.id, id));
  await audit(user.id, active ? "requirement.activate" : "requirement.pause", "requirement", id, { typeCode: held.typeCode });
  revalidatePath("/admin/documents");
}

/** Retires a reason. What was already sent back keeps the words the student read. */
export async function setReasonActiveAction(fd: FormData): Promise<void> {
  const user = await requireUser([...PROCESSING_ROLES]);
  const code = String(fd.get("code") ?? "");
  const active = fd.get("active") === "1";
  await db.update(schema.rejectionReasons).set({ active }).where(eq(schema.rejectionReasons.code, code));
  await audit(user.id, active ? "rejection_reason.activate" : "rejection_reason.retire", "rejection_reason", code, {});
  revalidatePath("/admin/documents");
}

// ---------- Asking the student ----------

const requestSchema = z.object({
  studentId: z.string().min(1),
  channel: z.enum(["WHATSAPP", "PORTAL"]),
  body: z.string().trim().min(10, "The message cannot be empty").max(4000),
  dueOn: z.string().optional(),
  locale: z.string().optional(),
});

/**
 * Sends one request for everything the counsellor ticked.
 *
 * What goes out is what is in the box: the counsellor has read it and may have
 * changed any of it. Each item is marked asked for, or chased where it had been
 * asked for already, and the whole thing is recorded so nobody has to remember
 * whether it went.
 */
export async function sendDocumentRequestAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const parsed = requestSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const student = await getStudentForUser(user, d.studentId);
  const itemIds = fd.getAll("itemIds").map(String).filter(Boolean);
  if (itemIds.length === 0) return { error: "Tick at least one document to ask for." };

  const items = await db.query.checklistItems.findMany({ where: and(eq(ci.studentId, d.studentId), inArray(ci.id, itemIds)) });
  if (items.length === 0) return { error: "Those documents are no longer on the list." };
  const due = asDate(d.dueOn);
  const locale = d.locale === "ml" ? "ml" : "en";

  let messageId: string | null = null;
  let delivered = false;
  if (d.channel === "WHATSAPP") {
    const branch = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, student.orgId), columns: { studentWhatsappMessages: true } });
    if (!student.whatsappOptIn) return { error: `${student.firstName} has not agreed to WhatsApp messages. Send it in the portal instead.` };
    if (branch?.studentWhatsappMessages === false) return { error: "This branch has WhatsApp messages to students switched off. Send it in the portal instead." };
    const sent = await sendWhatsAppRecorded({ to: student.phone, template: "documents_request", body: d.body });
    messageId = sent.messageId;
    delivered = sent.ok;
  }

  const [request] = await db
    .insert(schema.documentRequests)
    .values({
      studentId: d.studentId,
      kind: items.some((i) => i.state === "ASKED" || i.state === "REJECTED") ? "NUDGE" : "ASK",
      channel: d.channel,
      locale,
      body: d.body,
      dueOn: dateOnly(due),
      itemCount: items.length,
      sentById: user.id,
      messageId,
    })
    .returning({ id: schema.documentRequests.id });
  await db.insert(schema.documentRequestItems).values(items.map((i) => ({ requestId: request.id, itemId: i.id }))).onConflictDoNothing();

  const now = new Date();
  for (const item of items) {
    const already = item.state === "ASKED" || item.state === "REJECTED";
    await db
      .update(ci)
      .set({
        // A rejected document stays rejected: it is the state the student has to
        // act on, and asking again does not make the old file acceptable.
        state: item.state === "REJECTED" ? "REJECTED" : "ASKED",
        askedAt: item.askedAt ?? now,
        askedById: item.askedById ?? user.id,
        askedChannel: d.channel === "WHATSAPP" ? "WhatsApp" : "Portal",
        dueOn: dateOnly(due) ?? item.dueOn,
        lastChasedAt: already ? now : item.lastChasedAt,
        chaseCount: already ? item.chaseCount + 1 : item.chaseCount,
        updatedAt: now,
      })
      .where(eq(ci.id, item.id));
  }
  await audit(user.id, "checklist.request", "student", d.studentId, { channel: d.channel, items: items.map((i) => i.typeCode), delivered });
  refresh(d.studentId);
  return {
    redirectTo: `/students/${d.studentId}/documentation`,
    ok:
      d.channel === "WHATSAPP"
        ? delivered
          ? `Sent to ${student.firstName} on WhatsApp.`
          : "Recorded, but WhatsApp would not take it. The list is in the student's portal either way."
        : `Recorded. ${student.firstName} sees the list when they next open the portal.`,
  };
}

// ---------- The submission pack ----------

/**
 * Records that one application's paperwork was gathered, and hands back the
 * download. What is missing is recorded with it rather than hidden, so a pack
 * sent short is a fact on the file rather than an argument later.
 */
export async function buildPackAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const applicationId = String(fd.get("applicationId") ?? "");
  const note = String(fd.get("note") ?? "").trim().slice(0, 400) || null;
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, applicationId) });
  if (!app) return { error: "That application no longer exists." };
  await getStudentForUser(user, app.studentId);
  const contents = await packContents(applicationId);
  if (!contents) return { error: "That application no longer exists." };
  if (contents.files.length === 0) return { error: "Nothing has been accepted for this student yet, so there is nothing to pack." };
  const [pack] = await db
    .insert(schema.submissionPacks)
    .values({
      applicationId,
      studentId: app.studentId,
      builtById: user.id,
      itemCount: contents.files.length,
      missing: contents.missing.map((m) => m.label),
      note,
    })
    .returning({ id: schema.submissionPacks.id });
  await audit(user.id, "pack.build", "application", applicationId, { files: contents.files.length, missing: contents.missing.map((m) => m.label) });
  revalidatePath(`/students/${app.studentId}`, "layout");
  return { redirectTo: `/api/packs/${pack.id}`, ok: `Packed ${contents.files.length} document${contents.files.length === 1 ? "" : "s"}.` };
}

/**
 * Runs the chasing now rather than waiting for the scheduler. The same code the
 * schedule calls, so what the team sees by hand is what happens overnight.
 */
export async function runRemindersAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  void fd;
  const { runDocumentReminders } = await import("@/server/documentation-reminders");
  const run = await runDocumentReminders();
  await audit(user.id, "checklist.reminders", "student", "*", { ...run, via: "by hand" });
  revalidatePath("/documentation");
  const said = [
    run.messagesSent ? `${run.messagesSent} reminder${run.messagesSent === 1 ? "" : "s"} sent` : null,
    run.escalated ? `${run.escalated} put on a counsellor's desk` : null,
    run.expiryFlagged ? `${run.expiryFlagged} flagged as running out too early` : null,
    run.gatesAnnounced ? `${run.gatesAnnounced} gate${run.gatesAnnounced === 1 ? "" : "s"} announced as clear` : null,
    run.tasksRaised ? `${run.tasksRaised} task${run.tasksRaised === 1 ? "" : "s"} put on a desk` : null,
  ].filter(Boolean);
  return { ok: said.length ? said.join(", ") + "." : "Nothing needed chasing." };
}
