import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomeKind } from "../src/db/schema";
import { DEPARTURE_KINDS, expectedFromRate, leakage, outstanding, rateFor, totals, type LineLike, type RateLike } from "../src/lib/income";

const line = (over: Partial<LineLike> = {}): LineLike => ({
  kind: "SERVICE_FEE",
  currency: "INR",
  expectedAmount: 35000,
  invoicedAmount: null,
  receivedAmount: null,
  state: "EXPECTED",
  branchSharePercent: null,
  ...over,
});

test("a line with no amount on it is counted nowhere, and says so", () => {
  const t = totals([line({ expectedAmount: null })]);
  assert.deepEqual(t.expected, {});
  assert.equal(t.unknown, 1, "it is named rather than silently dropped");
});

test("nought is a figure, not an unknown", () => {
  const t = totals([line({ expectedAmount: 0 })]);
  assert.deepEqual(t.expected, { INR: 0 });
  assert.equal(t.unknown, 0, "a line genuinely worth nothing is a fact, and a different one");
});

test("currencies are kept apart rather than converted on a guessed rate", () => {
  const t = totals([line({ expectedAmount: 35000 }), line({ kind: "COMMISSION", currency: "GBP", expectedAmount: 2100 })]);
  assert.deepEqual(t.expected, { INR: 35000, GBP: 2100 });
});

test("the branch's share is taken from what actually came in, where it has", () => {
  const t = totals([line({ expectedAmount: 10000, receivedAmount: 8000, branchSharePercent: 50 })]);
  assert.deepEqual(t.branchShare, { INR: 4000 }, "half of what arrived, not half of what was hoped for");
});

test("no share recorded means no share counted", () => {
  const t = totals([line({ branchSharePercent: null })]);
  assert.deepEqual(t.branchShare, {});
});

test("money written off stays visible instead of vanishing from the sheet", () => {
  const t = totals([line({ state: "WRITTEN_OFF", invoicedAmount: 5000 })]);
  assert.deepEqual(t.writtenOff, { INR: 5000 });
  assert.deepEqual(t.expected, {}, "and it is not still counted as expected");
});

test("a line marked not applicable is out of the reckoning entirely", () => {
  const t = totals([line({ state: "NOT_APPLICABLE" })]);
  assert.deepEqual([t.expected, t.unknown, t.writtenOff], [{}, 0, {}]);
});

test("what is still owed is what was invoiced less what arrived", () => {
  assert.deepEqual(outstanding([line({ invoicedAmount: 10000, receivedAmount: 4000 })]), { INR: 6000 });
  assert.deepEqual(outstanding([line({ invoicedAmount: 10000, receivedAmount: 10000, state: "RECEIVED" })]), {}, "paid in full owes nothing");
  assert.deepEqual(outstanding([line({ expectedAmount: null })]), {}, "an unknown is not a debt");
  assert.deepEqual(outstanding([line({ state: "WRITTEN_OFF", invoicedAmount: 9000 })]), {}, "written off is not owed");
});

const rate = (over: Partial<RateLike> = {}): RateLike => ({
  orgId: null,
  kind: "TICKET",
  amount: 3000,
  currency: "INR",
  percentOfSale: null,
  payer: "PROVIDER",
  branchSharePercent: 50,
  activeFrom: "2026-04-01",
  ...over,
});

test("a branch's own rate beats the platform's", () => {
  const rates = [rate(), rate({ orgId: "b1", amount: 4000 })];
  assert.equal(rateFor(rates, "TICKET", "b1", new Date("2026-09-01"))?.amount, 4000);
  assert.equal(rateFor(rates, "TICKET", "b2", new Date("2026-09-01"))?.amount, 3000, "a branch with no rate of its own falls back");
});

test("a rate set today does not rewrite what applied last season", () => {
  const rates = [rate({ amount: 3000, activeFrom: "2026-04-01" }), rate({ amount: 5000, activeFrom: "2026-10-01" })];
  assert.equal(rateFor(rates, "TICKET", "b1", new Date("2026-09-15"))?.amount, 3000);
  assert.equal(rateFor(rates, "TICKET", "b1", new Date("2026-10-15"))?.amount, 5000);
});

test("no rate recorded is no rate, not nought", () => {
  assert.equal(rateFor([], "SIM", "b1"), null);
  assert.deepEqual(expectedFromRate(null, null), { amount: null, why: "No rate recorded for this" });
});

test("a percentage needs a sale to be a percentage of", () => {
  const pct = rate({ amount: null, percentOfSale: 0.5 });
  assert.deepEqual(expectedFromRate(pct, 400000), { amount: 2000, why: "0.5% of the sale" });
  const unknown = expectedFromRate(pct, null);
  assert.equal(unknown.amount, null);
  assert.match(unknown.why, /not recorded yet/);
});

test("leakage counts only what a leaving student has not bought", () => {
  const rows = [
    { studentId: "a", kinds: ["TICKET" as const, "SIM" as const] },
    { studentId: "b", kinds: ["TICKET" as const] },
  ];
  const report = leakage(rows);
  const ticket = report.find((r) => r.kind === "TICKET")!;
  const forex = report.find((r) => r.kind === "FOREX")!;
  assert.deepEqual([ticket.booked, ticket.missed], [2, 0]);
  assert.deepEqual([forex.booked, forex.missed], [0, 2]);
  assert.equal(report[0].kind, forex.kind === report[0].kind ? forex.kind : report[0].kind);
  assert.ok(report.every((r) => r.students === 2));
  assert.equal(report.length, DEPARTURE_KINDS.length);
});

test("nobody leaving means nothing was missed", () => {
  assert.ok(leakage([]).every((r) => r.missed === 0 && r.students === 0));
});


test("a student who said no is not a sale anybody lost", () => {
  const rows = [
    { studentId: "a", kinds: ["TICKET"] as IncomeKind[], declined: [] as IncomeKind[] },
    { studentId: "b", kinds: [] as IncomeKind[], declined: ["INSURANCE"] as IncomeKind[] },
    { studentId: "c", kinds: [] as IncomeKind[], declined: [] as IncomeKind[] },
  ];
  const insurance = leakage(rows).find((r) => r.kind === "INSURANCE");
  assert.ok(insurance);
  assert.equal(insurance.declined, 1);
  assert.equal(insurance.students, 2, "the student who said no is not counted as somebody to sell to");
  assert.equal(insurance.missed, 2, "two were asked and neither bought");

  const ticket = leakage(rows).find((r) => r.kind === "TICKET");
  assert.ok(ticket);
  assert.equal(ticket.booked, 1);
  assert.equal(ticket.missed, 2);
  assert.equal(ticket.declined, 0);
});

test("coaching fees are the academy's money and are counted in no Overseas total", () => {
  const t = totals([
    line({ kind: "SERVICE_FEE", expectedAmount: null, receivedAmount: 35000, state: "RECEIVED" }),
    line({ kind: "COACHING_FEE", expectedAmount: null, receivedAmount: 60000, state: "RECEIVED" }),
  ]);
  assert.equal(t.received.INR, 35000, "the coaching fee is not in what Overseas received");
  assert.equal(t.anotherCompany.INR, 60000, "it is counted on its own, so the student's worth is still visible");
  assert.equal(t.unknown, 0);
});
