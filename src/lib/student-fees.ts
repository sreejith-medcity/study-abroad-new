/**
 * A student's fees: the arithmetic behind fee plans, invoices, receipts,
 * ageing and refunds, kept apart from the server so every rule can be tested.
 *
 * Money is in whole rupees, the same as every income line and rate card in the
 * portal. Nothing here invents a figure: a fee nobody recorded stays null, a
 * GST rate nobody recorded stays null, and an organisation with no GSTIN
 * issues a bill of supply with no tax on it rather than a tax invoice with a
 * made-up rate.
 */

import { groupInr } from "./format";
import { FEE_STEP_PATHWAYS, feeStepWords, isFeeStep } from "./fee-steps";

// ---------- Fee plans ----------

/**
 * When one instalment falls due: when the plan is applied, days after that,
 * on a date, or at a step of a process the file goes through. A step is a
 * pathway and a step key within it (src/lib/fee-steps.ts): a journey stage,
 * a step of the Ausbildung guide, an NCLEX-RN placement step, or any pathway
 * added there later.
 */
export type DueRule = "ON_APPLY" | "DAYS" | "DATE" | "STEP";

/**
 * One instalment of a fee plan template. Either a fixed amount or a share of
 * the package fee in percent, never both.
 */
export type FeePlanItem = {
  label: string;
  amount: number | null;
  share: number | null;
  due: DueRule;
  days?: number | null;
  date?: string | null;
  /** For STEP: the process (JOURNEY, AUSBILDUNG, NCLEX, ...). */
  pathway?: string | null;
  /** For STEP: the step within it, as src/lib/fee-steps.ts lists it. */
  stepKey?: string | null;
  /**
   * This instalment's own GST rate where it differs from the plan's: a
   * number, or null where the sheet says "+ GST" with no rate. Left out, the
   * plan's rate applies.
   */
  gstPercent?: number | null;
};

/** The choices in the plan editor's "due" list: the three kinds of day, then one per pathway. */
export const DUE_CHOICES: { value: string; label: string }[] = [
  { value: "ON_APPLY", label: "When the plan is applied" },
  { value: "DAYS", label: "Days after the plan is applied" },
  { value: "DATE", label: "On a date" },
  ...FEE_STEP_PATHWAYS.map((p) => ({ value: p.key, label: p.dueLabel })),
];

/** The GST rate that applies to one instalment: its own where it has one, otherwise the plan's. */
export const itemGst = (item: Pick<FeePlanItem, "gstPercent">, planGst: number | null): number | null =>
  item.gstPercent !== undefined ? item.gstPercent : planGst;

/** "on offer", "30 days after the plan is applied", "on 15/01/2027". */
export function dueWords(item: Pick<FeePlanItem, "due" | "days" | "date" | "pathway" | "stepKey">): string {
  if (item.due === "ON_APPLY") return "when the plan is applied";
  if (item.due === "DAYS") return `${item.days ?? 0} day${item.days === 1 ? "" : "s"} after the plan is applied`;
  if (item.due === "DATE") return item.date ? `on ${item.date.split("-").reverse().join("/")}` : "on a date not recorded";
  return feeStepWords(item.pathway, item.stepKey);
}

/** When a scheduled instalment with no date falls due, in words, from its stored step. */
export function instalmentDueWords(row: { stepPathway: string | null; stepKey: string | null }): string {
  return feeStepWords(row.stepPathway, row.stepKey);
}

/** An instalment's GST rate in words: the rate, or "Not recorded". */
export const gstWords = (rate: number | null) => (rate == null ? "Not recorded" : `${rate}%`);

const SHARE_TOLERANCE = 0.001;

/**
 * What is wrong with a plan, in words, or null when it can be saved.
 *
 * A plan is all amounts or all shares. Mixing them leaves a question nobody
 * can answer from the plan alone (a share of what, once the fixed amounts are
 * taken off?), so it is refused rather than guessed at.
 */
export function planProblem(items: FeePlanItem[]): string | null {
  if (items.length === 0) return "A plan needs at least one instalment.";
  if (items.length > 24) return "A plan has at most 24 instalments.";
  for (const [i, item] of items.entries()) {
    const n = i + 1;
    if (!item.label.trim()) return `Instalment ${n} needs a name.`;
    if ((item.amount == null) === (item.share == null)) return `Instalment ${n} needs either an amount or a share, not both.`;
    if (item.amount != null && (!Number.isInteger(item.amount) || item.amount <= 0)) return `Instalment ${n}: an amount is whole rupees above nought.`;
    if (item.share != null && !(item.share > 0 && item.share <= 100)) return `Instalment ${n}: a share is a percentage above nought and up to 100.`;
    if (item.due === "DAYS" && (item.days == null || !Number.isInteger(item.days) || item.days < 0 || item.days > 1500)) return `Instalment ${n}: give the number of days.`;
    if (item.due === "DATE" && !/^\d{4}-\d{2}-\d{2}$/.test(item.date ?? "")) return `Instalment ${n}: give the date.`;
    if (item.due === "STEP" && !isFeeStep(item.pathway, item.stepKey)) return `Instalment ${n}: choose the stage or step it waits for.`;
    if (item.gstPercent != null && !(item.gstPercent >= 0 && item.gstPercent <= 28)) return `Instalment ${n}: a GST rate is between 0 and 28.`;
  }
  const shares = items.filter((i) => i.share != null);
  if (shares.length > 0 && shares.length < items.length) return "A plan is either all amounts or all shares.";
  if (shares.length > 0) {
    const sum = shares.reduce((s, i) => s + (i.share ?? 0), 0);
    if (Math.abs(sum - 100) > SHARE_TOLERANCE) return `The shares add up to ${Math.round(sum * 100) / 100}%, not 100%.`;
  }
  return null;
}

export const usesShares = (items: FeePlanItem[]) => items.some((i) => i.share != null);

/**
 * The amount of each instalment.
 *
 * Amounts are what they say. Shares are taken of the package fee and rounded
 * down to the rupee, and the last share takes whatever rupees the rounding
 * left over, so the instalments always add up to exactly the fee. A share of a
 * fee that was not recorded is null: it is not worked out from anything else.
 */
export function splitFee(items: FeePlanItem[], fee: number | null): (number | null)[] {
  const shareIdx = items.map((it, k) => (it.share != null ? k : -1)).filter((k) => k >= 0);
  const last = shareIdx.at(-1);
  const shareTotal = shareIdx.reduce((s, k) => s + (items[k].share ?? 0), 0);
  // The whole of the shares' part of the fee, so the last one can be the remainder.
  const pool = fee == null ? null : Math.round((fee * shareTotal) / 100);
  let given = 0;
  return items.map((it, k) => {
    if (it.amount != null) return it.amount;
    if (it.share == null || fee == null || pool == null) return null;
    if (k === last) return pool - given;
    const part = Math.floor((fee * it.share) / 100 + 1e-9);
    given += part;
    return part;
  });
}

/** A day as YYYY-MM-DD, n days after another. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today in India, as YYYY-MM-DD: the office's day, wherever the server runs. */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export type ScheduledRow = {
  seq: number;
  label: string;
  amount: number | null;
  dueOn: string | null;
  stepPathway: string | null;
  stepKey: string | null;
  gstPercent: number | null;
};

/** A plan laid out for one student from the day it is applied. */
export function scheduleFrom(items: FeePlanItem[], fee: number | null, appliedOn: string, planGst: number | null = null): ScheduledRow[] {
  const amounts = splitFee(items, fee);
  return items.map((it, k) => ({
    seq: k + 1,
    label: it.label.trim(),
    amount: amounts[k],
    dueOn: it.due === "ON_APPLY" ? appliedOn : it.due === "DAYS" ? addDays(appliedOn, it.days ?? 0) : it.due === "DATE" ? (it.date ?? null) : null,
    stepPathway: it.due === "STEP" ? (it.pathway ?? null) : null,
    stepKey: it.due === "STEP" ? (it.stepKey ?? null) : null,
    gstPercent: itemGst(it, planGst),
  }));
}

/** The days a stage-tied instalment's invoice gives the student to pay. */
export const STAGE_INVOICE_DAYS = 7;

// ---------- GST ----------

/**
 * The GST state codes, the first two characters of every GSTIN. Used to read
 * an organisation's state from its GSTIN, so the two can never disagree.
 */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export const stateFromGstin = (gstin: string): string | null => GST_STATES[gstin.slice(0, 2)] ?? null;

const sameState = (a: string, b: string) => a.trim().toLowerCase().replace(/[^a-z]/g, "") === b.trim().toLowerCase().replace(/[^a-z]/g, "");

export type GstResult = {
  /** A tax invoice when the seller has a GSTIN, otherwise a bill of supply. */
  kind: "TAX_INVOICE" | "BILL_OF_SUPPLY";
  percent: number | null;
  /** IGST when the student's recorded state is another state; CGST and SGST otherwise. */
  interState: boolean;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  tax: number | null;
  /** Null when the seller has a GSTIN and no rate was recorded: the invoice cannot be issued. */
  total: number | null;
  missingRate: boolean;
};

/**
 * The tax on one invoice.
 *
 * No GSTIN, no tax: a bill of supply for the fee as it is. With a GSTIN, the
 * recorded rate is applied to the taxable value, rounded to the rupee, split
 * into CGST and SGST inside the seller's state and charged as IGST when the
 * student's address on record is in another state. Where the student's state
 * is not recorded, the place of supply is the seller's own state, which is
 * the rule for a buyer whose address is not on record. A seller with a GSTIN
 * and no rate gets no tax figure at all, never a guessed one.
 */
export function gstFor(taxable: number, percent: number | null, seller: { gstin: string | null; state: string | null }, buyerState: string | null): GstResult {
  if (!seller.gstin) {
    return { kind: "BILL_OF_SUPPLY", percent: null, interState: false, cgst: null, sgst: null, igst: null, tax: null, total: taxable, missingRate: false };
  }
  const sellerState = seller.state ?? stateFromGstin(seller.gstin);
  const interState = !!(buyerState && buyerState.trim() && sellerState && !sameState(buyerState, sellerState));
  if (percent == null) {
    return { kind: "TAX_INVOICE", percent: null, interState, cgst: null, sgst: null, igst: null, tax: null, total: null, missingRate: true };
  }
  if (interState) {
    const igst = Math.round((taxable * percent) / 100);
    return { kind: "TAX_INVOICE", percent, interState, cgst: null, sgst: null, igst, tax: igst, total: taxable + igst, missingRate: false };
  }
  const half = Math.round((taxable * percent) / 200);
  return { kind: "TAX_INVOICE", percent, interState, cgst: half, sgst: half, igst: null, tax: half * 2, total: taxable + half * 2, missingRate: false };
}

// ---------- Numbering ----------

/** The Indian financial year a day falls in: 26-27 for April 2026 to March 2027. */
export function fyOf(day: string): string {
  const start = fyStartYear(day);
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function fyStartYear(day: string): number {
  const [y, m] = day.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

export type DocKind = "INV" | "RCT" | "RFD";

/**
 * A fee document's number: INV/KTM/26-27/0007. One series per kind, per
 * branch and per financial year, so a branch's run of invoices has no gaps
 * that belong to another branch.
 */
export function feeDocNumber(kind: DocKind, branchCode: string, fy: string, n: number): string {
  return `${kind}/${branchCode}/${fy}/${String(n).padStart(4, "0")}`;
}

/** The counter row a series is kept on. */
export const seriesScope = (kind: DocKind, orgId: string) => `fees:${kind}:${orgId}`;

// ---------- Invoices ----------

export type FeeInvoiceState = "DRAFT" | "ISSUED" | "PART_PAID" | "PAID" | "CANCELLED" | "WRITTEN_OFF";

export const FEE_INVOICE_STATE_LABEL: Record<FeeInvoiceState, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PART_PAID: "Part paid",
  PAID: "Paid",
  CANCELLED: "Cancelled",
  WRITTEN_OFF: "Written off",
};

export type FeeMethod = "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "RAZORPAY";

export const FEE_METHOD_LABEL: Record<FeeMethod, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  RAZORPAY: "Razorpay link",
};

/** The methods a person records at the counter. Razorpay is recorded by Razorpay. */
export const COUNTER_METHODS: FeeMethod[] = ["CASH", "UPI", "CARD", "BANK_TRANSFER"];

/** Where an issued invoice stands once its receipts are counted. Drafts and closed invoices stay as they are. */
export function stateAfterReceipts(current: FeeInvoiceState, total: number | null, received: number): FeeInvoiceState {
  if (current === "DRAFT" || current === "CANCELLED" || current === "WRITTEN_OFF") return current;
  if (total == null) return current;
  if (received <= 0) return "ISSUED";
  return received >= total ? "PAID" : "PART_PAID";
}

/** What is still owed on an invoice. Never below nought. */
export const balanceDue = (total: number | null, received: number) => (total == null ? null : Math.max(0, total - received));

/** Whether a receipt of this amount may be recorded at the counter. */
export function receiptProblem(amount: number, due: number | null): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return "Enter the amount in whole rupees, above nought.";
  if (due == null) return "This invoice has no total yet, so nothing can be received against it.";
  if (due <= 0) return "Nothing is due on this invoice.";
  if (amount > due) return `Only ₹${groupInr(due)} is due. Record what was received, up to the balance.`;
  return null;
}

/**
 * How much of an invoice may still be refunded: what was received, less what
 * has gone back already and what is waiting to go back.
 */
export function refundRoom(received: number, refunded: number, pending: number): number {
  return Math.max(0, received - refunded - pending);
}

// ---------- Ageing ----------

export type AgeingBucket = "NOT_DUE" | "D1_30" | "D31_60" | "D61_90" | "D90";
export const AGEING_BUCKETS: AgeingBucket[] = ["NOT_DUE", "D1_30", "D31_60", "D61_90", "D90"];
export const AGEING_LABEL: Record<AgeingBucket, string> = {
  NOT_DUE: "Not yet due",
  D1_30: "1 to 30 days",
  D31_60: "31 to 60 days",
  D61_90: "61 to 90 days",
  D90: "Over 90 days",
};

/** Whole days from one day to another, both YYYY-MM-DD. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Days past the due date, and the bucket that puts it in. Due today is not yet late. */
export function ageOf(dueOn: string, today: string): { days: number; bucket: AgeingBucket } {
  const days = daysBetween(dueOn, today);
  if (days <= 0) return { days, bucket: "NOT_DUE" };
  if (days <= 30) return { days, bucket: "D1_30" };
  if (days <= 60) return { days, bucket: "D31_60" };
  if (days <= 90) return { days, bucket: "D61_90" };
  return { days, bucket: "D90" };
}

export type AgeingInput = { branch: string; dueOn: string; balance: number };
export type AgeingRow = { branch: string; invoices: number; total: number } & Record<AgeingBucket, number>;

const emptyRow = (branch: string): AgeingRow => ({ branch, invoices: 0, total: 0, NOT_DUE: 0, D1_30: 0, D31_60: 0, D61_90: 0, D90: 0 });

/** Balances due, by branch and by how late, with a line for all branches together. */
export function ageingTable(rows: AgeingInput[], today: string): { branches: AgeingRow[]; all: AgeingRow } {
  const by = new Map<string, AgeingRow>();
  const all = emptyRow("All branches");
  for (const r of rows) {
    if (r.balance <= 0) continue;
    const { bucket } = ageOf(r.dueOn, today);
    const row = by.get(r.branch) ?? emptyRow(r.branch);
    by.set(r.branch, row);
    for (const t of [row, all]) {
      t[bucket] += r.balance;
      t.total += r.balance;
      t.invoices += 1;
    }
  }
  return { branches: [...by.values()].sort((a, b) => b.total - a.total || a.branch.localeCompare(b.branch)), all };
}

/** The invoices longest past their due date, the largest first among equals. */
export function longestOverdue<T extends AgeingInput>(rows: T[], today: string, limit = 25): (T & { days: number })[] {
  return rows
    .filter((r) => r.balance > 0)
    .map((r) => ({ ...r, days: daysBetween(r.dueOn, today) }))
    .filter((r) => r.days > 0)
    .sort((a, b) => b.days - a.days || b.balance - a.balance)
    .slice(0, limit);
}

// ---------- Words ----------

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** A whole number in words with Indian grouping: crore, lakh, thousand. */
export function numberInWords(n: number): string {
  if (!Number.isFinite(n)) return "";
  const whole = Math.floor(Math.abs(n));
  if (whole === 0) return "Zero";
  const crore = Math.floor(whole / 10_000_000);
  const lakh = Math.floor((whole % 10_000_000) / 100_000);
  const thousand = Math.floor((whole % 100_000) / 1000);
  const rest = whole % 1000;
  const parts = [
    crore ? `${numberInWords(crore)} Crore` : "",
    lakh ? `${belowHundred(lakh)} Lakh` : "",
    thousand ? `${belowHundred(thousand)} Thousand` : "",
    rest ? belowThousand(rest) : "",
  ].filter(Boolean);
  return `${n < 0 ? "Minus " : ""}${parts.join(" ")}`;
}

/** As printed on a receipt: "Rupees Twelve Thousand Five Hundred Only". */
export function rupeesInWords(amount: number): string {
  return `Rupees ${numberInWords(amount)} Only`;
}

/** ₹1,23,456 with Indian grouping, from the portal's own grouping helper. */
export const rupees = (amount: number | null | undefined) => (amount == null ? "Not recorded" : `₹${groupInr(amount)}`);

// ---------- Files ----------

/** One spreadsheet cell, quoted, with a leading formula character defused. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",");
