import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOf, AGE_ORDER, creditAllowed, creditNoteNumber, dueOn, invoiceableOn, invoiceNumber, invoiceTotals, numberSuffix, stateAfterSettlement, taxFor } from "../src/lib/invoicing";

test("a placement is invoiceable only once the milestone has a date on it", () => {
  const visa = { payableOn: "VISA_APPROVED" as const, offerAcceptedOn: "2026-05-01", feePaidOn: "2026-06-01", visaGrantedOn: null, enrolledOn: null };
  const waiting = invoiceableOn(visa);
  assert.equal(waiting.ready, false);
  assert.equal(waiting.waitingFor, "the visa is approved", "the queue says what it is waiting for");
  const granted = invoiceableOn({ ...visa, visaGrantedOn: "2026-08-20" });
  assert.deepEqual([granted.ready, granted.on], [true, "2026-08-20"]);
});

test("each vendor's own milestone is the one that counts", () => {
  const dates = { offerAcceptedOn: "2026-05-01", feePaidOn: "2026-06-01", visaGrantedOn: "2026-08-20", enrolledOn: "2026-09-25" };
  assert.equal(invoiceableOn({ payableOn: "OFFER_ACCEPTED", ...dates }).on, "2026-05-01");
  assert.equal(invoiceableOn({ payableOn: "FEE_PAID", ...dates }).on, "2026-06-01");
  assert.equal(invoiceableOn({ payableOn: "ENROLMENT_CONFIRMED", ...dates }).on, "2026-09-25");
});

test("the due date comes from the vendor's own terms", () => {
  assert.equal(dueOn("2026-09-01", 60), "2026-10-31");
  assert.equal(dueOn("2026-09-01", 0), "2026-09-01", "paid on receipt is a real term");
});

const company = { gstin: "32AAAAA0000A1Z5", lutNumber: "AD320426000000X", lutValidUntil: "2027-03-31" };

test("a vendor abroad is zero-rated where the company holds a live LUT", () => {
  const tax = taxFor(company, false, new Date("2026-10-01"));
  assert.equal(tax.percent, 0);
  assert.match(tax.treatment, /zero-rated under LUT/);
  assert.match(tax.note, /AD320426000000X/);
});

test("a lapsed LUT is said out loud rather than quietly zero-rating it", () => {
  const tax = taxFor({ ...company, lutValidUntil: "2026-03-31" }, false, new Date("2026-10-01"));
  assert.equal(tax.percent, 18);
  assert.match(tax.treatment, /lapsed/);
  assert.match(tax.note, /Renew it/);
});

test("no LUT at all is taxable, and says what to do about it", () => {
  const tax = taxFor({ gstin: company.gstin, lutNumber: null, lutValidUntil: null }, false);
  assert.equal(tax.percent, 18);
  assert.match(tax.note, /Record the company's LUT/);
});

test("an Indian vendor carries tax, and a company with no GSTIN shows none", () => {
  assert.equal(taxFor(company, true).percent, 18);
  assert.equal(taxFor({ gstin: null, lutNumber: null, lutValidUntil: null }, false).percent, 0);
  assert.equal(taxFor(null, false).percent, 0, "and with no company chosen nothing is assumed");
});

test("the total is the sum of the lines, never a typed figure", () => {
  const money = invoiceTotals([{ amount: 100000 }, { amount: 75000 }], [], { percent: 0 });
  assert.deepEqual([money.net, money.taxAmount, money.total], [175000, 0, 175000]);
  const taxed = invoiceTotals([{ amount: 100000 }], [], { percent: 18 });
  assert.deepEqual([taxed.net, taxed.taxAmount, taxed.total], [100000, 18000, 118000]);
});

test("part payments add up, and what is left is what is owed", () => {
  const money = invoiceTotals([{ amount: 100000 }], [{ amount: 40000 }, { amount: 25000 }], { percent: 0 });
  assert.deepEqual([money.received, money.outstanding], [65000, 35000]);
  assert.equal(money.overpaid, 0);
});

test("paying over is shown rather than hidden", () => {
  const money = invoiceTotals([{ amount: 100000 }], [{ amount: 110000 }], { percent: 0 });
  assert.deepEqual([money.outstanding, money.overpaid], [0, 10000]);
});

test("an invoice is part paid until the whole of it is in", () => {
  assert.equal(stateAfterSettlement(100000, 40000, "SENT"), "PART_PAID");
  assert.equal(stateAfterSettlement(100000, 100000, "PART_PAID"), "PAID");
  assert.equal(stateAfterSettlement(100000, 120000, "SENT"), "PAID");
  assert.equal(stateAfterSettlement(100000, 50000, "WRITTEN_OFF"), "WRITTEN_OFF", "a written-off invoice is not revived by a payment arriving");
});

test("how late an invoice is, in the buckets a finance meeting uses", () => {
  const today = new Date("2026-10-02T00:00:00Z");
  assert.equal(ageOf("2026-11-01", today).bucket, "NOT_DUE");
  assert.equal(ageOf("2026-10-02", today).bucket, "DUE");
  assert.equal(ageOf("2026-09-20", today).bucket, "LATE_30");
  assert.equal(ageOf("2026-08-20", today).bucket, "LATE_60");
  assert.equal(ageOf("2026-06-20", today).bucket, "LATE_90");
  assert.equal(ageOf("2026-09-20", today).days, 12);
});

test("an invoice with no due date is treated as due now rather than never", () => {
  assert.deepEqual(ageOf(null), { bucket: "DUE", days: null });
});

test("the worst is read first", () => {
  assert.equal(AGE_ORDER[0], "LATE_90");
});

test("an invoice number is a running count inside the financial year, and reads back", () => {
  assert.equal(invoiceNumber("26-27", 7), "MIO/26-27/0007");
  assert.equal(numberSuffix("MIO/26-27/0007"), 7);
  assert.equal(numberSuffix("MIO/26-27/0123"), 123);
  assert.equal(numberSuffix("nonsense"), null);
});

test("a credit reduces what is owed without pretending money arrived", () => {
  const money = invoiceTotals([{ amount: 100000 }], [{ amount: 30000 }], { percent: 0 }, [{ amount: 20000 }]);
  assert.equal(money.total, 100000, "the invoice was still raised for the full amount");
  assert.equal(money.received, 30000, "the bank is reconciled against what actually arrived");
  assert.equal(money.credited, 20000);
  assert.equal(money.owed, 80000, "what the vendor owes after the credit");
  assert.equal(money.outstanding, 50000, "and what is left to chase");
  assert.equal(money.overpaid, 0);
});

test("an invoice credited in full is settled, not left on the ageing report", () => {
  const money = invoiceTotals([{ amount: 50000 }], [], { percent: 0 }, [{ amount: 50000 }]);
  assert.equal(money.outstanding, 0);
  assert.equal(stateAfterSettlement(money.total, money.settled, "SENT"), "PAID");
  // Nothing was received, so nothing is reconciled against the bank.
  assert.equal(money.received, 0);
});

test("a credit is held to what is still owed, because the rest is a refund", () => {
  const money = invoiceTotals([{ amount: 100000 }], [{ amount: 60000 }], { percent: 0 });
  assert.equal(creditAllowed(money, 40000).ok, true, "down to the last rupee outstanding");
  const over = creditAllowed(money, 40001);
  assert.equal(over.ok, false);
  assert.match(over.says, /refund, not a credit note/);
  assert.equal(creditAllowed(money, 0).ok, false);
  assert.equal(creditAllowed(money, 1.5).ok, false, "whole amounts only");
  const settled = invoiceTotals([{ amount: 100000 }], [{ amount: 100000 }], { percent: 0 });
  assert.match(creditAllowed(settled, 1).says, /Nothing is outstanding/);
});

test("credit notes are numbered in their own series, not the invoice run", () => {
  assert.equal(creditNoteNumber("26-27", 7), "MIO/CN/26-27/0007");
  assert.notEqual(creditNoteNumber("26-27", 7), invoiceNumber("26-27", 7));
  assert.equal(numberSuffix(creditNoteNumber("26-27", 7)), 7, "the running count reads back out of it");
});
