import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addUp,
  daysToPayText,
  fastestPayer,
  financialYearFrom,
  financialYearOf,
  financialYears,
  inWords,
  median,
  perStudent,
  shape,
  share,
  shareText,
  type MoneyRow,
} from "../src/lib/money-report";

const row = (over: Partial<MoneyRow> & { key: string }): MoneyRow => ({
  label: over.key,
  students: 0,
  expected: 0,
  received: 0,
  daysToPay: null,
  ...over,
});

test("the financial year runs April to March", () => {
  assert.equal(financialYearOf(new Date("2026-04-01T00:00:00Z")).label, "2026-27");
  assert.equal(financialYearOf(new Date("2027-03-31T00:00:00Z")).label, "2026-27");
  assert.equal(financialYearOf(new Date("2026-03-31T00:00:00Z")).label, "2025-26");
  const fy = financialYearOf(new Date("2026-10-02T00:00:00Z"));
  assert.equal(fy.from, "2026-04-01");
  assert.equal(fy.to, "2027-03-31");
});

test("the picker offers this year and the ones before it, newest first", () => {
  const years = financialYears(new Date("2026-10-02T00:00:00Z"), 3);
  assert.deepEqual(
    years.map((y) => y.label),
    ["2026-27", "2025-26", "2024-25", "2023-24"],
  );
});

test("a year nobody asked for is the one we are in", () => {
  const today = new Date("2026-10-02T00:00:00Z");
  assert.equal(financialYearFrom(undefined, today).label, "2026-27");
  assert.equal(financialYearFrom("not a year", today).label, "2026-27");
  assert.equal(financialYearFrom("1066", today).label, "2026-27");
  assert.equal(financialYearFrom("2024", today).label, "2024-25");
});

test("nothing is divided by nobody", () => {
  assert.equal(perStudent(100000, 4), 25000);
  assert.equal(perStudent(100000, 0), null);
  assert.equal(perStudent(null, 4), null, "nothing recorded is not nothing earned");
  assert.equal(share(25, 100), 25);
  assert.equal(share(25, 0), null, "a share of nothing is not nought, it is unanswerable");
  assert.equal(share(null, 100), null);
});

test("a column where nobody recorded a figure stays empty rather than reading nought", () => {
  assert.equal(addUp([null, null]), null, "four unpriced lines are not four lines worth nothing");
  assert.equal(addUp([]), null);
  assert.equal(addUp([null, 500, null]), 500, "and one figure among blanks is still that figure");
  assert.equal(addUp([0, null]), 0, "a recorded nought is a real nought");

  const { rows, total } = shape([row({ key: "a", label: "Alpha", students: 4, expected: null, received: null })]);
  assert.equal(rows[0].perStudent, null);
  assert.equal(rows[0].stillToCome, null, "nothing was expected, so nothing is outstanding either");
  assert.equal(total.expected, null);
  assert.equal(total.received, null);
});

test("a row expected but unpaid still shows the whole of it as outstanding", () => {
  const { rows } = shape([row({ key: "a", expected: 90000, received: null, students: 2 })]);
  assert.equal(rows[0].stillToCome, 90000);
});

test("days to pay is the middle invoice, not the average", () => {
  // One vendor who paid after four hundred days must not drag the figure a
  // person reads to choose a road.
  assert.equal(median([40, 50, 60, 400]), 55);
  assert.equal(median([50]), 50);
  assert.equal(median([]), null);
});

test("the money that arrived sorts above the money that was promised", () => {
  const { rows, total } = shape([
    row({ key: "a", label: "Alpha", students: 10, expected: 500, received: 100 }),
    row({ key: "b", label: "Beta", students: 5, expected: 200, received: 400 }),
  ]);
  assert.deepEqual(
    rows.map((r) => r.key),
    ["b", "a"],
  );
  assert.equal(total.received, 500);
  assert.equal(total.students, 15);
  assert.equal(rows[0].perStudent, 80);
});

test("a vendor who overpaid has nothing still to come, not a negative", () => {
  const { rows } = shape([row({ key: "a", expected: 100, received: 180, students: 1 })]);
  assert.equal(rows[0].stillToCome, 0);
});

test("rupees are said the way a person says them", () => {
  assert.equal(inWords(31_000_000), "INR 3.1 cr");
  assert.equal(inWords(3_820_000), "INR 38.2 lakh");
  assert.equal(inWords(4_400), "INR 4,400");
  assert.equal(inWords(null), "Not recorded", "nought is a number somebody acts on; this is not");
  assert.equal(inWords(0), "INR 0");
});

test("an absent figure is said, never shown as nought", () => {
  assert.equal(daysToPayText(null), "Nobody has paid yet");
  assert.equal(daysToPayText(1), "1 day");
  assert.equal(daysToPayText(71), "71 days");
  assert.equal(shareText(null), "Not recorded");
  assert.equal(shareText(0.4), "<1%");
  assert.equal(shareText(86.2), "86%");
});

test("the note about who pays fastest only appears when the gap is worth acting on", () => {
  const close = shape([
    row({ key: "a", label: "Alpha", received: 100, students: 1, daysToPay: 50 }),
    row({ key: "b", label: "Beta", received: 90, students: 1, daysToPay: 58 }),
  ]).rows;
  assert.equal(fastestPayer(close), "", "eight days apart is not a decision");

  const wide = shape([
    row({ key: "a", label: "KC Overseas", received: 100, students: 1, daysToPay: 71 }),
    row({ key: "b", label: "StudentOps360", received: 90, students: 1, daysToPay: 96 }),
  ]).rows;
  assert.match(fastestPayer(wide), /KC Overseas pays in 71 days against StudentOps360's 96/);

  assert.equal(fastestPayer(shape([row({ key: "a", received: 100, students: 1, daysToPay: 50 })]).rows), "", "one row is not a comparison");
  assert.equal(
    fastestPayer(shape([row({ key: "a", received: 100, students: 1 }), row({ key: "b", received: 90, students: 1 })]).rows),
    "",
    "nobody has paid, so nobody pays faster",
  );
});
