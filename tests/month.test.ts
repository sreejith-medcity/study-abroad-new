import { strict as assert } from "node:assert";
import test from "node:test";
import { isMonth, monthBounds, monthDays, monthText, shiftMonth, thisMonth } from "../src/lib/month";

/* ---------------- Which month it is, in India ---------------- */

test("this month is read in India time, not the server's", () => {
  // 7 PM UTC on 31 October is already half past midnight on 1 November in Kottayam.
  assert.equal(thisMonth(new Date("2026-10-31T19:00:00Z")), "2026-11");
  // And 6 PM UTC is still 11:30 PM on the 31st.
  assert.equal(thisMonth(new Date("2026-10-31T18:00:00Z")), "2026-10");
  assert.equal(thisMonth(new Date("2026-12-31T18:30:00Z")), "2027-01");
});

test("a month is YYYY-MM with a real month number", () => {
  assert.ok(isMonth("2026-10"));
  assert.ok(isMonth("2026-01"));
  assert.ok(isMonth("2026-12"));
  assert.equal(isMonth("2026-13"), false);
  assert.equal(isMonth("2026-00"), false);
  assert.equal(isMonth("2026-1"), false);
  assert.equal(isMonth("2026-10-01"), false);
  assert.equal(isMonth(undefined), false);
  assert.equal(isMonth(""), false);
});

/* ---------------- Moving between months ---------------- */

test("shifting a month crosses the year both ways", () => {
  assert.equal(shiftMonth("2026-10", 1), "2026-11");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-03", -15), "2024-12");
  assert.equal(shiftMonth("2026-10", 0), "2026-10");
});

test("a month is said in words", () => {
  assert.equal(monthText("2026-10"), "October 2026");
  assert.equal(monthText("2027-01"), "January 2027");
});

/* ---------------- The month's edges ---------------- */

test("the month's days run from its first to the next month's first, for a date column", () => {
  assert.deepEqual(monthDays("2026-10"), { first: "2026-10-01", next: "2026-11-01" });
  assert.deepEqual(monthDays("2026-12"), { first: "2026-12-01", next: "2027-01-01" });
  // A February of 28 and one of 29 both end where March begins.
  assert.deepEqual(monthDays("2026-02"), { first: "2026-02-01", next: "2026-03-01" });
  assert.deepEqual(monthDays("2028-02"), { first: "2028-02-01", next: "2028-03-01" });
});

test("the month's instants are India midnights, for a timestamp column", () => {
  const { from, to } = monthBounds("2026-10");
  // Midnight on 1 October in Kottayam is half past six the evening before in UTC.
  assert.equal(from.toISOString(), "2026-09-30T18:30:00.000Z");
  assert.equal(to.toISOString(), "2026-10-31T18:30:00.000Z");
  // The last instant of the month is before the bound; the first of the next is not.
  assert.ok(new Date("2026-10-31T18:29:59Z") < to);
  assert.ok(!(new Date("2026-10-31T18:30:00Z") < to));
});

test("the day a report falls on sits inside its month's days and nowhere else", () => {
  const { first, next } = monthDays("2026-10");
  const inMonth = (day: string) => day >= first && day < next;
  assert.ok(inMonth("2026-10-01"));
  assert.ok(inMonth("2026-10-31"));
  assert.equal(inMonth("2026-09-30"), false);
  assert.equal(inMonth("2026-11-01"), false);
});
