/**
 * Invoicing a vendor.
 *
 * Vendors settle in batches, so one invoice covers as many students as the desk
 * puts on it: an invoice per placement is an invoice nobody pays. The total is
 * the sum of the lines and never a typed figure, the tax follows the company's
 * own LUT position, and every rupee figure is kept with the rate it came from,
 * because a rupee total without its rate cannot be checked against the bank.
 */

import type { InvoiceState } from "@/db/schema";
import type { PayableOn } from "./vendors";

export const INVOICE_STATE_LABEL: Record<InvoiceState, string> = {
  DRAFT: "Draft",
  RAISED: "Raised",
  SENT: "Sent",
  PART_PAID: "Part paid",
  PAID: "Paid",
  DISPUTED: "Disputed",
  WRITTEN_OFF: "Written off",
};

export const INVOICE_STATE_MEANS: Record<InvoiceState, string> = {
  DRAFT: "Being put together. It has no number yet and nothing has gone out.",
  RAISED: "Numbered and final. Ready to send.",
  SENT: "With the vendor, waiting to be paid.",
  PART_PAID: "Some of it has come in. The rest is still owed.",
  PAID: "Settled in full.",
  DISPUTED: "The vendor has questioned it. Work it out and send it on.",
  WRITTEN_OFF: "It will never be paid, and the reason is on it.",
};

/** What a vendor's terms say has to have happened before we can invoice. */
export const PAYABLE_WHEN: Record<PayableOn, string> = {
  OFFER_ACCEPTED: "the offer is accepted",
  FEE_PAID: "the student pays the fee",
  VISA_APPROVED: "the visa is approved",
  ENROLMENT_CONFIRMED: "enrolment is confirmed",
};

export type Invoiceable = {
  payableOn: PayableOn;
  offerAcceptedOn: Date | string | null;
  feePaidOn: Date | string | null;
  visaGrantedOn: Date | string | null;
  enrolledOn: Date | string | null;
};

/**
 * Whether one placement has reached the milestone its vendor pays on, and when.
 *
 * Nothing is assumed from a status alone: the date has to be recorded, because a
 * vendor asked to pay on a visa will ask which day it was granted.
 */
export function invoiceableOn(what: Invoiceable): { ready: boolean; on: string | null; waitingFor: string } {
  const pick = (v: Date | string | null) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  const on =
    what.payableOn === "OFFER_ACCEPTED"
      ? pick(what.offerAcceptedOn)
      : what.payableOn === "FEE_PAID"
        ? pick(what.feePaidOn)
        : what.payableOn === "VISA_APPROVED"
          ? pick(what.visaGrantedOn)
          : pick(what.enrolledOn);
  return { ready: on != null, on, waitingFor: PAYABLE_WHEN[what.payableOn] };
}

/** The day a vendor's invoice falls due, from their own terms. */
export function dueOn(raisedOn: Date | string, daysToPay: number): string {
  const d = raisedOn instanceof Date ? new Date(raisedOn) : new Date(raisedOn);
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + Math.max(0, daysToPay)));
  return out.toISOString().slice(0, 10);
}

export type TaxTreatment = { treatment: string; percent: number; note: string };

/**
 * How tax falls on one invoice.
 *
 * A vendor abroad paying an Indian company is an export of service: zero-rated
 * where the company holds a valid LUT, and otherwise taxable, which the company
 * then has to claim back. The portal does not decide which is right; it reads
 * what is on the billing company and says plainly which case it is in, so a
 * finance person can see when the LUT has lapsed before the invoice goes out.
 */
export function taxFor(company: { gstin: string | null; lutNumber: string | null; lutValidUntil: string | null } | null, vendorIsIndian: boolean, raisedOn = new Date()): TaxTreatment {
  if (!company) return { treatment: "No billing company chosen", percent: 0, note: "Choose the company that raises this invoice." };
  if (!company.gstin) return { treatment: "Not registered for GST", percent: 0, note: "This company has no GSTIN on record, so no tax is shown." };
  if (vendorIsIndian) {
    return { treatment: "IGST at 18%", percent: 18, note: "An Indian vendor, so the invoice carries tax at the usual rate." };
  }
  const day = raisedOn.toISOString().slice(0, 10);
  if (company.lutNumber && company.lutValidUntil && company.lutValidUntil >= day) {
    return { treatment: "Export of service, zero-rated under LUT", percent: 0, note: `LUT ${company.lutNumber}, valid to ${company.lutValidUntil}.` };
  }
  if (company.lutNumber && company.lutValidUntil && company.lutValidUntil < day) {
    return {
      treatment: "Export of service, taxable: the LUT has lapsed",
      percent: 18,
      note: `LUT ${company.lutNumber} expired on ${company.lutValidUntil}. Renew it, or raise this with tax and claim it back.`,
    };
  }
  return {
    treatment: "Export of service, taxable: no LUT on record",
    percent: 18,
    note: "Record the company's LUT to raise this zero-rated.",
  };
}

/**
 * The money on one invoice, from its lines, its payments and its credit notes.
 *
 * A credit reduces what is owed without pretending money arrived, so it is kept
 * apart from what was received: the bank reconciles against `received`, the
 * vendor's statement against `total` less `credited`, and the ageing report
 * against what is left. Collapsing the two into one figure is how an invoice
 * comes to look paid when nothing was paid.
 */
export function invoiceTotals(lines: { amount: number }[], payments: { amount: number }[], tax: { percent: number }, credits: { amount: number }[] = []) {
  const net = lines.reduce((sum, l) => sum + l.amount, 0);
  const taxAmount = Math.round((net * tax.percent) / 100);
  const total = net + taxAmount;
  const received = payments.reduce((sum, p) => sum + p.amount, 0);
  const credited = credits.reduce((sum, c) => sum + c.amount, 0);
  const owed = Math.max(0, total - credited);
  return {
    net,
    taxAmount,
    total,
    received,
    credited,
    /** What the vendor still owes after the credits: what the invoice is now worth. */
    owed,
    settled: received + credited,
    outstanding: Math.max(0, owed - received),
    overpaid: Math.max(0, received - owed),
  };
}

/**
 * Which state an invoice lands in once money or a credit has moved.
 *
 * `settled` is what has stopped being owed, by either route: an invoice fully
 * credited is as settled as one fully paid, and leaving it open would keep it
 * on the ageing report for money nobody is going to send.
 */
export function stateAfterSettlement(total: number, settled: number, current: InvoiceState): InvoiceState {
  if (current === "WRITTEN_OFF") return current;
  if (settled <= 0) return current === "DISPUTED" ? "DISPUTED" : current;
  if (settled >= total) return "PAID";
  return "PART_PAID";
}

export type AgeBucket = "NOT_DUE" | "DUE" | "LATE_30" | "LATE_60" | "LATE_90";

export const AGE_LABEL: Record<AgeBucket, string> = {
  NOT_DUE: "Not due yet",
  DUE: "Due now",
  LATE_30: "Up to 30 days late",
  LATE_60: "30 to 60 days late",
  LATE_90: "More than 60 days late",
};

export const AGE_ORDER: AgeBucket[] = ["LATE_90", "LATE_60", "LATE_30", "DUE", "NOT_DUE"];

/** How late one invoice is, in the buckets a finance meeting actually uses. */
export function ageOf(dueDate: string | null, today = new Date()): { bucket: AgeBucket; days: number | null } {
  if (!dueDate) return { bucket: "DUE", days: null };
  const due = new Date(`${dueDate}T00:00:00Z`);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.floor((now - due.getTime()) / 86_400_000);
  if (days < 0) return { bucket: "NOT_DUE", days };
  if (days === 0) return { bucket: "DUE", days };
  if (days <= 30) return { bucket: "LATE_30", days };
  if (days <= 60) return { bucket: "LATE_60", days };
  return { bucket: "LATE_90", days };
}

/** An invoice number: a running count inside the Indian financial year. */
export function invoiceNumber(financialYear: string, count: number) {
  return `MIO/${financialYear}/${String(count).padStart(4, "0")}`;
}

/**
 * A credit note's number, in its own series.
 *
 * Separate from the invoice series on purpose: a credit note that shares the
 * invoice numbering looks like a missing invoice in anybody's audit of the run.
 */
export function creditNoteNumber(financialYear: string, count: number) {
  return `MIO/CN/${financialYear}/${String(count).padStart(4, "0")}`;
}

/**
 * What a credit may be, against one invoice as it stands.
 *
 * Never more than is still owed: a credit bigger than the invoice is either a
 * refund, which is money going the other way and a different record, or a
 * mistake. Both deserve to be stopped here rather than explained later.
 */
export function creditAllowed(money: { owed: number; received: number }, amount: number): { ok: boolean; says: string } {
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, says: "A whole amount above nought." };
  const room = money.owed - money.received;
  if (room <= 0) return { ok: false, says: "Nothing is outstanding on this invoice, so there is nothing to credit." };
  if (amount > room) return { ok: false, says: `Only ${room} is outstanding. A credit cannot be larger than what is still owed; money going back to the vendor is a refund, not a credit note.` };
  return { ok: true, says: "" };
}

/** Reads the running count back out of a number, for working out the next one. */
export function numberSuffix(number: string): number | null {
  const m = number.match(/\/(\d+)$/);
  return m ? Number(m[1]) : null;
}
