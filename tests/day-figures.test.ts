import { strict as assert } from "node:assert";
import test from "node:test";
import { NOT_GIVEN, NOT_GIVEN_YET, addMonths, mergeToday, sumMonth, sumToday, todayBlank, type MonthFigures } from "../src/lib/day-figures";
import { FIGURE_KEYS, type DayEndFigures } from "../src/lib/journal";

const given = (leads: number, calls: number, connected: number, followUps: number, registrations: number): DayEndFigures => ({
  leadsReceived: leads,
  callsMade: calls,
  connectedCalls: connected,
  followUpsDone: followUps,
  registrationsDone: registrations,
});

/* ---------------- Today: the answered report against the portal's count ---------------- */

test("an answered report is today's figures, whatever the portal counted", () => {
  // The counsellor changed calls made from the counted 2 to 5, because three
  // calls were made from their own phone. Their report is the truth.
  const t = mergeToday(given(4, 5, 2, 1, 1), { callsMade: 2, followUpsDone: 1, registrationsDone: 1 });
  assert.equal(t.source, "answered");
  assert.deepEqual(t.figures, given(4, 5, 2, 1, 1));
});

test("with no answered report, today is the portal's count, all five included", () => {
  // The portal now counts leads (enquiries given) and connected calls (calls
  // logged as reached) too, so the live view shows them rather than waiting
  // for the report.
  const t = mergeToday(null, { leadsReceived: 3, callsMade: 2, connectedCalls: 1, followUpsDone: 1, registrationsDone: 0 });
  assert.equal(t.source, "live");
  assert.deepEqual(t.figures, { leadsReceived: 3, callsMade: 2, connectedCalls: 1, followUpsDone: 1, registrationsDone: 0 });
});

test("a figure the count did not deliver is not given yet, while the counted ones show", () => {
  // A count that leaves a key out, or says null for it, has not counted it:
  // the tile reads Not given yet rather than inventing a 0.
  const t = mergeToday(null, { callsMade: 2, followUpsDone: 1, connectedCalls: null });
  assert.equal(t.source, "live");
  assert.deepEqual(t.figures, { leadsReceived: null, callsMade: 2, connectedCalls: null, followUpsDone: 1, registrationsDone: null });
  assert.equal(todayBlank(t.source), NOT_GIVEN_YET);
});

test("a quiet day with nothing counted reads 0 for every figure, not blank", () => {
  // Nothing logged is itself an answer, the same as the report's boxes open:
  // the server delivers a 0 for each of the five when it found nothing.
  const t = mergeToday(undefined, { leadsReceived: 0, callsMade: 0, connectedCalls: 0, followUpsDone: 0, registrationsDone: 0 });
  for (const k of FIGURE_KEYS) assert.equal(t.figures[k], 0, k);
});

test("no count at all leaves every figure not given yet", () => {
  const t = mergeToday(undefined, undefined);
  assert.equal(t.source, "live");
  for (const k of FIGURE_KEYS) assert.equal(t.figures[k], null, k);
});

test("an answered report missing a key keeps it null, and says Not given rather than Not given yet", () => {
  const t = mergeToday({ ...given(1, 2, 3, 4, 5), connectedCalls: null }, { callsMade: 9 });
  assert.equal(t.figures.connectedCalls, null);
  assert.equal(t.figures.callsMade, 2);
  assert.equal(todayBlank(t.source), NOT_GIVEN);
});

/* ---------------- Today across a branch ---------------- */

test("a branch's today adds up answered and live, and counts who has answered", () => {
  const s = sumToday([mergeToday(given(4, 5, 2, 1, 1), null), mergeToday(null, { leadsReceived: 1, callsMade: 3, connectedCalls: 2, followUpsDone: 0, registrationsDone: 0 }), mergeToday(null, {})]);
  assert.equal(s.answered, 1);
  assert.equal(s.of, 3);
  assert.deepEqual(s.figures, { leadsReceived: 5, callsMade: 8, connectedCalls: 4, followUpsDone: 1, registrationsDone: 1 });
});

test("leads and connected calls add up live for a branch where nobody has answered", () => {
  const s = sumToday([
    mergeToday(null, { leadsReceived: 2, callsMade: 3, connectedCalls: 1, followUpsDone: 0, registrationsDone: 0 }),
    mergeToday(null, { leadsReceived: 0, callsMade: 1, connectedCalls: 1, followUpsDone: 0, registrationsDone: 2 }),
  ]);
  assert.equal(s.answered, 0);
  assert.equal(s.figures.leadsReceived, 2);
  assert.equal(s.figures.connectedCalls, 2);
  assert.equal(s.figures.callsMade, 4);
  assert.equal(s.figures.registrationsDone, 2);
});

test("a figure nobody's count delivered stays null across the branch", () => {
  const s = sumToday([mergeToday(null, { callsMade: 3 }), mergeToday(null, { callsMade: 1 })]);
  assert.equal(s.figures.leadsReceived, null);
  assert.equal(s.figures.connectedCalls, null);
  assert.equal(s.figures.callsMade, 4);
});

test("a branch with nobody adds up to nothing given", () => {
  const s = sumToday([]);
  assert.equal(s.of, 0);
  for (const k of FIGURE_KEYS) assert.equal(s.figures[k], null, k);
});

/* ---------------- The month ---------------- */

test("the month adds up the reports answered and counts the days", () => {
  const m = sumMonth([given(4, 5, 2, 1, 1), given(0, 3, 0, 0, 0), given(2, 7, 4, 2, 1)]);
  assert.equal(m.reports, 3);
  assert.deepEqual(m.figures, { leadsReceived: 6, callsMade: 15, connectedCalls: 6, followUpsDone: 3, registrationsDone: 2 });
});

test("a report without figures adds nothing and is not a day answered", () => {
  // A report written as missed, or one answered before the figures were asked
  // for, carries no figures: the month is the figures that were given.
  const m = sumMonth([given(1, 1, 1, 1, 1), null, undefined]);
  assert.equal(m.reports, 1);
  assert.deepEqual(m.figures, given(1, 1, 1, 1, 1));
});

test("a month with no answered report is Not recorded, never 0", () => {
  const m = sumMonth([]);
  assert.equal(m.reports, 0);
  for (const k of FIGURE_KEYS) assert.equal(m.figures[k], null, k);
});

test("a figure nobody gave on any report stays null while the others add up", () => {
  const m = sumMonth([{ ...given(2, 3, 1, 0, 0), leadsReceived: null }, { ...given(1, 4, 2, 1, 0), leadsReceived: null }]);
  assert.equal(m.figures.leadsReceived, null);
  assert.equal(m.figures.callsMade, 7);
});

test("a branch's month is its people's months added up, reports included", () => {
  const a: MonthFigures = sumMonth([given(4, 5, 2, 1, 1), given(1, 2, 1, 0, 0)]);
  const b: MonthFigures = sumMonth([given(0, 6, 3, 2, 1)]);
  const none: MonthFigures = sumMonth([]);
  const all = addMonths([a, b, none]);
  assert.equal(all.reports, 3);
  assert.deepEqual(all.figures, { leadsReceived: 5, callsMade: 13, connectedCalls: 6, followUpsDone: 3, registrationsDone: 2 });
});

test("branches with no report add up to Not recorded", () => {
  const all = addMonths([sumMonth([]), sumMonth([null])]);
  assert.equal(all.reports, 0);
  for (const k of FIGURE_KEYS) assert.equal(all.figures[k], null, k);
});
