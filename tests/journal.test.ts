import { strict as assert } from "node:assert";
import test from "node:test";
import {
  COUNTED_FIGURES,
  FIGURE_BLANK,
  FIGURE_KEYS,
  FIGURE_LABEL,
  FIGURE_MAX,
  FIGURE_NOT_WHOLE,
  FIGURE_SOURCE,
  FIGURE_TOO_BIG,
  FIGURES_ROLES,
  figuresByBranch,
  givesFigures,
  journalIssued,
  monthFiguresByBranch,
  monthScopeFor,
  parseFigures,
  prefillFigures,
  readsMonthFigures,
  sumFigures,
  type DayEndFigures,
  type MonthPerson,
} from "../src/lib/journal";
import { APP_ROLES, COUNSELLING_ROLES } from "../src/lib/permissions";
import { CONNECTED_OUTCOMES, isConnected } from "../src/lib/crm";
import { contactOutcome } from "../src/db/schema";

/* ---------------- Who gives the figures ---------------- */

test("every counselling role and the branch head give figures; nobody else does", () => {
  for (const role of COUNSELLING_ROLES) assert.ok(givesFigures(role), role);
  assert.ok(givesFigures("PARTNER"), "the branch head counsels too");
  for (const role of APP_ROLES) {
    if ((FIGURES_ROLES as readonly string[]).includes(role)) continue;
    assert.equal(givesFigures(role), false, role);
  }
  assert.equal(givesFigures("DOCUMENTATION"), false);
  assert.equal(givesFigures("ADMIN"), false);
});

test("the figures are only asked of people who are issued a report in the first place", () => {
  // A sub-agent's counsellor has the role but not the report, so the boxes
  // never reach them: the report decides first, the role second.
  assert.equal(journalIssued("SUB_AGENT_COUNSELLOR", "PARTNER"), false);
  assert.equal(journalIssued("COUNSELLOR", "BRANCH"), true);
});

test("the five keys are in box order and each has a label", () => {
  assert.deepEqual([...FIGURE_KEYS], ["leadsReceived", "callsMade", "connectedCalls", "followUpsDone", "registrationsDone"]);
  for (const k of FIGURE_KEYS) assert.ok(FIGURE_LABEL[k].length > 0, k);
});

/* ---------------- Pre-fill ---------------- */

test("pre-fill puts the portal's counts in all five boxes", () => {
  assert.deepEqual(prefillFigures({ leadsReceived: 3, callsMade: 7, connectedCalls: 4, followUpsDone: 2, registrationsDone: 1 }), {
    leadsReceived: 3,
    callsMade: 7,
    connectedCalls: 4,
    followUpsDone: 2,
    registrationsDone: 1,
  });
});

test("every figure is counted, in box order", () => {
  assert.deepEqual([...COUNTED_FIGURES], [...FIGURE_KEYS]);
});

test("a day with nothing counted pre-fills 0, not blank, for every box", () => {
  // Nothing logged is itself an answer; a blank would make them type 0 five
  // times on a quiet day.
  assert.deepEqual(prefillFigures({}), { leadsReceived: 0, callsMade: 0, connectedCalls: 0, followUpsDone: 0, registrationsDone: 0 });
  assert.deepEqual(prefillFigures({ callsMade: 3 }), { leadsReceived: 0, callsMade: 3, connectedCalls: 0, followUpsDone: 0, registrationsDone: 0 });
});

test("a count the portal could not make opens at 0 too, never blank", () => {
  const f = prefillFigures({ callsMade: 4, connectedCalls: null, leadsReceived: null });
  assert.equal(f.leadsReceived, 0);
  assert.equal(f.connectedCalls, 0);
});

test("each box says where its number came from", () => {
  for (const k of FIGURE_KEYS) assert.match(FIGURE_SOURCE[k], /^from the /, k);
  assert.equal(FIGURE_SOURCE.connectedCalls, "from the calls you logged as reached");
  assert.equal(FIGURE_SOURCE.leadsReceived, "from the enquiries given to you today");
});

/* ---------------- Which calls count as connected ---------------- */

test("a call is connected when somebody answered and spoke, whatever they said", () => {
  for (const o of ["REACHED", "WILL_SEND", "WANTS_TIME", "NEEDS_COUNSELLING", "NOT_INTERESTED"] as const) assert.ok(isConnected(o), o);
});

test("no answer, a wrong number and an outcome that says nothing are not connected", () => {
  for (const o of ["NO_ANSWER", "WRONG_NUMBER", "OTHER"] as const) assert.equal(isConnected(o), false, o);
});

test("every outcome is decided one way or the other, so a new outcome cannot slip through uncounted", () => {
  const decided = new Set<string>([...CONNECTED_OUTCOMES, "NO_ANSWER", "WRONG_NUMBER", "OTHER"]);
  for (const o of contactOutcome.enumValues) assert.ok(decided.has(o), o);
  assert.equal(decided.size, contactOutcome.enumValues.length);
});

test("connected calls never exceed calls made when both are counted from the same calls", () => {
  // The server counts both figures from the same contact_log rows, the second
  // with the outcome filter on top. Counting a day's calls the same way here
  // shows the second can only ever be a subset of the first.
  const calls = [
    { channel: "CALL", outcome: "REACHED" },
    { channel: "CALL", outcome: "NO_ANSWER" },
    { channel: "CALL", outcome: "NOT_INTERESTED" },
    { channel: "WHATSAPP", outcome: "WILL_SEND" },
    { channel: "CALL", outcome: "OTHER" },
  ] as const;
  const made = calls.filter((c) => c.channel === "CALL");
  const connected = made.filter((c) => isConnected(c.outcome));
  const f = prefillFigures({ callsMade: made.length, connectedCalls: connected.length });
  assert.equal(f.callsMade, 4);
  assert.equal(f.connectedCalls, 2);
  assert.ok(f.connectedCalls! <= f.callsMade!);
  // And for any set of outcomes at all, not just this one.
  for (const o of contactOutcome.enumValues) {
    const one = [{ channel: "CALL" as const, outcome: o }];
    assert.ok(one.filter((c) => isConnected(c.outcome)).length <= one.length, o);
  }
});

/* ---------------- Validation ---------------- */

const all = (v: string): Record<(typeof FIGURE_KEYS)[number], string> => ({ leadsReceived: v, callsMade: v, connectedCalls: v, followUpsDone: v, registrationsDone: v });

test("five whole numbers are accepted, 0 included", () => {
  const r = parseFigures({ leadsReceived: "4", callsMade: "12", connectedCalls: "0", followUpsDone: "3", registrationsDone: "1" });
  assert.ok(r.ok);
  assert.deepEqual(r.figures, { leadsReceived: 4, callsMade: 12, connectedCalls: 0, followUpsDone: 3, registrationsDone: 1 });
});

test("a blank box is refused with a message under that box, and only that box", () => {
  const r = parseFigures({ leadsReceived: "", callsMade: "12", connectedCalls: "0", followUpsDone: "3", registrationsDone: "1" });
  assert.ok(!r.ok);
  assert.deepEqual(r.fieldErrors, { leadsReceived: [FIGURE_BLANK] });
});

test("a missing box counts as blank", () => {
  const r = parseFigures({ callsMade: "1" });
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.fieldErrors).sort(), ["connectedCalls", "followUpsDone", "leadsReceived", "registrationsDone"]);
});

test("every blank box gets its own message", () => {
  const r = parseFigures(all(""));
  assert.ok(!r.ok);
  assert.equal(Object.keys(r.fieldErrors).length, 5);
});

test("a fraction, a negative number or words are refused", () => {
  for (const bad of ["1.5", "-2", "two", "3e2", "0x10"]) {
    const r = parseFigures({ ...all("1"), callsMade: bad });
    assert.ok(!r.ok, bad);
    assert.deepEqual(r.fieldErrors, { callsMade: [FIGURE_NOT_WHOLE] }, bad);
  }
});

test("spaces and thousands separators are forgiven", () => {
  const r = parseFigures({ ...all("0"), leadsReceived: " 1,250 " });
  assert.ok(r.ok);
  assert.equal(r.figures.leadsReceived, 1250);
});

test("a figure beyond a day's reach is refused as a slipped key", () => {
  const r = parseFigures({ ...all("0"), callsMade: String(FIGURE_MAX + 1) });
  assert.ok(!r.ok);
  assert.deepEqual(r.fieldErrors, { callsMade: [FIGURE_TOO_BIG] });
  assert.ok(parseFigures({ ...all("0"), callsMade: String(FIGURE_MAX) }).ok);
});

test("null and undefined read as blank rather than throwing", () => {
  const r = parseFigures({ leadsReceived: null, callsMade: undefined, connectedCalls: "1", followUpsDone: "1", registrationsDone: "1" });
  assert.ok(!r.ok);
  assert.deepEqual(Object.keys(r.fieldErrors).sort(), ["callsMade", "leadsReceived"]);
});

/* ---------------- Totals ---------------- */

const given = (n: number): DayEndFigures => ({ leadsReceived: n, callsMade: n * 2, connectedCalls: n, followUpsDone: 1, registrationsDone: 0 });

test("totals add up what was given and skip whoever gave nothing", () => {
  assert.deepEqual(sumFigures([given(2), null, given(3), undefined]), { leadsReceived: 5, callsMade: 10, connectedCalls: 5, followUpsDone: 2, registrationsDone: 0 });
  assert.deepEqual(sumFigures([]), { leadsReceived: 0, callsMade: 0, connectedCalls: 0, followUpsDone: 0, registrationsDone: 0 });
});

test("a null inside somebody's figures adds nothing", () => {
  assert.deepEqual(sumFigures([{ ...given(1), leadsReceived: null }]).leadsReceived, 0);
});

test("the report groups counsellors by branch with a total each and one overall, and leaves out the roles not asked", () => {
  const people = [
    { id: "d", name: "Nithin", role: "DOCUMENTATION", orgId: "hq", branch: "Medcity International", figures: null },
    { id: "s", name: "Sneha", role: "DESK_COUNSELLOR", orgId: "hq", branch: "Medcity International", figures: given(1) },
    { id: "u", name: "UK Documentation", role: "COUNSELLOR", orgId: "kot", branch: "Medcity Kottayam", figures: given(4) },
    { id: "g", name: "Germany Counsellor", role: "COUNSELLOR", orgId: "kot", branch: "Medcity Kottayam", figures: null },
    { id: "h", name: "Kottayam Branch Head", role: "PARTNER", orgId: "kot", branch: "Medcity Kottayam", figures: given(2) },
    { id: "a", name: "Anita", role: "ADMIN", orgId: "hq", branch: "Medcity International", figures: null },
  ];
  const r = figuresByBranch(people);
  assert.deepEqual(
    r.branches.map((b) => b.orgId),
    ["hq", "kot"],
    "branches in the order people arrive",
  );
  assert.deepEqual(r.branches[0].people.map((p) => p.id), ["s"], "the documentation officer and the admin have no row");
  assert.deepEqual(r.branches[1].people.map((p) => p.id), ["g", "h", "u"], "people within a branch by name");
  assert.deepEqual(r.branches[1].totals, { leadsReceived: 6, callsMade: 12, connectedCalls: 6, followUpsDone: 2, registrationsDone: 0 });
  assert.equal(r.branches[1].given, 2, "the branch says how many of its people gave figures");
  assert.equal(r.branches[1].people.length, 3);
  assert.deepEqual(r.totals, { leadsReceived: 7, callsMade: 14, connectedCalls: 7, followUpsDone: 3, registrationsDone: 0 });
  assert.equal(r.people, 4);
  assert.equal(r.given, 3);
});

test("a branch whose counsellors all gave nothing still has a row of zeros, not a missing branch", () => {
  const r = figuresByBranch([{ id: "g", name: "G", role: "COUNSELLOR", orgId: "koc", branch: "Medcity Kochi", figures: null }]);
  assert.equal(r.branches.length, 1);
  assert.deepEqual(r.branches[0].totals, { leadsReceived: 0, callsMade: 0, connectedCalls: 0, followUpsDone: 0, registrationsDone: 0 });
  assert.equal(r.branches[0].given, 0);
});

/* ---------------- A month of figures ---------------- */

const month = (id: string, orgId: string, branch: string, answered: number, missed: number, n: number): MonthPerson => ({
  id,
  name: id,
  role: "COUNSELLOR",
  orgId,
  branch,
  answered,
  missed,
  figures: { leadsReceived: n, callsMade: n * 10, connectedCalls: n * 2, followUpsDone: n, registrationsDone: 1 },
});

test("a month groups the counsellors by branch and stacks the sums, the days answered and the days missed", () => {
  const r = monthFiguresByBranch([
    month("sneha", "hq", "Medcity International", 20, 2, 5),
    month("uk", "kot", "Medcity Kottayam", 22, 0, 40),
    month("germany", "kot", "Medcity Kottayam", 18, 4, 10),
    month("head", "kot", "Medcity Kottayam", 0, 0, 0),
  ]);
  assert.deepEqual(r.branches.map((b) => b.orgId), ["hq", "kot"], "branches in the order the database sends people");
  assert.deepEqual(r.branches[1].people.map((p) => p.id), ["uk", "germany", "head"], "people kept in the order they arrive, already sorted by name in the query");
  assert.deepEqual(r.branches[1].totals, { leadsReceived: 50, callsMade: 500, connectedCalls: 100, followUpsDone: 50, registrationsDone: 3 });
  assert.equal(r.branches[1].answered, 40);
  assert.equal(r.branches[1].missed, 4);
  assert.deepEqual(r.totals, { leadsReceived: 55, callsMade: 550, connectedCalls: 110, followUpsDone: 55, registrationsDone: 4 });
  assert.equal(r.answered, 60);
  assert.equal(r.missed, 6);
  assert.equal(r.people, 4);
});

test("a month with nobody in it has no branches and totals of zero", () => {
  const r = monthFiguresByBranch([]);
  assert.deepEqual(r.branches, []);
  assert.deepEqual(r.totals, { leadsReceived: 0, callsMade: 0, connectedCalls: 0, followUpsDone: 0, registrationsDone: 0 });
  assert.equal(r.answered, 0);
  assert.equal(r.missed, 0);
});

test("the report's readers and a Medcity branch head read the month of figures; a sub-agent's owner and a counsellor do not", () => {
  assert.ok(readsMonthFigures("ADMIN", "HQ"));
  assert.ok(readsMonthFigures("MANAGEMENT", "HQ"));
  assert.ok(readsMonthFigures("PARTNER", "BRANCH"));
  assert.equal(readsMonthFigures("PARTNER", "SUB_AGENT"), false);
  assert.equal(readsMonthFigures("COUNSELLOR", "BRANCH"), false);
  assert.equal(readsMonthFigures("DOCUMENTATION", "HQ"), false);
});

test("the month's scope: every branch or the one picked for the report's readers, their own and only their own for a branch head", () => {
  assert.deepEqual(monthScopeFor({ role: "ADMIN", orgId: "hq", orgType: "HQ" }), { every: true, orgIds: null, org: null });
  assert.deepEqual(monthScopeFor({ role: "ADMIN", orgId: "hq", orgType: "HQ" }, "kot"), { every: true, orgIds: ["kot"], org: "kot" });
  // The address asks for another branch; the branch head still gets theirs.
  assert.deepEqual(monthScopeFor({ role: "PARTNER", orgId: "kot", orgType: "BRANCH" }, "koc"), { every: false, orgIds: ["kot"], org: "kot" });
  assert.equal(monthScopeFor({ role: "COUNSELLOR", orgId: "kot", orgType: "BRANCH" }), null);
  assert.equal(monthScopeFor({ role: "PARTNER", orgId: "hor", orgType: "SUB_AGENT" }), null);
});
