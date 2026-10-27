"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { GSTIN_RE } from "@/lib/billing";
import type { FormState } from "@/lib/form-state";
import { APP_ROLES } from "@/lib/permissions";
import {
  COUNTER_METHODS,
  STAGE_INVOICE_DAYS,
  addDays,
  balanceDue,
  isDay,
  istToday,
  planProblem,
  refundRoom,
  rupees,
  scheduleFrom,
  stateFromGstin,
  usesShares,
  type FeeMethod,
  type FeePlanItem,
} from "@/lib/student-fees";
import {
  cancelLiveLinks,
  createDraft,
  billingOrgId,
  createPaymentLink,
  feeAccess,
  fileProgress,
  reachedBy,
  invoiceFor,
  invoiceInstalment,
  issueInvoice,
  nextNumber,
  pendingRefunds,
  recordReceipt,
  studentFor,
} from "@/server/student-fees";
import { ensureBranchCode } from "@/server/medcity-id";
import { isFeeStep } from "@/lib/fee-steps";
import { adminIds, notifyUsers } from "@/server/notify";

const { feeInvoices: fi, feeInstalments: fs, feeRefunds: rf, feePlans: fp } = schema;

const NOT_YOURS = "That student is not one you can open.";
const NO_ACT = "Your role reads students' fees and does not take them. Ask your branch head or finance.";
const DESK_ONLY = "Only finance or the head office can do this.";

function refresh(studentId?: string) {
  if (studentId) revalidatePath(`/students/${studentId}/fees`);
  revalidatePath("/fees", "layout");
  revalidatePath("/portal/fees");
}

async function actor(): Promise<{ user: SessionUser; access: Awaited<ReturnType<typeof feeAccess>> }> {
  const user = await requireUser([...APP_ROLES]);
  return { user, access: await feeAccess(user) };
}

/** Whole rupees from a form box: blank is null, anything else must be a whole number. */
function wholeRupees(v: FormDataEntryValue | null): number | null | "bad" {
  const s = String(v ?? "").replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d+$/.test(s)) return "bad";
  return Number(s);
}

/** A GST rate from a form box: blank is not recorded, never nought. */
function gstRate(v: FormDataEntryValue | null): number | null | "bad" {
  const s = String(v ?? "").trim().replace(/%$/, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 28) return "bad";
  return n;
}

// ---------- Fee plan templates ----------

const itemShape = z.object({
  label: z.string().trim().min(1).max(80),
  amount: z.number().int().positive().nullable(),
  share: z.number().positive().max(100).nullable(),
  due: z.enum(["ON_APPLY", "DAYS", "DATE", "STEP"]),
  days: z.number().int().min(0).max(1500).nullable().optional(),
  date: z.string().refine(isDay).nullable().optional(),
  pathway: z.string().max(40).nullable().optional(),
  stepKey: z.string().max(80).nullable().optional(),
  // Left out: the plan's rate. Null: the instalment's rate is not recorded.
  gstPercent: z.number().min(0).max(28).nullable().optional(),
}).refine((i) => i.due !== "STEP" || isFeeStep(i.pathway, i.stepKey));

/** Saves a fee plan template. The head office and finance keep them. */
export async function saveFeePlanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.desk) return { error: DESK_ONLY };
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const note = String(fd.get("note") ?? "").trim() || null;
  const gst = gstRate(fd.get("gstPercent"));
  if (name.length < 2) return { fieldErrors: { name: ["Give the plan a name"] }, error: "Check the highlighted fields." };
  if (gst === "bad") return { fieldErrors: { gstPercent: ["A rate between 0 and 28, or leave it empty if it is not recorded"] }, error: "Check the highlighted fields." };
  let raw: unknown;
  try {
    raw = JSON.parse(String(fd.get("items") ?? "[]"));
  } catch {
    return { error: "The instalments could not be read. Reload the page and try again." };
  }
  const parsed = z.array(itemShape).safeParse(raw);
  if (!parsed.success) return { error: "Every instalment needs a name, an amount in whole rupees or a share, and when it is due." };
  const items: FeePlanItem[] = parsed.data.map((i) => ({
    label: i.label,
    amount: i.amount,
    share: i.share,
    due: i.due,
    days: i.due === "DAYS" ? (i.days ?? null) : null,
    date: i.due === "DATE" ? (i.date ?? null) : null,
    ...(i.due === "STEP" ? { pathway: i.pathway ?? null, stepKey: i.stepKey ?? null } : {}),
    ...(i.gstPercent !== undefined ? { gstPercent: i.gstPercent } : {}),
  }));
  const problem = planProblem(items);
  if (problem) return { error: problem };
  if (id) {
    const [row] = await db.update(fp).set({ name, note, gstPercent: gst, items, updatedById: user.id, updatedAt: new Date() }).where(eq(fp.id, id)).returning({ id: fp.id });
    if (!row) return { error: "That plan is not on record." };
    await audit(user.id, "fee_plan.update", "fee_plan", id, { name, gstPercent: gst, instalments: items.length });
  } else {
    const [row] = await db.insert(fp).values({ name, note, gstPercent: gst, items, createdById: user.id, updatedById: user.id }).returning({ id: fp.id });
    await audit(user.id, "fee_plan.create", "fee_plan", row.id, { name, gstPercent: gst, instalments: items.length });
  }
  revalidatePath("/fees/plans");
  return { ok: id ? "Plan saved." : "Plan added.", redirectTo: "/fees/plans" };
}

/** Takes a plan out of use, or puts it back. Schedules already applied keep their figures. */
export async function toggleFeePlanAction(fd: FormData) {
  const { user, access } = await actor();
  if (!access.desk) return;
  const id = String(fd.get("id") ?? "");
  const plan = await db.query.feePlans.findFirst({ where: eq(fp.id, id) });
  if (!plan) return;
  await db.update(fp).set({ active: !plan.active, updatedById: user.id, updatedAt: new Date() }).where(eq(fp.id, id));
  await audit(user.id, plan.active ? "fee_plan.retire" : "fee_plan.restore", "fee_plan", id, { name: plan.name });
  revalidatePath("/fees/plans");
}

// ---------- Tax details ----------

/**
 * An organisation's GSTIN and state. With a GSTIN the state is read from it;
 * without one the state is what the branch is in, for the record.
 */
export async function saveTaxDetailsAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.desk) return { error: DESK_ONLY };
  const orgId = String(fd.get("orgId") ?? "");
  const gstin = String(fd.get("gstin") ?? "").toUpperCase().replace(/\s+/g, "") || null;
  let state = String(fd.get("state") ?? "").trim() || null;
  if (gstin && !GSTIN_RE.test(gstin)) return { fieldErrors: { gstin: ["A GSTIN is 15 characters, like 32ABCDE1234F1Z5"] }, error: "Check the highlighted fields." };
  if (gstin) {
    const fromCode = stateFromGstin(gstin);
    if (!fromCode) return { fieldErrors: { gstin: ["The first two digits are not a GST state code"] }, error: "Check the highlighted fields." };
    state = fromCode;
  }
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org) return { error: "That organisation is not on record." };
  await db.update(schema.organizations).set({ gstin, state }).where(eq(schema.organizations.id, orgId));
  await audit(user.id, "org.tax_details", "organization", orgId, { from: { gstin: org.gstin, state: org.state }, to: { gstin, state } });
  revalidatePath("/fees/plans");
  return { ok: gstin ? `${org.name}: GSTIN ${gstin}, ${state}. Its next invoices are tax invoices.` : `${org.name}: no GSTIN. Its invoices are bills of supply.` };
}

// ---------- A student's schedule ----------

/**
 * Puts a fee plan on a student. Dated instalments are invoiced at once, so
 * the ageing report sees them coming; those tied to a stage are invoiced when
 * the file reaches it, or now where it already has.
 */
export async function applyFeePlanAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const student = await studentFor(user, String(fd.get("studentId") ?? ""));
  if (!student) return { error: NOT_YOURS };
  const plan = await db.query.feePlans.findFirst({ where: and(eq(fp.id, String(fd.get("planId") ?? "")), eq(fp.active, true)) });
  if (!plan) return { fieldErrors: { planId: ["Choose a plan"] }, error: "Check the highlighted fields." };
  const fee = wholeRupees(fd.get("fee"));
  if (fee === "bad") return { fieldErrors: { fee: ["Whole rupees, no paise"] }, error: "Check the highlighted fields." };
  if (usesShares(plan.items) && !fee) {
    return { fieldErrors: { fee: ["This plan is in shares, so it needs the package fee"] }, error: "A share of a fee nobody recorded cannot be worked out. Enter the package fee." };
  }
  const startOn = String(fd.get("startOn") ?? "") || istToday();
  if (!isDay(startOn)) return { fieldErrors: { startOn: ["Enter a date"] }, error: "Check the highlighted fields." };
  const live = await db.query.feeInstalments.findFirst({ where: and(eq(fs.studentId, student.id), inArray(fs.state, ["SCHEDULED", "INVOICED"])) });
  if (live) return { error: `${student.firstName} already has a fee schedule (${live.planName}). Cancel what is left of it first.` };
  const rows = scheduleFrom(plan.items, usesShares(plan.items) ? fee : null, startOn, plan.gstPercent);
  const billedBy = await billingOrgId(student.orgId);
  if (rows.some((r) => r.amount == null)) return { error: "An instalment came out with no amount. Check the plan." };
  const inserted = await db
    .insert(fs)
    .values(
      rows.map((r) => ({
        studentId: student.id,
        orgId: billedBy,
        planId: plan.id,
        planName: plan.name,
        seq: r.seq,
        label: r.label,
        amount: r.amount!,
        currency: plan.currency,
        gstPercent: r.gstPercent,
        dueOn: r.dueOn,
        stepPathway: r.stepPathway,
        stepKey: r.stepKey,
        createdById: user.id,
      })),
    )
    .returning({ id: fs.id, dueOn: fs.dueOn, stepPathway: fs.stepPathway, stepKey: fs.stepKey });
  await audit(user.id, "fee_plan.apply", "student", student.id, { plan: plan.name, fee, startOn, instalments: rows.length, total: rows.reduce((s, r) => s + (r.amount ?? 0), 0) });
  let raised = 0;
  let drafts = 0;
  // A stage or step the file has already reached is due now, the same as a dated one.
  const at = await fileProgress(student.id);
  for (const ins of inserted) {
    const now = ins.dueOn != null || reachedBy(ins, at);
    if (!now) continue;
    // A stage already reached gets the same week to pay as a stage reached tomorrow.
    const r = await invoiceInstalment(ins.id, user.id, ins.dueOn ?? addDays(istToday(), STAGE_INVOICE_DAYS));
    if (!r.ok) continue;
    if (r.issued.ok) raised++;
    else drafts++;
  }
  refresh(student.id);
  const waiting = rows.length - raised - drafts;
  return {
    ok:
      `${plan.name} applied: ${rows.length} instalment${rows.length === 1 ? "" : "s"}, ${raised} invoiced now` +
      (drafts ? `, ${drafts} left as draft${drafts === 1 ? "" : "s"} for a GST rate` : "") +
      (waiting ? `, ${waiting} when the file reaches the stage or step.` : "."),
  };
}

/** Takes the rest of a schedule off: what is not yet invoiced is cancelled. Invoices already out stay. */
export async function cancelScheduleAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const student = await studentFor(user, String(fd.get("studentId") ?? ""));
  if (!student) return { error: NOT_YOURS };
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { fieldErrors: { reason: ["Say why, for the record"] }, error: "Check the highlighted fields." };
  const gone = await db.update(fs).set({ state: "CANCELLED" }).where(and(eq(fs.studentId, student.id), eq(fs.state, "SCHEDULED"))).returning({ id: fs.id });
  // Invoiced instalments are settled through their invoices; marking them done
  // lets a new plan go on while those invoices carry on.
  const left = await db.update(fs).set({ state: "CANCELLED" }).where(and(eq(fs.studentId, student.id), eq(fs.state, "INVOICED"))).returning({ id: fs.id });
  await audit(user.id, "fee_schedule.cancel", "student", student.id, { reason, cancelled: gone.length, closedWithInvoices: left.length });
  refresh(student.id);
  return { ok: gone.length ? `${gone.length} instalment${gone.length === 1 ? "" : "s"} taken off. Invoices already issued stay as they are.` : "Nothing was left to invoice. Invoices already issued stay as they are." };
}

/** Invoices one scheduled instalment now, ahead of its day or its stage. */
export async function raiseInstalmentAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const ins = await db.query.feeInstalments.findFirst({ where: eq(fs.id, String(fd.get("instalmentId") ?? "")) });
  if (!ins) return { error: "That instalment is not on record." };
  const student = await studentFor(user, ins.studentId);
  if (!student) return { error: NOT_YOURS };
  const dueOn = String(fd.get("dueOn") ?? "") || ins.dueOn || istToday();
  if (!isDay(dueOn)) return { fieldErrors: { dueOn: ["Enter a date"] }, error: "Check the highlighted fields." };
  const r = await invoiceInstalment(ins.id, user.id, dueOn);
  refresh(student.id);
  if (!r.ok) return { error: r.error };
  return r.issued.ok ? { ok: `Invoice ${r.issued.number} issued for ${rupees(r.issued.total)}.` } : { ok: `Raised as a draft: ${r.issued.error}` };
}

// ---------- Invoices ----------

/** An invoice by hand, for what no plan covers. Up to three lines. */
export async function createFeeInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const student = await studentFor(user, String(fd.get("studentId") ?? ""));
  if (!student) return { error: NOT_YOURS };
  const lines: { description: string; amount: number }[] = [];
  const fieldErrors: Record<string, string[]> = {};
  for (const n of [1, 2, 3]) {
    const description = String(fd.get(`description${n}`) ?? "").trim();
    const amount = wholeRupees(fd.get(`amount${n}`));
    if (!description && amount == null) continue;
    if (!description) fieldErrors[`description${n}`] = ["Say what it is for"];
    if (amount === "bad" || amount == null || amount <= 0) fieldErrors[`amount${n}`] = ["Whole rupees above nought"];
    else if (description) lines.push({ description: description.slice(0, 200), amount });
  }
  const gst = gstRate(fd.get("gstPercent"));
  if (gst === "bad") fieldErrors.gstPercent = ["A rate between 0 and 28, or leave it empty if it is not recorded"];
  const dueOn = String(fd.get("dueOn") ?? "");
  if (!isDay(dueOn)) fieldErrors.dueOn = ["When is it due?"];
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Check the highlighted fields." };
  if (!lines.length) return { fieldErrors: { description1: ["Add at least one line"] }, error: "Check the highlighted fields." };
  const draft = await createDraft(db, {
    studentId: student.id,
    orgId: await billingOrgId(student.orgId),
    lines,
    dueOn,
    gstPercent: gst as number | null,
    note: String(fd.get("note") ?? "").trim() || null,
    createdById: user.id,
  });
  await audit(user.id, "fee_invoice.raise", "fee_invoice", draft.id, { studentId: student.id, taxable: draft.taxable, byHand: true });
  if (fd.get("issueNow") === "on") {
    const r = await issueInvoice(draft.id, user.id);
    refresh(student.id);
    return r.ok ? { ok: `Invoice ${r.number} issued for ${rupees(r.total)}.` } : { ok: `Saved as a draft. ${r.error}` };
  }
  refresh(student.id);
  return { ok: "Saved as a draft." };
}

/** The GST rate on a draft. Empty is not recorded. */
export async function setDraftGstAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const found = await invoiceFor(user, String(fd.get("invoiceId") ?? ""));
  if (!found) return { error: NOT_YOURS };
  if (found.invoice.state !== "DRAFT") return { error: "The rate is fixed once an invoice is issued." };
  const gst = gstRate(fd.get("gstPercent"));
  if (gst === "bad") return { fieldErrors: { gstPercent: ["A rate between 0 and 28"] }, error: "Check the highlighted fields." };
  await db.update(fi).set({ gstPercent: gst, updatedAt: new Date() }).where(and(eq(fi.id, found.invoice.id), eq(fi.state, "DRAFT")));
  await audit(user.id, "fee_invoice.gst_rate", "fee_invoice", found.invoice.id, { from: found.invoice.gstPercent, to: gst });
  refresh(found.student.id);
  return { ok: gst == null ? "GST rate cleared." : `GST rate set to ${gst}%.` };
}

export async function issueFeeInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const found = await invoiceFor(user, String(fd.get("invoiceId") ?? ""));
  if (!found) return { error: NOT_YOURS };
  const r = await issueInvoice(found.invoice.id, user.id);
  refresh(found.student.id);
  return r.ok ? { ok: `Invoice ${r.number} issued for ${rupees(r.total)}.` } : { error: r.error };
}

/**
 * Cancels an invoice. A draft goes by whoever raised fees; an issued invoice
 * only by finance or the head office, and only while nothing is held on it:
 * money received is refunded first, so the books never show a cancelled
 * invoice with somebody's fee still sitting on it.
 */
export async function cancelFeeInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act && !access.desk) return { error: NO_ACT };
  const found = await invoiceFor(user, String(fd.get("invoiceId") ?? ""));
  if (!found) return { error: NOT_YOURS };
  const { invoice } = found;
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { fieldErrors: { reason: ["Say why, for the record"] }, error: "Check the highlighted fields." };
  // A paid invoice can be cancelled once everything on it has gone back (the
  // check on what is held follows), as the refusal below tells people to do.
  if (invoice.state === "CANCELLED" || invoice.state === "WRITTEN_OFF") return { error: "This invoice is already closed." };
  if (invoice.state !== "DRAFT" && !access.desk) return { error: "An issued invoice is cancelled by finance or the head office." };
  if (invoice.received - invoice.refunded > 0) return { error: `${rupees(invoice.received - invoice.refunded)} has been received on this invoice. Refund it first, then cancel.` };
  if ((await pendingRefunds(db, invoice.id)) > 0) return { error: "A refund on this invoice is still open. Settle it first." };
  // A link already with the student must not stay payable.
  const stale = await cancelLiveLinks(invoice.id);
  if (stale) return { error: stale };
  const [row] = await db
    .update(fi)
    .set({ state: "CANCELLED", closedReason: reason, closedById: user.id, closedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(fi.id, invoice.id), eq(fi.state, invoice.state)))
    .returning({ id: fi.id });
  if (!row) return { error: "The invoice changed a moment ago. Reload and look again." };
  // The instalment goes back on the schedule, to be raised again when it is right.
  await db.update(fs).set({ state: "SCHEDULED", invoiceId: null }).where(and(eq(fs.invoiceId, invoice.id), eq(fs.state, "INVOICED")));
  await audit(user.id, "fee_invoice.cancel", "fee_invoice", invoice.id, { number: invoice.number, from: invoice.state, reason });
  refresh(found.student.id);
  return { ok: invoice.number ? `${invoice.number} cancelled.` : "Draft cancelled." };
}

/** Writes off what is left on an issued invoice. Finance or the head office, with a reason. */
export async function writeOffFeeInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.desk) return { error: DESK_ONLY };
  const found = await invoiceFor(user, String(fd.get("invoiceId") ?? ""));
  if (!found) return { error: NOT_YOURS };
  const { invoice } = found;
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 3) return { fieldErrors: { reason: ["Say why, for the record"] }, error: "Check the highlighted fields." };
  if (invoice.state !== "ISSUED" && invoice.state !== "PART_PAID") return { error: "Only an issued invoice with money still due can be written off." };
  const [row] = await db
    .update(fi)
    .set({ state: "WRITTEN_OFF", closedReason: reason, closedById: user.id, closedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(fi.id, invoice.id), inArray(fi.state, ["ISSUED", "PART_PAID"])))
    .returning({ id: fi.id });
  if (!row) return { error: "The invoice changed a moment ago. Reload and look again." };
  await cancelLiveLinks(invoice.id);
  await audit(user.id, "fee_invoice.write_off", "fee_invoice", invoice.id, { number: invoice.number, balance: balanceDue(invoice.total, invoice.received), reason });
  refresh(found.student.id);
  return { ok: `${invoice.number} written off.` };
}

// ---------- Receipts and links ----------

export async function recordFeeReceiptAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const found = await invoiceFor(user, String(fd.get("invoiceId") ?? ""));
  if (!found) return { error: NOT_YOURS };
  const method = String(fd.get("method") ?? "") as FeeMethod;
  const amount = wholeRupees(fd.get("amount"));
  const reference = String(fd.get("reference") ?? "").trim() || null;
  const today = istToday();
  const receivedOn = String(fd.get("receivedOn") ?? "") || today;
  const fieldErrors: Record<string, string[]> = {};
  if (!COUNTER_METHODS.includes(method)) fieldErrors.method = ["How was it paid?"];
  if (amount === "bad" || amount == null) fieldErrors.amount = ["Whole rupees above nought"];
  if (method !== "CASH" && !reference) fieldErrors.reference = ["The UPI, card or bank reference, so it can be matched"];
  if (!isDay(receivedOn) || receivedOn > today) fieldErrors.receivedOn = ["A day up to today"];
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Check the highlighted fields." };
  const r = await recordReceipt({ invoiceId: found.invoice.id, amount: amount as number, method, reference, receivedOn, recordedById: user.id, note: String(fd.get("note") ?? "").trim() || null });
  if (!r.ok) return { error: r.error };
  // A link sent earlier asks for the old balance; it goes, and a new one can be sent for what is left.
  await cancelLiveLinks(found.invoice.id);
  await audit(user.id, "fee_receipt.record", "fee_invoice", found.invoice.id, { receipt: r.number, amount, method, reference, receivedOn });
  refresh(found.student.id);
  return { ok: `Receipt ${r.number} for ${rupees(amount as number)}.` };
}

export async function sendFeeLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const found = await invoiceFor(user, String(fd.get("invoiceId") ?? ""));
  if (!found) return { error: NOT_YOURS };
  const r = await createPaymentLink(found.invoice.id, user.id);
  refresh(found.student.id);
  return r.ok ? { ok: `Payment link ready: ${r.url}. The student also sees it in their portal.`, keep: true } : { error: r.error };
}

// ---------- Refunds ----------

/** Asks for money to go back to a student. Somebody else decides. */
export async function requestFeeRefundAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.act) return { error: NO_ACT };
  const found = await invoiceFor(user, String(fd.get("invoiceId") ?? ""));
  if (!found) return { error: NOT_YOURS };
  const amount = wholeRupees(fd.get("amount"));
  const reason = String(fd.get("reason") ?? "").trim();
  const fieldErrors: Record<string, string[]> = {};
  if (amount === "bad" || amount == null || amount <= 0) fieldErrors.amount = ["Whole rupees above nought"];
  if (reason.length < 5) fieldErrors.reason = ["Why the money is going back"];
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Check the highlighted fields." };
  const code = await ensureBranchCode(found.invoice.orgId);
  const today = istToday();
  const made = await db.transaction(async (tx) => {
    // Locked, so two requests at once cannot both fit in the same room.
    await tx.select({ id: fi.id }).from(fi).where(eq(fi.id, found.invoice.id)).for("update");
    const [inv] = await tx.select().from(fi).where(eq(fi.id, found.invoice.id));
    const room = refundRoom(inv.received, inv.refunded, await pendingRefunds(tx, inv.id));
    if ((amount as number) > room) return { error: room > 0 ? `Up to ${rupees(room)} can be refunded on this invoice.` : "Nothing received on this invoice is left to refund." };
    const number = await nextNumber(tx, "RFD", inv.orgId, code, today);
    const [row] = await tx
      .insert(rf)
      .values({ number, invoiceId: inv.id, studentId: inv.studentId, orgId: inv.orgId, amount: amount as number, reason, requestedById: user.id })
      .returning({ id: rf.id });
    return { id: row.id, number };
  });
  if ("error" in made) return { error: made.error };
  await audit(user.id, "fee_refund.request", "fee_refund", made.id, { number: made.number, invoice: found.invoice.number, amount, reason });
  const desk = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.role, "FINANCE"), eq(schema.users.active, true)));
  await notifyUsers([...desk.map((d) => d.id), ...(await adminIds())].filter((id) => id !== user.id), `Refund ${made.number} waiting for a decision`, `${rupees(amount as number)} on ${found.invoice.number}: ${reason}`, "/fees/refunds");
  refresh(found.student.id);
  return { ok: `Refund ${made.number} requested. Finance or the head office decides it.` };
}

/**
 * Approves or rejects a refund. Finance or the head office, and never the
 * person who asked for it: the same pair of hands does not ask for money to
 * leave and agree that it should.
 */
export async function decideFeeRefundAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.desk) return { error: DESK_ONLY };
  const refund = await db.query.feeRefunds.findFirst({ where: eq(rf.id, String(fd.get("refundId") ?? "")) });
  if (!refund) return { error: "That refund is not on record." };
  if (!(await studentFor(user, refund.studentId))) return { error: NOT_YOURS };
  if (refund.requestedById === user.id) return { error: "You asked for this refund, so somebody else decides it." };
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  if (decision !== "APPROVED" && decision !== "REJECTED") return { error: "Approve it or reject it." };
  if (decision === "REJECTED" && !note) return { fieldErrors: { note: ["Say why it is rejected"] }, error: "Check the highlighted fields." };
  const [row] = await db
    .update(rf)
    .set({ state: decision, decidedById: user.id, decidedAt: new Date(), decisionNote: note })
    .where(and(eq(rf.id, refund.id), eq(rf.state, "REQUESTED")))
    .returning({ id: rf.id });
  if (!row) return { error: "This refund has already been decided." };
  await audit(user.id, decision === "APPROVED" ? "fee_refund.approve" : "fee_refund.reject", "fee_refund", refund.id, { number: refund.number, amount: refund.amount, note, requestedById: refund.requestedById });
  await notifyUsers([refund.requestedById], `Refund ${refund.number} ${decision === "APPROVED" ? "approved" : "rejected"}`, note ?? undefined, `/students/${refund.studentId}/fees`);
  refresh(refund.studentId);
  return { ok: `Refund ${refund.number} ${decision === "APPROVED" ? "approved. Record the payout once the money has gone." : "rejected."}` };
}

/**
 * The money has gone back: the payout reference goes on the refund and the
 * invoice's received and fee both come down by the amount, so its balance
 * still reads true.
 */
export async function payFeeRefundAction(_: FormState, fd: FormData): Promise<FormState> {
  const { user, access } = await actor();
  if (!access.desk) return { error: DESK_ONLY };
  const refund = await db.query.feeRefunds.findFirst({ where: eq(rf.id, String(fd.get("refundId") ?? "")) });
  if (!refund) return { error: "That refund is not on record." };
  if (!(await studentFor(user, refund.studentId))) return { error: NOT_YOURS };
  const method = String(fd.get("method") ?? "") as FeeMethod;
  const reference = String(fd.get("reference") ?? "").trim();
  const fieldErrors: Record<string, string[]> = {};
  if (!COUNTER_METHODS.includes(method)) fieldErrors.method = ["How did it go back?"];
  if (reference.length < 3) fieldErrors.reference = ["The bank, UPI or cash voucher reference"];
  if (Object.keys(fieldErrors).length) return { fieldErrors, error: "Check the highlighted fields." };
  const done = await db.transaction(async (tx) => {
    await tx.select({ id: fi.id }).from(fi).where(eq(fi.id, refund.invoiceId)).for("update");
    const [inv] = await tx.select().from(fi).where(eq(fi.id, refund.invoiceId));
    if (inv.received - inv.refunded < refund.amount) return { error: "Less is held on this invoice than the refund. Look at the invoice again." };
    const [row] = await tx
      .update(rf)
      .set({ state: "PAID", payoutMethod: method, payoutReference: reference, paidById: user.id, paidAt: new Date() })
      .where(and(eq(rf.id, refund.id), eq(rf.state, "APPROVED")))
      .returning({ id: rf.id });
    if (!row) return { error: "Only an approved refund can be paid out." };
    await tx.update(fi).set({ refunded: inv.refunded + refund.amount, updatedAt: new Date() }).where(eq(fi.id, inv.id));
    return { ok: true as const };
  });
  if ("error" in done) return { error: done.error };
  await audit(user.id, "fee_refund.pay", "fee_refund", refund.id, { number: refund.number, amount: refund.amount, method, reference, invoiceId: refund.invoiceId });
  refresh(refund.studentId);
  return { ok: `Refund ${refund.number} paid out. The invoice now shows it.` };
}
