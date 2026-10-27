import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_ROLES, DOCUMENTATION_ROLES } from "@/lib/permissions";
import {
  STAGE_INVOICE_DAYS,
  addDays,
  balanceDue,
  feeDocNumber,
  fyOf,
  fyStartYear,
  gstFor,
  istToday,
  receiptProblem,
  seriesScope,
  stateAfterReceipts,
  stateFromGstin,
  type DocKind,
  type FeeInvoiceState,
  type FeeMethod,
} from "@/lib/student-fees";
import type { JourneyStage } from "@/db/schema";
import { stepOfStatus } from "@/lib/ausbildung";
import type { NclexStepKey } from "@/lib/nclex";
import { FSJ_FEE_PATHWAY, feeStepReached, type StepProgress } from "@/lib/fee-steps";
import { fsjStepOf } from "@/lib/fsj";
import { can } from "@/server/capabilities";
import { ensureBranchCode } from "@/server/medcity-id";
import { mayOpenStudent, studentWhere } from "@/server/scope";
import { razorpayConfig } from "@/server/razorpay";
import { notifyUsers, partnerRecipients } from "@/server/notify";
import { tellDeskIfFsjFeesIn } from "@/server/fsj-fees";

const { feeInvoices: fi, feeInvoiceLines: fl, feeInstalments: fs, feeReceipts: fr, feeRefunds: rf, feePaymentLinks: pl, students: st, organizations: og } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

// ---------- Who may do what ----------

/** The head office's money people: they keep the plans, close invoices and decide refunds. */
export const FEE_DESK_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "FINANCE"] as const;
export const isFeeDesk = (user: Pick<SessionUser, "role">) => (FEE_DESK_ROLES as readonly string[]).includes(user.role);

export type FeeAccess = { read: boolean; act: boolean; desk: boolean };

/**
 * What this person may do with students' fees.
 *
 * Reading follows the student: whoever may open a student may read their
 * fees, except the documentation desk, which checks paper and is kept away
 * from money the way it is on the income sheet. Acting is the Collect fees
 * capability. The desk is finance and the head office.
 */
export async function feeAccess(user: SessionUser): Promise<FeeAccess> {
  const read = (APP_ROLES as readonly string[]).includes(user.role) && !(DOCUMENTATION_ROLES as readonly string[]).includes(user.role);
  // A sub-agent refers students and does not bill them: Medcity's branch or
  // head office raises the invoice, so a sub-agent's people read and never act.
  const act = read && user.orgType !== "SUB_AGENT" && (await can(user, "COLLECT_FEES"));
  return { read, act, desk: isFeeDesk(user) };
}

/** For the fee screens: signed in, and allowed to read students' fees, or sent away. */
export async function requireFees() {
  const user = await requireUser([...APP_ROLES]);
  const access = await feeAccess(user);
  if (!access.read) redirect("/forbidden");
  return { user, access };
}

/** The condition every fee list carries: the students this person may see, nothing else. */
export const feeListScope = (user: SessionUser): Promise<SQL | undefined> => studentWhere(user);

/** One student, if this person may open them. Null otherwise, so an action can answer in words. */
export async function studentFor(user: SessionUser, studentId: string) {
  const student = await db.query.students.findFirst({ where: eq(st.id, studentId), with: { org: true } });
  if (!student) return null;
  if (!(await mayOpenStudent(user, student))) return null;
  return student;
}

/** One invoice and its student, if this person may open the student. */
export async function invoiceFor(user: SessionUser, invoiceId: string) {
  const invoice = await db.query.feeInvoices.findFirst({ where: eq(fi.id, invoiceId) });
  if (!invoice) return null;
  const student = await studentFor(user, invoice.studentId);
  if (!student) return null;
  return { invoice, student };
}

/**
 * The organisation that bills a student: their own branch or the head office,
 * or for a sub-agent's student the branch that recruited the sub-agent, and
 * the head office where none did. A sub-agent does not issue Medcity's invoices.
 */
export async function billingOrgId(studentOrgId: string): Promise<string> {
  const org = await db.query.organizations.findFirst({ where: eq(og.id, studentOrgId), columns: { id: true, type: true, parentOrgId: true } });
  if (!org || org.type !== "SUB_AGENT") return studentOrgId;
  if (org.parentOrgId) return org.parentOrgId;
  const hq = await db.query.organizations.findFirst({ where: eq(og.type, "HQ"), columns: { id: true } });
  return hq?.id ?? studentOrgId;
}

// ---------- Numbers ----------

/**
 * The next number in a series, taken inside the caller's transaction so a
 * rolled-back invoice gives its number back rather than leaving a gap.
 */
export async function nextNumber(tx: Tx, kind: DocKind, orgId: string, branchCode: string, day: string) {
  const c = schema.idCounters;
  const [row] = await tx
    .insert(c)
    .values({ scope: seriesScope(kind, orgId), year: fyStartYear(day), used: 1 })
    .onConflictDoUpdate({ target: [c.scope, c.year], set: { used: sql`${c.used} + 1`, updatedAt: new Date() } })
    .returning({ used: c.used });
  return feeDocNumber(kind, branchCode, fyOf(day), row.used);
}

// ---------- Invoices ----------

export type NewLine = { description: string; amount: number; instalmentId?: string | null };

/** A draft invoice. Its total waits for the issue, where the tax is worked out. */
export async function createDraft(
  exec: Exec,
  input: { studentId: string; orgId: string; lines: NewLine[]; dueOn: string | null; gstPercent: number | null; note: string | null; createdById: string | null; currency?: string },
) {
  const taxable = input.lines.reduce((s, l) => s + l.amount, 0);
  const [row] = await exec
    .insert(fi)
    .values({
      orgId: input.orgId,
      studentId: input.studentId,
      currency: input.currency ?? "INR",
      dueOn: input.dueOn,
      gstPercent: input.gstPercent,
      taxable,
      note: input.note,
      createdById: input.createdById,
    })
    .returning();
  await exec.insert(fl).values(input.lines.map((l) => ({ invoiceId: row.id, description: l.description, amount: l.amount, instalmentId: l.instalmentId ?? null })));
  return row;
}

class Raced extends Error {}

export type IssueResult = { ok: true; number: string; total: number } | { ok: false; error: string };

/**
 * Gives a draft its number, its seller and its tax, and sends it out.
 *
 * The seller's GSTIN and state are copied onto the invoice as they are today,
 * so the document reads the same next year whatever changes on the
 * organisation. With a GSTIN and no GST rate recorded the draft stays a
 * draft: a tax invoice with a guessed rate is worse than none.
 */
export async function issueInvoice(invoiceId: string, actorId: string | null, today = istToday()): Promise<IssueResult> {
  const invoice = await db.query.feeInvoices.findFirst({ where: eq(fi.id, invoiceId) });
  if (!invoice) return { ok: false, error: "That invoice is not on record." };
  if (invoice.state !== "DRAFT") return { ok: false, error: "Only a draft can be issued." };
  const [org, student] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(og.id, invoice.orgId) }),
    db.query.students.findFirst({ where: eq(st.id, invoice.studentId) }),
  ]);
  if (!org || !student) return { ok: false, error: "The student or the branch is no longer on record." };
  if (invoice.taxable <= 0) return { ok: false, error: "An invoice needs at least one line with an amount." };
  const sellerState = org.gstin ? (stateFromGstin(org.gstin) ?? org.state) : org.state;
  const tax = gstFor(invoice.taxable, invoice.gstPercent, { gstin: org.gstin, state: sellerState }, student.state);
  if (tax.total == null) {
    return { ok: false, error: `${org.name} has GSTIN ${org.gstin} on record and this invoice has no GST rate. Record the rate on the draft, then issue it.` };
  }
  const dueOn = invoice.dueOn ?? today;
  const code = await ensureBranchCode(org.id);
  const done = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, "INV", org.id, code, today);
    const [row] = await tx
      .update(fi)
      .set({
        number,
        state: "ISSUED",
        kind: tax.kind,
        issuedOn: today,
        dueOn,
        sellerName: org.name,
        sellerGstin: org.gstin,
        sellerState,
        sellerAddress: org.addressLine,
        placeOfSupply: tax.kind === "TAX_INVOICE" ? (tax.interState ? tax.buyerState : sellerState) : null,
        gstPercent: tax.kind === "TAX_INVOICE" ? tax.percent : null,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        total: tax.total,
        issuedById: actorId,
        updatedAt: new Date(),
      })
      .where(and(eq(fi.id, invoiceId), eq(fi.state, "DRAFT")))
      .returning({ id: fi.id });
    // Somebody issued it a moment ago: give the number back.
    if (!row) throw new Raced();
    return { number, total: tax.total! };
  }).catch((e) => {
    if (e instanceof Raced) return null;
    throw e;
  });
  if (!done) return { ok: false, error: "Somebody issued this invoice a moment ago." };
  await audit(actorId, "fee_invoice.issue", "fee_invoice", invoiceId, { number: done.number, total: done.total, kind: tax.kind, gstPercent: tax.percent, studentId: invoice.studentId });
  return { ok: true, ...done };
}

/** Everything on one invoice: lines, receipts, refunds, links. */
export async function loadInvoice(invoiceId: string) {
  const invoice = await db.query.feeInvoices.findFirst({ where: eq(fi.id, invoiceId) });
  if (!invoice) return null;
  const [lines, receipts, refunds, links, student, org] = await Promise.all([
    db.select().from(fl).where(eq(fl.invoiceId, invoiceId)).orderBy(asc(fl.description)),
    db.select().from(fr).where(eq(fr.invoiceId, invoiceId)).orderBy(asc(fr.createdAt)),
    db.select().from(rf).where(eq(rf.invoiceId, invoiceId)).orderBy(asc(rf.createdAt)),
    db.select().from(pl).where(eq(pl.invoiceId, invoiceId)).orderBy(desc(pl.createdAt)),
    db.query.students.findFirst({ where: eq(st.id, invoice.studentId) }),
    db.query.organizations.findFirst({ where: eq(og.id, invoice.orgId) }),
  ]);
  return { invoice, lines, receipts, refunds, links, student: student!, org: org! };
}

// ---------- Receipts ----------

export type ReceiptInput = {
  invoiceId: string;
  amount: number;
  method: FeeMethod;
  reference: string | null;
  receivedOn: string;
  recordedById: string | null;
  note?: string | null;
  razorpayPaymentId?: string | null;
};

export type ReceiptResult = { ok: true; id: string; number: string; state: FeeInvoiceState; over: number } | { ok: false; error: string; duplicate?: boolean };

/**
 * Records money against an invoice, with its own number.
 *
 * The invoice row is locked while its balance is read and the receipt is
 * written, so two people at two counters cannot take it past what is due. A
 * receipt from Razorpay is recorded whatever the balance, because the money
 * has already moved; anything above the balance is named in the audit log
 * for finance to send back. The same Razorpay payment is recorded once.
 */
export async function recordReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  const result = await writeReceipt(input);
  // Paid in full: an FSJ / BFD file waiting at its payment check may now start.
  if (result.ok && result.state === "PAID") {
    const inv = await db.query.feeInvoices.findFirst({ where: eq(fi.id, input.invoiceId), columns: { studentId: true } });
    if (inv) await tellDeskIfFsjFeesIn(inv.studentId, input.invoiceId);
  }
  return result;
}

async function writeReceipt(input: ReceiptInput): Promise<ReceiptResult> {
  const fromGateway = input.method === "RAZORPAY";
  const head = await db.query.feeInvoices.findFirst({ where: eq(fi.id, input.invoiceId), columns: { orgId: true } });
  if (!head) return { ok: false, error: "That invoice is not on record." };
  const code = await ensureBranchCode(head.orgId);
  try {
    return await db.transaction(async (tx) => {
      if (input.razorpayPaymentId) {
        const seen = await tx.select({ id: fr.id }).from(fr).where(eq(fr.razorpayPaymentId, input.razorpayPaymentId)).limit(1);
        if (seen.length) return { ok: false as const, error: "That payment is already recorded.", duplicate: true };
      }
      await tx.execute(sql`select id from fee_invoices where id = ${input.invoiceId} for update`);
      const [inv] = await tx.select().from(fi).where(eq(fi.id, input.invoiceId));
      if (!fromGateway && inv.state !== "ISSUED" && inv.state !== "PART_PAID") {
        return { ok: false as const, error: inv.state === "DRAFT" ? "Issue the invoice before taking money against it." : "This invoice is closed, so nothing more is received against it." };
      }
      const due = balanceDue(inv.total, inv.received);
      if (!fromGateway) {
        const problem = receiptProblem(input.amount, due);
        if (problem) return { ok: false as const, error: problem };
      }
      const number = await nextNumber(tx, "RCT", inv.orgId, code, input.receivedOn);
      const [row] = await tx
        .insert(fr)
        .values({
          number,
          invoiceId: inv.id,
          studentId: inv.studentId,
          orgId: inv.orgId,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
          receivedOn: input.receivedOn,
          razorpayPaymentId: input.razorpayPaymentId ?? null,
          note: input.note ?? null,
          recordedById: input.recordedById,
        })
        .returning({ id: fr.id });
      const received = inv.received + input.amount;
      const state = stateAfterReceipts(inv.state, inv.total, received);
      await tx.update(fi).set({ received, state, updatedAt: new Date() }).where(eq(fi.id, inv.id));
      // Money on a cancelled invoice is owed back in full: nothing was due on it.
      const over = inv.state === "CANCELLED" || inv.state === "DRAFT" ? input.amount : due == null ? 0 : Math.max(0, input.amount - due);
      return { ok: true as const, id: row.id, number, state, over };
    });
  } catch (e) {
    // Two deliveries of the same webhook at once: the unique index answers.
    if (input.razorpayPaymentId && /fee_receipts_razorpay_uq/.test(String((e as Error).message ?? e))) return { ok: false, error: "That payment is already recorded.", duplicate: true };
    throw e;
  }
}

// ---------- Schedules ----------

/** Raises and issues the invoice for one scheduled instalment, once. */
export async function invoiceInstalment(instalmentId: string, actorId: string | null, dueOn: string | null): Promise<{ ok: true; invoiceId: string; issued: IssueResult } | { ok: false; error: string }> {
  const claimed = await db.transaction(async (tx) => {
    const [ins] = await tx
      .update(fs)
      .set({ state: "INVOICED" })
      .where(and(eq(fs.id, instalmentId), eq(fs.state, "SCHEDULED")))
      .returning();
    if (!ins) return null;
    const count = await tx.select({ n: sql<number>`count(*)::int` }).from(fs).where(and(eq(fs.studentId, ins.studentId), eq(fs.planName, ins.planName), ne(fs.state, "CANCELLED")));
    const draft = await createDraft(tx, {
      studentId: ins.studentId,
      orgId: ins.orgId,
      lines: [{ description: `${ins.label} (instalment ${ins.seq} of ${count[0]?.n ?? ins.seq}, ${ins.planName})`, amount: ins.amount, instalmentId: ins.id }],
      dueOn: dueOn ?? ins.dueOn,
      gstPercent: ins.gstPercent,
      note: null,
      createdById: actorId,
      currency: ins.currency,
    });
    await tx.update(fs).set({ invoiceId: draft.id }).where(eq(fs.id, ins.id));
    return draft;
  });
  if (!claimed) return { ok: false, error: "That instalment has already been invoiced." };
  await audit(actorId, "fee_invoice.raise", "fee_invoice", claimed.id, { studentId: claimed.studentId, instalmentId, taxable: claimed.taxable });
  const issued = await issueInvoice(claimed.id, actorId);
  return { ok: true, invoiceId: claimed.id, issued };
}

/** Where a student's file stands on each pathway, for deciding which instalments have fallen due. */
export type FileProgress = StepProgress;

type WaitingRow = { stepPathway: string | null; stepKey: string | null };

/** Whether a scheduled instalment tied to a stage or a step has been reached by the file as it stands. */
export const reachedBy = (row: WaitingRow, at: FileProgress): boolean => feeStepReached(row.stepPathway, row.stepKey, at);

/**
 * The furthest step of the Ausbildung guide any of the student's Ausbildung
 * applications is at, read off their statuses. Null when there is none, or
 * none at a step the guide places.
 */
export async function currentAusbildungStep(studentId: string): Promise<number | null> {
  const rows = await db
    .select({ code: schema.statusDefinitions.code })
    .from(schema.applications)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.applications.programId))
    .innerJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, schema.applications.statusId))
    .where(and(eq(schema.applications.studentId, studentId), eq(schema.programs.pathway, "AUSBILDUNG")));
  const steps = rows.map((r) => stepOfStatus(r.code)?.step).filter((n): n is number => n != null);
  return steps.length ? Math.max(...steps) : null;
}

/**
 * The furthest step of the FSJ / BFD process any of the student's FSJ or BFD
 * applications is at, read off their statuses. Null when there is none, or
 * none at a step the process places.
 */
export async function currentFsjStep(studentId: string): Promise<number | null> {
  const rows = await db
    .select({ code: schema.statusDefinitions.code })
    .from(schema.applications)
    .innerJoin(schema.programs, eq(schema.programs.id, schema.applications.programId))
    .innerJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, schema.applications.statusId))
    .where(and(eq(schema.applications.studentId, studentId), inArray(schema.programs.pathway, ["FSJ", "BFD"])));
  const steps = rows.map((r) => fsjStepOf(r.code)?.step).filter((n): n is number => n != null);
  return steps.length ? Math.max(...steps) : null;
}

/** The NCLEX-RN steps completed on the student's file. */
export async function completedNclexSteps(studentId: string): Promise<NclexStepKey[]> {
  const rows = await db
    .select({ step: schema.nclexSteps.step })
    .from(schema.nclexSteps)
    .where(and(eq(schema.nclexSteps.studentId, studentId), eq(schema.nclexSteps.completed, true)));
  return rows.map((r) => r.step as NclexStepKey);
}

/** Where the file stands now, on every pathway an instalment can wait on. */
export async function fileProgress(studentId: string): Promise<FileProgress> {
  const [student, ausbildungStep, nclexCompleted, fsjStep] = await Promise.all([
    db.query.students.findFirst({ where: eq(st.id, studentId), columns: { journeyStage: true } }),
    currentAusbildungStep(studentId),
    completedNclexSteps(studentId),
    currentFsjStep(studentId),
  ]);
  return {
    JOURNEY: student?.journeyStage ? [student.journeyStage] : [],
    AUSBILDUNG: ausbildungStep != null ? [String(ausbildungStep)] : [],
    NCLEX: nclexCompleted,
    [FSJ_FEE_PATHWAY]: fsjStep != null ? [String(fsjStep)] : [],
  };
}

/**
 * The file has moved on: a journey stage, an Ausbildung status, a completed
 * NCLEX-RN step or an FSJ / BFD status. Every scheduled instalment the file has now reached is
 * invoiced, due in a week. Called from the move itself, so nobody has to
 * remember to. The move has already happened when this runs; a failure here
 * is logged and left for "Invoice now" on the schedule, rather than failing
 * the move.
 */
async function raiseReached(studentId: string, at: FileProgress, actorId: string | null, what: string) {
  try {
    const waiting = await db
      .select({ id: fs.id, stepPathway: fs.stepPathway, stepKey: fs.stepKey })
      .from(fs)
      .where(and(eq(fs.studentId, studentId), eq(fs.state, "SCHEDULED"), isNotNull(fs.stepPathway), isNotNull(fs.stepKey)))
      .orderBy(asc(fs.seq));
    const due = addDays(istToday(), STAGE_INVOICE_DAYS);
    const raised: string[] = [];
    for (const w of waiting) {
      if (!reachedBy(w, at)) continue;
      const r = await invoiceInstalment(w.id, actorId, due);
      if (r.ok) raised.push(r.invoiceId);
    }
    if (raised.length) {
      const student = await db.query.students.findFirst({ where: eq(st.id, studentId), columns: { orgId: true, assignedToId: true, firstName: true, lastName: true } });
      if (student) {
        await notifyUsers(
          await partnerRecipients(student.orgId, student.assignedToId),
          `${student.firstName} ${student.lastName}: ${raised.length} fee invoice${raised.length === 1 ? "" : "s"} raised on reaching ${what}`,
          "Due in a week. The student sees it in their portal.",
          `/students/${studentId}/fees`,
        );
      }
    }
    return raised.length;
  } catch (e) {
    console.error("fees: instalments not raised", studentId, what, e);
    return 0;
  }
}

/**
 * The file moved on one pathway: instalments tied to the step reached, or to
 * a step before it, fall due. Any pathway listed in src/lib/fee-steps.ts can
 * call this with its own keys.
 */
export const raiseStepInstalments = (studentId: string, pathway: string, reached: readonly string[], actorId: string | null, what: string) =>
  raiseReached(studentId, { [pathway]: reached }, actorId, what);

/** The journey stage moved. */
export const raiseStageInstalments = (studentId: string, stage: JourneyStage, actorId: string | null) => raiseStepInstalments(studentId, "JOURNEY", [stage], actorId, "the stage");

/** An Ausbildung application reached a step of the guide. */
export const raiseAusbildungInstalments = (studentId: string, step: number, actorId: string | null) =>
  raiseStepInstalments(studentId, "AUSBILDUNG", [String(step)], actorId, `Ausbildung step ${step}`);

/** An NCLEX-RN step was completed. */
export const raiseNclexInstalments = (studentId: string, step: NclexStepKey, actorId: string | null) =>
  raiseStepInstalments(studentId, "NCLEX", [step], actorId, "an NCLEX-RN step");

/** An FSJ or BFD application reached a step of the written process. */
export const raiseFsjInstalments = (studentId: string, step: number, actorId: string | null) =>
  raiseStepInstalments(studentId, FSJ_FEE_PATHWAY, [String(step)], actorId, `FSJ / BFD step ${step}`);

/** One student's schedule, invoices, receipts and refunds, for their fees tab. */
export async function studentFees(studentId: string) {
  const [instalments, invoices, receipts, refunds, links] = await Promise.all([
    db.select().from(fs).where(eq(fs.studentId, studentId)).orderBy(asc(fs.createdAt), asc(fs.seq)),
    db.select().from(fi).where(eq(fi.studentId, studentId)).orderBy(desc(fi.createdAt)),
    db
      .select({ r: fr, invoiceNumber: fi.number, by: schema.users.name })
      .from(fr)
      .innerJoin(fi, eq(fi.id, fr.invoiceId))
      .leftJoin(schema.users, eq(schema.users.id, fr.recordedById))
      .where(eq(fr.studentId, studentId))
      .orderBy(desc(fr.createdAt)),
    db
      .select({ r: rf, invoiceNumber: fi.number, by: schema.users.name })
      .from(rf)
      .innerJoin(fi, eq(fi.id, rf.invoiceId))
      .leftJoin(schema.users, eq(schema.users.id, rf.requestedById))
      .where(eq(rf.studentId, studentId))
      .orderBy(desc(rf.createdAt)),
    db.select({ l: pl }).from(pl).innerJoin(fi, eq(fi.id, pl.invoiceId)).where(and(eq(fi.studentId, studentId), eq(pl.state, "CREATED"))),
  ]);
  const lines = invoices.length ? await db.select().from(fl).where(inArray(fl.invoiceId, invoices.map((i) => i.id))) : [];
  return { instalments, invoices, receipts, refunds, lines, links: links.map((x) => x.l) };
}

/** Refunds requested or approved and not yet paid, against one invoice. */
export async function pendingRefunds(exec: Exec, invoiceId: string) {
  const [row] = await exec
    .select({ n: sql<number>`coalesce(sum(${rf.amount}), 0)::int` })
    .from(rf)
    .where(and(eq(rf.invoiceId, invoiceId), inArray(rf.state, ["REQUESTED", "APPROVED"])));
  return Number(row?.n ?? 0);
}

// ---------- Payment links ----------

const apiBase = () => (process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com").replace(/\/$/, "");

/**
 * A Razorpay payment link for what is due now. One live link per invoice: an
 * older one is cancelled at Razorpay first, so a student holding two links
 * cannot pay twice. Off while Razorpay is off, as it is everywhere else.
 */
export async function createPaymentLink(invoiceId: string, actorId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const cfg = await razorpayConfig();
  if (!cfg?.enabled) return { ok: false, error: "Online payments are not switched on, so there is no payment link to send. Take the fee at the counter." };
  const data = await loadInvoice(invoiceId);
  if (!data) return { ok: false, error: "That invoice is not on record." };
  const { invoice, student } = data;
  if (invoice.state !== "ISSUED" && invoice.state !== "PART_PAID") return { ok: false, error: "A payment link is only for an issued invoice with money still due." };
  const due = balanceDue(invoice.total, invoice.received);
  if (!due) return { ok: false, error: "Nothing is due on this invoice." };
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`;
  const stale = await cancelLiveLinks(invoiceId);
  if (stale) return { ok: false, error: stale };
  let link: { id?: string; short_url?: string; error?: { description?: string } };
  try {
    const res = await fetch(`${apiBase()}/v1/payment_links`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({
        amount: due * 100,
        currency: invoice.currency,
        description: `${invoice.number} for ${student.firstName} ${student.lastName}`.slice(0, 2048),
        reference_id: `${invoice.number}-${Date.now().toString(36)}`.slice(0, 40),
        customer: { name: `${student.firstName} ${student.lastName}`, contact: student.phone, ...(student.email ? { email: student.email } : {}) },
        notify: { sms: false, email: false },
        notes: { feeInvoiceId: invoice.id, invoice: invoice.number ?? "" },
      }),
      signal: AbortSignal.timeout(15000),
    });
    link = (await res.json().catch(() => ({}))) as typeof link;
    if (!res.ok || !link.id || !link.short_url) return { ok: false, error: `Razorpay could not make the link: ${link.error?.description ?? `it answered ${res.status}`}` };
  } catch (e) {
    return { ok: false, error: `Razorpay could not be reached: ${(e as Error).message}` };
  }
  await db.insert(pl).values({ invoiceId, razorpayLinkId: link.id, url: link.short_url, amount: due, createdById: actorId });
  await audit(actorId, "fee_link.create", "fee_invoice", invoiceId, { linkId: link.id, amount: due });
  return { ok: true, url: link.short_url };
}

/**
 * Cancels the live payment links on an invoice, at Razorpay and here. Answers
 * with a reason when Razorpay says the link was already paid, so nothing is
 * closed over money that is on its way.
 */
export async function cancelLiveLinks(invoiceId: string): Promise<string | null> {
  const open = await db.select().from(pl).where(and(eq(pl.invoiceId, invoiceId), eq(pl.state, "CREATED")));
  if (!open.length) return null;
  const cfg = await razorpayConfig();
  for (const l of open) {
    if (cfg) {
      const res = await fetch(`${apiBase()}/v1/payment_links/${l.razorpayLinkId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}` },
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);
      const body = res && !res.ok ? await res.text().catch(() => "") : "";
      if (res && !res.ok && /paid/i.test(body)) return "The student seems to have paid the payment link already. Wait for Razorpay to confirm it.";
    }
    await db.update(pl).set({ state: "CANCELLED" }).where(eq(pl.id, l.id));
  }
  return null;
}

/**
 * Razorpay says a payment link was paid: record the receipt against its
 * invoice, once, whatever the webhook does next.
 */
export async function markPaymentLinkPaid(linkId: string, paymentId: string, amountMinor: number) {
  const link = await db.query.feePaymentLinks.findFirst({ where: eq(pl.razorpayLinkId, linkId) });
  if (!link) return false;
  const amount = Math.round(amountMinor / 100);
  if (!(amount > 0)) {
    console.error("fees: payment link paid with no amount", linkId, paymentId, amountMinor);
    return false;
  }
  const r = await recordReceipt({ invoiceId: link.invoiceId, amount, method: "RAZORPAY", reference: paymentId, receivedOn: istToday(), recordedById: null, razorpayPaymentId: paymentId });
  await db.update(pl).set({ state: "PAID", paidAt: new Date() }).where(and(eq(pl.id, link.id), ne(pl.state, "PAID")));
  if (r.ok) {
    await audit(null, "fee_receipt.razorpay", "fee_invoice", link.invoiceId, { receipt: r.number, amount, paymentId, linkId, over: r.over });
    const inv = await db.query.feeInvoices.findFirst({ where: eq(fi.id, link.invoiceId) });
    const student = inv ? await db.query.students.findFirst({ where: eq(st.id, inv.studentId), columns: { orgId: true, assignedToId: true, firstName: true, lastName: true } }) : null;
    if (inv && student) {
      await notifyUsers(
        await partnerRecipients(student.orgId, student.assignedToId),
        `${student.firstName} ${student.lastName} paid ${inv.number} online`,
        r.over > 0 ? `₹${amount}, of which ₹${r.over} is more than was due. Finance will send it back.` : `₹${amount}, receipt ${r.number}.`,
        `/students/${inv.studentId}/fees`,
      );
    }
  }
  return true;
}

// ---------- Lists ----------

/** Invoices across the students this person may see, newest first. */
export async function invoiceList(user: SessionUser, filter: { state?: FeeInvoiceState | "OPEN"; orgId?: string }, limit = 200) {
  const scope = await feeListScope(user);
  const where = and(
    scope,
    filter.state === "OPEN" ? inArray(fi.state, ["ISSUED", "PART_PAID"]) : filter.state ? eq(fi.state, filter.state) : undefined,
    filter.orgId ? eq(fi.orgId, filter.orgId) : undefined,
  );
  return db
    .select({ invoice: fi, firstName: st.firstName, lastName: st.lastName, medcityId: st.medcityId, branch: og.name })
    .from(fi)
    .innerJoin(st, eq(st.id, fi.studentId))
    .innerJoin(og, eq(og.id, fi.orgId))
    .where(where)
    .orderBy(desc(fi.createdAt))
    .limit(limit);
}

/** Every open balance this person may see, for the ageing report. */
export async function openBalances(user: SessionUser) {
  const scope = await feeListScope(user);
  const rows = await db
    .select({ id: fi.id, orgId: fi.orgId, number: fi.number, dueOn: fi.dueOn, total: fi.total, received: fi.received, branch: og.name, studentId: st.id, firstName: st.firstName, lastName: st.lastName, medcityId: st.medcityId, issuedOn: fi.issuedOn })
    .from(fi)
    .innerJoin(st, eq(st.id, fi.studentId))
    .innerJoin(og, eq(og.id, fi.orgId))
    .where(and(scope, inArray(fi.state, ["ISSUED", "PART_PAID"]), isNotNull(fi.total), isNotNull(fi.dueOn)))
    .orderBy(asc(fi.dueOn));
  return rows.map((r) => ({ ...r, dueOn: r.dueOn!, balance: Math.max(0, (r.total ?? 0) - r.received) })).filter((r) => r.balance > 0);
}

/** Receipts on a range of days, with the branch and who recorded them. */
export async function receiptsBetween(user: SessionUser, from: string, to: string) {
  const scope = await feeListScope(user);
  return db
    .select({ receipt: fr, invoiceNumber: fi.number, branch: og.name, firstName: st.firstName, lastName: st.lastName, by: schema.users.name })
    .from(fr)
    .innerJoin(fi, eq(fi.id, fr.invoiceId))
    .innerJoin(st, eq(st.id, fr.studentId))
    .innerJoin(og, eq(og.id, fr.orgId))
    .leftJoin(schema.users, eq(schema.users.id, fr.recordedById))
    .where(and(scope, gte(fr.receivedOn, from), lte(fr.receivedOn, to)))
    .orderBy(asc(og.name), asc(fr.method), asc(fr.createdAt));
}

/** Refunds paid out on a range of days. */
export async function refundsPaidBetween(user: SessionUser, from: Date, to: Date) {
  const scope = await feeListScope(user);
  return db
    .select({ refund: rf, invoiceNumber: fi.number, branch: og.name, firstName: st.firstName, lastName: st.lastName })
    .from(rf)
    .innerJoin(fi, eq(fi.id, rf.invoiceId))
    .innerJoin(st, eq(st.id, rf.studentId))
    .innerJoin(og, eq(og.id, rf.orgId))
    .where(and(scope, eq(rf.state, "PAID"), gte(rf.paidAt, from), lte(rf.paidAt, to)))
    .orderBy(asc(rf.paidAt));
}

/** Refunds across the students this person may see. */
export async function refundList(user: SessionUser) {
  const scope = await feeListScope(user);
  const requester = schema.users;
  return db
    .select({ refund: rf, invoiceNumber: fi.number, branch: og.name, firstName: st.firstName, lastName: st.lastName, requestedBy: requester.name })
    .from(rf)
    .innerJoin(fi, eq(fi.id, rf.invoiceId))
    .innerJoin(st, eq(st.id, rf.studentId))
    .innerJoin(og, eq(og.id, rf.orgId))
    .innerJoin(requester, eq(requester.id, rf.requestedById))
    .where(scope)
    .orderBy(sql`case ${rf.state} when 'REQUESTED' then 0 when 'APPROVED' then 1 else 2 end`, desc(rf.createdAt))
    .limit(300);
}

/** The fee plan templates, live ones first. */
export const feePlanList = () => db.select().from(schema.feePlans).orderBy(desc(schema.feePlans.active), asc(schema.feePlans.name));

/** The organisations an invoice can be raised from, with their tax details. */
export const taxDetails = () =>
  db
    .select({ id: og.id, name: og.name, type: og.type, gstin: og.gstin, state: og.state, idCode: og.idCode })
    .from(og)
    .where(and(eq(og.active, true), inArray(og.type, ["HQ", "BRANCH"])))
    .orderBy(asc(og.type), asc(og.name));

/** Branches the viewer's lists can be narrowed to. */
export async function branchOptions(user: SessionUser) {
  if (!isFeeDesk(user) && user.orgType !== "HQ") return [];
  return db.select({ id: og.id, name: og.name }).from(og).where(and(eq(og.active, true), inArray(og.type, ["HQ", "BRANCH"]))).orderBy(asc(og.name));
}
