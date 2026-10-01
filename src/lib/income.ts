/**
 * What a student is worth, and what was left on the table.
 *
 * The arithmetic is the whole point of this file, and the rule it follows is the
 * same one the rest of the portal follows: a figure nobody recorded is not
 * nought. An unknown line is named, counted nowhere, and says so, because a
 * total that quietly treats unknowns as zero is a number a branch owner will
 * make a decision on.
 */

import type { IncomeKind, IncomePayer, IncomeState } from "@/db/schema";

export const INCOME_LABEL: Record<IncomeKind, string> = {
  SERVICE_FEE: "Service fee",
  COMMISSION: "Commission",
  TICKET: "Ticket",
  SIM: "SIM",
  FOREX: "Forex card",
  INSURANCE: "Insurance",
  ACCOMMODATION: "Accommodation",
  PICKUP: "Airport pickup",
  LOAN_REFERRAL: "Education loan",
  COACHING_FEE: "Coaching fee",
  OTHER: "Something else",
};

/** One line each, so nobody has to be told what a line means. */
export const INCOME_MEANS: Record<IncomeKind, string> = {
  SERVICE_FEE: "What the branch charges the student for handling the application",
  COMMISSION: "What the university or the vendor pays Medcity for the placement",
  TICKET: "What Medcity keeps on the flight booking",
  SIM: "What Medcity keeps on the SIM",
  FOREX: "What Medcity keeps on the forex card or the transfer",
  INSURANCE: "What the insurer pays Medcity for the policy",
  ACCOMMODATION: "What the accommodation provider pays for the booking",
  PICKUP: "What Medcity keeps on the airport pickup",
  LOAN_REFERRAL: "What the lender pays Medcity for the loan",
  COACHING_FEE: "Fees the student paid Medcity for coaching before this",
  OTHER: "Anything else, said plainly in the note",
};

export const PAYER_LABEL: Record<IncomePayer, string> = {
  STUDENT: "The student",
  VENDOR: "The vendor",
  PROVIDER: "The provider",
  UNIVERSITY: "The university",
};

export const STATE_LABEL: Record<IncomeState, string> = {
  EXPECTED: "Expected",
  INVOICED: "Invoiced",
  RECEIVED: "Received",
  WRITTEN_OFF: "Written off",
  NOT_APPLICABLE: "Not applicable",
};

/** The kinds that only exist once a student is actually going. */
export const DEPARTURE_KINDS: IncomeKind[] = ["TICKET", "SIM", "FOREX", "INSURANCE", "ACCOMMODATION", "PICKUP"];

/** The kinds a branch earns from the student rather than from somebody else. */
export const FROM_THE_STUDENT: IncomeKind[] = ["SERVICE_FEE", "COACHING_FEE"];

export type LineLike = {
  kind: IncomeKind;
  currency: string;
  expectedAmount: number | null;
  invoicedAmount: number | null;
  receivedAmount: number | null;
  state: IncomeState;
  branchSharePercent: number | null;
};

export type Totals = {
  /** Lines with a figure, added up per currency. */
  expected: Record<string, number>;
  invoiced: Record<string, number>;
  received: Record<string, number>;
  /** The branch's own share of what is expected, where a share is recorded. */
  branchShare: Record<string, number>;
  /** Lines that count towards nothing because nobody has recorded an amount. */
  unknown: number;
  /** Lines nobody will ever collect, kept visible rather than quietly dropped. */
  writtenOff: Record<string, number>;
  lines: number;
};

const add = (into: Record<string, number>, currency: string, amount: number) => {
  into[currency] = (into[currency] ?? 0) + amount;
};

/**
 * Adds up a student's lines.
 *
 * Kept per currency rather than converted: a rupee total built on yesterday's
 * indicative rate is a figure that will not match the bank, and the portal has
 * no business inventing one. Where a rupee figure is wanted the caller converts
 * it, with the rate it used on screen.
 */
export function totals(lines: LineLike[]): Totals {
  const out: Totals = { expected: {}, invoiced: {}, received: {}, branchShare: {}, unknown: 0, writtenOff: {}, lines: lines.length };
  for (const line of lines) {
    if (line.state === "NOT_APPLICABLE") continue;
    if (line.state === "WRITTEN_OFF") {
      if (line.invoicedAmount != null) add(out.writtenOff, line.currency, line.invoicedAmount);
      else if (line.expectedAmount != null) add(out.writtenOff, line.currency, line.expectedAmount);
      continue;
    }
    const expected = line.expectedAmount;
    if (expected == null && line.invoicedAmount == null && line.receivedAmount == null) {
      out.unknown += 1;
      continue;
    }
    if (expected != null) add(out.expected, line.currency, expected);
    if (line.invoicedAmount != null) add(out.invoiced, line.currency, line.invoicedAmount);
    if (line.receivedAmount != null) add(out.received, line.currency, line.receivedAmount);
    const share = line.branchSharePercent;
    const base = line.receivedAmount ?? line.invoicedAmount ?? expected;
    if (share != null && base != null) add(out.branchShare, line.currency, Math.round((base * share) / 100));
  }
  return out;
}

/** What is still to come in: invoiced or expected, less what has arrived. */
export function outstanding(lines: LineLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) {
    if (line.state === "RECEIVED" || line.state === "WRITTEN_OFF" || line.state === "NOT_APPLICABLE") continue;
    const owed = line.invoicedAmount ?? line.expectedAmount;
    if (owed == null) continue;
    const already = line.receivedAmount ?? 0;
    if (owed - already > 0) add(out, line.currency, owed - already);
  }
  return out;
}

export type RateLike = {
  orgId: string | null;
  kind: IncomeKind;
  amount: number | null;
  currency: string;
  percentOfSale: number | null;
  payer: IncomePayer;
  branchSharePercent: number | null;
  activeFrom: string;
};

/**
 * The rate that applied to one branch for one kind on one day: the branch's own
 * if it has one, otherwise the platform's. The newest row not in the future
 * wins, so a rate set today does not rewrite what was agreed last season.
 */
export function rateFor(rates: RateLike[], kind: IncomeKind, orgId: string, on = new Date()): RateLike | null {
  const day = on.toISOString().slice(0, 10);
  const usable = rates.filter((r) => r.kind === kind && r.activeFrom <= day);
  const mine = usable.filter((r) => r.orgId === orgId).sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
  if (mine.length) return mine[0];
  const platform = usable.filter((r) => r.orgId === null).sort((a, b) => b.activeFrom.localeCompare(a.activeFrom));
  return platform[0] ?? null;
}

/** What a line is worth from a rate card, where the sale's value is known. */
export function expectedFromRate(rate: RateLike | null, saleAmount: number | null): { amount: number | null; why: string } {
  if (!rate) return { amount: null, why: "No rate recorded for this" };
  if (rate.amount != null) return { amount: rate.amount, why: "From the rate card" };
  if (rate.percentOfSale != null) {
    if (saleAmount == null) return { amount: null, why: `${rate.percentOfSale}% of the sale, which is not recorded yet` };
    return { amount: Math.round((saleAmount * rate.percentOfSale) / 100), why: `${rate.percentOfSale}% of the sale` };
  }
  return { amount: null, why: "The rate card carries no figure" };
}

export type LeakRow = { kind: IncomeKind; students: number; booked: number; missed: number };

/**
 * What was left on the table: the departure services a student leaving soon has
 * not bought. Only students who are actually going are counted, because a
 * shortlist is not a missed sale.
 */
export function leakage(rows: { studentId: string; kinds: IncomeKind[] }[]): LeakRow[] {
  return DEPARTURE_KINDS.map((kind) => {
    const booked = rows.filter((r) => r.kinds.includes(kind)).length;
    return { kind, students: rows.length, booked, missed: rows.length - booked };
  }).sort((a, b) => b.missed - a.missed);
}

/** Which kind of income a booked service earns. */
export const INCOME_FOR_SERVICE: Record<"EDUCATION_LOAN" | "FOREX" | "ACCOMMODATION" | "INSURANCE" | "FLIGHT" | "OTHER", IncomeKind> = {
  EDUCATION_LOAN: "LOAN_REFERRAL",
  FOREX: "FOREX",
  ACCOMMODATION: "ACCOMMODATION",
  INSURANCE: "INSURANCE",
  FLIGHT: "TICKET",
  OTHER: "OTHER",
};
