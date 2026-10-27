/**
 * The FSJ / BFD payment stages, read from the student's fee invoices.
 *
 * The written process names four payments: the registration fee (step 2),
 * the application fee (checked at step 6 before the application starts), the
 * offer-letter stage (step 10) and the pre-visa payment (verified at step 12).
 * Where the student has a fee plan with instalments tied to the FSJ / BFD
 * steps (src/lib/fee-steps.ts), each stage is paid when every invoice raised
 * for its step's instalments is paid in full, on the day the last of them was.
 * A stage the plan has no instalment for, and every stage of a student with
 * no such plan, keeps the day marked paid by hand on the FSJ / BFD tab.
 *
 * Three rules keep the gate honest:
 * - An instalment cancelled while it still carries an invoice stays on its
 *   stage: cancelling the schedule does not cancel the invoice already issued,
 *   so a day marked by hand cannot stand in for it.
 * - A waived instalment is settled: nothing is owed for it.
 * - A skipped instalment (not raised under this plan) counts through the
 *   earlier invoice that billed it, where it names one, and otherwise drops
 *   out, as the stage was not billed under this plan.
 * - A written-off invoice is not paid. The stage stays closed until the head
 *   office decides the file goes on and marks the stage settled, with a
 *   reason, on the FSJ / BFD tab.
 */
import { FSJ_FEE_PATHWAY } from "./fee-steps";

export type FsjPaymentStage = "registration" | "application" | "offer" | "preVisa";

export const FSJ_PAYMENT_STAGES: { key: FsjPaymentStage; step: number; label: string; field: keyof FsjPayments }[] = [
  { key: "registration", step: 2, label: "Registration fee", field: "registrationFeePaidOn" },
  { key: "application", step: 6, label: "Application fee", field: "applicationFeePaidOn" },
  { key: "offer", step: 10, label: "Offer-letter stage", field: "offerPaymentOn" },
  { key: "preVisa", step: 12, label: "Pre-visa", field: "preVisaPaymentOn" },
];

/** The four payment days, as the FSJ / BFD tab and its checks read them. */
export type FsjPayments = {
  registrationFeePaidOn: string | null;
  applicationFeePaidOn: string | null;
  offerPaymentOn: string | null;
  preVisaPaymentOn: string | null;
};

/**
 * A fee instalment on the student's schedule. The state is read as text, so
 * the waived and skipped states are read the same whichever release of the
 * fee schedule the database has.
 */
export type PlanInstalment = { stepPathway: string | null; stepKey: string | null; state: string; invoiceId: string | null };
/**
 * An invoice, with the day of its last receipt as paidOn. total and held (what
 * was received less what was refunded) are read where known: a paid invoice
 * whose money has gone back is not a fee paid.
 */
export type PlanInvoice = { id: string; number: string | null; state: string; paidOn: string | null; total?: number | null; held?: number | null };

export const WAIVED = "WAIVED";
export const SKIPPED = "SKIPPED";

/** Paid in full and still held: an invoice refunded after it was paid no longer counts. */
const paidAndHeld = (v: PlanInvoice | null): boolean => !!v && v.state === "PAID" && !!v.paidOn && (v.total == null || v.held == null || v.held >= v.total);

export type StagePayment = {
  /** The day the last of the stage's invoices was paid in full, or null while any is unpaid or not yet raised, or where nothing was paid (all waived). */
  paidOn: string | null;
  /** Whether the stage counts as paid for the process: every invoice paid in full, the rest waived, or written off and settled by the head office. */
  settled: boolean;
  /** True while an instalment of the stage is still waiting for its step, so nothing is invoiced for it yet. */
  waiting: boolean;
  /** Some instalment of the stage was waived. */
  waived: boolean;
  /** An invoice of the stage is written off. Unless the head office has settled the stage, the gate stays closed. */
  writtenOff: boolean;
  /** The head office marked the stage settled despite the written-off invoice. */
  headOfficeSettled: boolean;
  invoices: { id: string; number: string | null; state: string }[];
};

export type FsjPlanPayments = {
  /** Whether the student has a fee plan with instalments on the FSJ / BFD steps. */
  planned: boolean;
  /** Per stage, what the plan holds for it, or null where the plan has no instalment for that stage. */
  stages: Record<FsjPaymentStage, StagePayment | null>;
};

const emptyStages = (): Record<FsjPaymentStage, StagePayment | null> => ({ registration: null, application: null, offer: null, preVisa: null });

/**
 * What the student's fee instalments and invoices say about each payment
 * stage. settledByHeadOffice lists the stages the head office marked settled
 * on the FSJ / BFD tab; that lets a written-off invoice through, nothing else.
 */
export function fsjPlanPayments(instalments: PlanInstalment[], invoices: PlanInvoice[], settledByHeadOffice: readonly FsjPaymentStage[] = []): FsjPlanPayments {
  const invoiceOf = (id: string | null) => (id ? (invoices.find((v) => v.id === id) ?? null) : null);
  // A cancelled instalment drops out only when nothing it raised is still
  // standing; a skipped one counts only through the invoice that billed it.
  const counts = (i: PlanInstalment) => {
    if (i.stepPathway !== FSJ_FEE_PATHWAY) return false;
    if (i.state === SKIPPED) return !!i.invoiceId;
    if (i.state !== "CANCELLED") return true;
    if (!i.invoiceId) return false;
    const v = invoiceOf(i.invoiceId);
    return !v || v.state !== "CANCELLED";
  };
  const live = instalments.filter(counts);
  const stages = emptyStages();
  for (const s of FSJ_PAYMENT_STAGES) {
    const rows = live.filter((i) => i.stepKey === String(s.step));
    if (!rows.length) continue;
    const owed = rows.filter((r) => r.state !== WAIVED);
    const waiting = owed.some((r) => r.state === "SCHEDULED" || !r.invoiceId);
    const found = owed.map((r) => invoiceOf(r.invoiceId));
    const writtenOff = found.some((v) => v?.state === "WRITTEN_OFF");
    const headOffice = writtenOff && settledByHeadOffice.includes(s.key);
    const settled = !waiting && found.every((v) => paidAndHeld(v) || (headOffice && v?.state === "WRITTEN_OFF"));
    const days = found.filter(paidAndHeld).map((v) => v!.paidOn!).sort();
    stages[s.key] = {
      paidOn: settled && days.length ? days[days.length - 1] : null,
      settled,
      waiting,
      waived: owed.length < rows.length,
      writtenOff,
      headOfficeSettled: headOffice,
      invoices: found.filter((v): v is PlanInvoice => !!v).map((v) => ({ id: v.id, number: v.number, state: v.state })),
    };
  }
  return { planned: live.length > 0, stages };
}

/** Where each stage's day comes from: the fee invoices, or the day marked on the tab. */
export type PaymentSource = Record<FsjPaymentStage, "INVOICES" | "MARKED">;

/**
 * The payment days the process works from: a stage the fee plan covers is read
 * from its invoices, whatever was marked by hand; every other stage keeps the
 * day marked on the FSJ / BFD tab. settled says, per stage, whether it counts
 * as paid: a waived stage is settled with no day of payment.
 */
export function effectivePayments(marked: FsjPayments, plan: FsjPlanPayments): FsjPayments & { source: PaymentSource; settled: Record<FsjPaymentStage, boolean> } {
  const out = {
    ...marked,
    source: { registration: "MARKED", application: "MARKED", offer: "MARKED", preVisa: "MARKED" } as PaymentSource,
    settled: { registration: false, application: false, offer: false, preVisa: false } as Record<FsjPaymentStage, boolean>,
  };
  for (const s of FSJ_PAYMENT_STAGES) {
    const p = plan.stages[s.key];
    if (!p) {
      out.settled[s.key] = !!marked[s.field];
      continue;
    }
    out[s.field] = p.paidOn;
    out.source[s.key] = "INVOICES";
    out.settled[s.key] = p.settled;
  }
  return out;
}

/** The words for a written-off invoice that holds the file. */
export const WRITTEN_OFF_WORDS = "written off: the head office decides whether this file goes on";

const numbers = (list: { number: string | null }[]) => list.map((i) => i.number ?? "not numbered").join(", ");

/** A stage read from its invoices, in words for the FSJ / BFD tab. */
export function stagePaymentWords(p: Pick<StagePayment, "paidOn" | "waiting" | "invoices"> & Partial<StagePayment>, day: (d: string) => string = (d) => d): string {
  const off = p.invoices.filter((i) => i.state === "WRITTEN_OFF");
  if (p.headOfficeSettled) return `Settled by the head office: invoice ${numbers(off)} written off`;
  if (p.writtenOff && !p.settled) return `Invoice ${numbers(off)} is ${WRITTEN_OFF_WORDS}`;
  if (p.paidOn) return `Paid on ${day(p.paidOn)}${p.invoices.length ? `, invoice ${numbers(p.invoices)}` : ""}${p.waived ? ", the rest waived" : ""}`;
  if (p.settled && p.waived) return "Waived: nothing is owed for this stage";
  if (p.waiting && !p.invoices.length) return "Not invoiced yet: it is raised when the file reaches its step";
  const open = p.invoices.filter((i) => i.state !== "PAID");
  return `Not paid yet${open.length ? `: invoice ${numbers(open)} is ${open.map((i) => INVOICE_STATE_WORDS[i.state] ?? i.state.toLowerCase()).join(", ")}` : ""}`;
}

const INVOICE_STATE_WORDS: Record<string, string> = {
  DRAFT: "a draft",
  ISSUED: "to pay",
  PART_PAID: "part paid",
  PAID: "paid",
  CANCELLED: "cancelled",
  WRITTEN_OFF: "written off",
};
