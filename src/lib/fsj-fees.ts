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

export type PlanInstalment = { stepPathway: string | null; stepKey: string | null; state: string; invoiceId: string | null };
/** An invoice, with the day of its last receipt as paidOn. */
export type PlanInvoice = { id: string; number: string | null; state: string; paidOn: string | null };

export type StagePayment = {
  /** The day the last of the stage's invoices was paid in full, or null while any is unpaid or not yet raised. */
  paidOn: string | null;
  /** True while an instalment of the stage is still waiting for its step, so nothing is invoiced for it yet. */
  waiting: boolean;
  invoices: { id: string; number: string | null; state: string }[];
};

export type FsjPlanPayments = {
  /** Whether the student has a fee plan with instalments on the FSJ / BFD steps. */
  planned: boolean;
  /** Per stage, what the plan holds for it, or null where the plan has no instalment for that stage. */
  stages: Record<FsjPaymentStage, StagePayment | null>;
};

const emptyStages = (): Record<FsjPaymentStage, StagePayment | null> => ({ registration: null, application: null, offer: null, preVisa: null });

/** What the student's fee instalments and invoices say about each payment stage. */
export function fsjPlanPayments(instalments: PlanInstalment[], invoices: PlanInvoice[]): FsjPlanPayments {
  const live = instalments.filter((i) => i.state !== "CANCELLED" && i.stepPathway === FSJ_FEE_PATHWAY);
  const stages = emptyStages();
  for (const s of FSJ_PAYMENT_STAGES) {
    const rows = live.filter((i) => i.stepKey === String(s.step));
    if (!rows.length) continue;
    const waiting = rows.some((r) => r.state === "SCHEDULED" || !r.invoiceId);
    const found = rows.map((r) => invoices.find((v) => v.id === r.invoiceId) ?? null);
    const paid = !waiting && found.every((v) => !!v && v.state === "PAID" && !!v.paidOn);
    const days = found.map((v) => v?.paidOn ?? "").filter(Boolean).sort();
    stages[s.key] = {
      paidOn: paid ? days[days.length - 1] : null,
      waiting,
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
 * day marked on the FSJ / BFD tab.
 */
export function effectivePayments(marked: FsjPayments, plan: FsjPlanPayments): FsjPayments & { source: PaymentSource } {
  const out = { ...marked, source: { registration: "MARKED", application: "MARKED", offer: "MARKED", preVisa: "MARKED" } as PaymentSource };
  for (const s of FSJ_PAYMENT_STAGES) {
    const p = plan.stages[s.key];
    if (!p) continue;
    out[s.field] = p.paidOn;
    out.source[s.key] = "INVOICES";
  }
  return out;
}

/** A stage read from its invoices, in words for the FSJ / BFD tab. */
export function stagePaymentWords(p: StagePayment, day: (d: string) => string = (d) => d): string {
  if (p.paidOn) return `Paid on ${day(p.paidOn)}${p.invoices.length ? `, invoice ${p.invoices.map((i) => i.number ?? "not numbered").join(", ")}` : ""}`;
  if (p.waiting && !p.invoices.length) return "Not invoiced yet: it is raised when the file reaches its step";
  const open = p.invoices.filter((i) => i.state !== "PAID");
  return `Not paid yet${open.length ? `: invoice ${open.map((i) => i.number ?? "not numbered").join(", ")} is ${open.map((i) => INVOICE_STATE_WORDS[i.state] ?? i.state.toLowerCase()).join(", ")}` : ""}`;
}

const INVOICE_STATE_WORDS: Record<string, string> = {
  DRAFT: "a draft",
  ISSUED: "to pay",
  PART_PAID: "part paid",
  PAID: "paid",
  CANCELLED: "cancelled",
  WRITTEN_OFF: "written off",
};
