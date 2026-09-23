import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreMatch, yearlyInr, type ScoreProgram } from "../src/lib/finder-score";
import type { Eligibility } from "../src/lib/eligibility";

const RATES = { GBP: 110, CAD: 62, EUR: 95 };
const TODAY = new Date(2026, 8, 23);

const program = (over: Partial<ScoreProgram> = {}): ScoreProgram => ({
  level: "PG",
  studyArea: "Computer Science",
  tuitionPerYear: 20000,
  tuitionTotal: null,
  durationMonths: 12,
  currency: "CAD",
  intakeMonths: [1, 9],
  tags: [],
  workRights: "UNKNOWN",
  feeWaiver: null,
  applicationFee: 100,
  initialDeposit: null,
  moiAccepted: false,
  typicalScholarship: null,
  offerTatDays: null,
  qsRank: null,
  theRank: null,
  ...over,
});

const fit = (over: Partial<Eligibility> = {}): Eligibility => ({ verdict: "eligible", met: ["English (IELTS 6.5)"], missing: [], onTrack: [], ...over });
const wants = (over = {}) => ({ months: [], field: null, budgetInr: null, prefs: [] as string[], ...over });

test("a program that meets everything and fits the plan is a strong match", () => {
  const m = scoreMatch(program(), { fit: fit(), wants: wants({ months: [9], field: "Computer Science", budgetInr: 15e5 }), rates: RATES, deadline: null, today: TODAY });
  assert.equal(m.band, "strong");
  assert.ok(m.reasons.some((r) => r.includes("Meets every requirement on record")));
  assert.ok(m.reasons.some((r) => r.includes("Sep intake")));
  assert.ok(m.reasons.some((r) => r.includes("inside the budget")));
  assert.deepEqual(m.cautions, []);
});

test("anything the student is blocked on is a stretch, with the reason said", () => {
  const m = scoreMatch(program(), { fit: fit({ verdict: "blocked", met: [], missing: ["English: needs IELTS 6.5"] }), wants: wants(), rates: RATES, deadline: null, today: TODAY });
  assert.equal(m.band, "stretch");
  assert.deepEqual(m.cautions, ["English: needs IELTS 6.5"]);
});

test("an over-budget fee is a caution, never a silent drop", () => {
  const m = scoreMatch(program({ tuitionPerYear: 40000 }), { fit: fit(), wants: wants({ budgetInr: 15e5 }), rates: RATES, deadline: null, today: TODAY });
  assert.ok(m.cautions.some((c) => c.includes("over the budget")));
  assert.ok(!m.reasons.some((r) => r.includes("inside the budget")));
});

test("a fee in a currency with no rate, or none at all, is said rather than guessed", () => {
  const noRate = scoreMatch(program({ currency: "AUD" }), { fit: null, wants: wants({ budgetInr: 15e5 }), rates: RATES, deadline: null, today: TODAY });
  assert.ok(noRate.cautions.some((c) => c.includes("No rate is set")));
  const none = scoreMatch(program({ tuitionPerYear: null }), { fit: null, wants: wants({ budgetInr: 15e5 }), rates: RATES, deadline: null, today: TODAY });
  assert.ok(none.cautions.some((c) => c.includes("Tuition is not recorded")));
});

test("a whole-course fee is only averaged to test a budget, never shown as a yearly figure", () => {
  const p = program({ tuitionPerYear: null, tuitionTotal: 30000, durationMonths: 24, currency: "CAD" });
  const money = yearlyInr(p, RATES)!;
  assert.equal(money.perYear, false);
  assert.equal(Math.round(money.inr), 930000);
  const m = scoreMatch(p, { fit: null, wants: wants({ budgetInr: 10e5 }), rates: RATES, deadline: null, today: TODAY });
  assert.ok(m.reasons.some((r) => r.includes("whole course")));
});

test("the intake and the deadline are read from what is recorded", () => {
  const miss = scoreMatch(program({ intakeMonths: [1] }), { fit: null, wants: wants({ months: [9, 10, 11, 12] }), rates: RATES, deadline: null, today: TODAY });
  assert.ok(miss.cautions.some((c) => c.includes("Intakes on record are Jan")));
  const open = scoreMatch(program(), { fit: fit(), wants: wants(), rates: RATES, deadline: { deadline: "2026-10-01", intakeMonth: 1, intakeYear: 2027 }, today: TODAY });
  assert.ok(open.reasons.some((r) => r.includes("apply by 1 Oct 2026")));
  const past = scoreMatch(program(), { fit: fit(), wants: wants(), rates: RATES, deadline: { deadline: "2026-08-01", intakeMonth: 9, intakeYear: 2026 }, today: TODAY });
  assert.ok(past.cautions.some((c) => c.includes("has passed")));
});

test("a preference only scores when the program records it", () => {
  const without = scoreMatch(program(), { fit: fit(), wants: wants({ prefs: ["workRights"] }), rates: RATES, deadline: null, today: TODAY });
  const with_ = scoreMatch(program({ workRights: "ELIGIBLE" }), { fit: fit(), wants: wants({ prefs: ["workRights"] }), rates: RATES, deadline: null, today: TODAY });
  assert.equal(with_.score - without.score, 4);
  assert.ok(with_.reasons.some((r) => r.includes("Post-study work")));
});

test("a fast offer counts, and an unrecorded one is not guessed at", () => {
  const fast = scoreMatch(program({ offerTatDays: 3 }), { fit: fit(), wants: wants(), rates: RATES, deadline: null, today: TODAY });
  const slow = scoreMatch(program({ offerTatDays: 21 }), { fit: fit(), wants: wants(), rates: RATES, deadline: null, today: TODAY });
  const none = scoreMatch(program(), { fit: fit(), wants: wants(), rates: RATES, deadline: null, today: TODAY });
  assert.ok(fast.reasons.some((r) => r === "Offer usually in 3 days"));
  assert.equal(fast.score - slow.score, 4);
  assert.equal(slow.score, none.score);
  assert.ok(!none.reasons.some((r) => /Offer usually/.test(r)));
});

test("a published rank is quoted as published", () => {
  const m = scoreMatch(program({ qsRank: "154", theRank: "601-650" }), { fit: fit(), wants: wants(), rates: RATES, deadline: null, today: TODAY });
  assert.ok(m.reasons.some((r) => r === "QS #154"));
});
