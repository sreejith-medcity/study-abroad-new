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
  branchDayNotices,
  figuresByBranch,
  figuresSentence,
  flagNotice,
  givesFigures,
  journalIssued,
  monthFiguresByBranch,
  monthScopeFor,
  monthViewHref,
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

/* ---------------- What a branch head is told ---------------- */

const fig = (leads: number, calls: number, connected: number, followUps: number, registrations: number): DayEndFigures => ({
  leadsReceived: leads,
  callsMade: calls,
  connectedCalls: connected,
  followUpsDone: followUps,
  registrationsDone: registrations,
});

test("the month view link carries the day's month, and the person when one is named", () => {
  assert.equal(monthViewHref("2026-10-23"), "/journal/report?view=month&month=2026-10");
  assert.equal(monthViewHref("2026-10-23", "u1"), "/journal/report?view=month&month=2026-10&user=u1");
});

test("the figures sentence lists the five in order, says where they came from, and reads Not given when nobody gave any", () => {
  assert.equal(figuresSentence(sumFigures([fig(12, 30, 18, 9, 2)]), 5, 6), "Figures from 5 of 6 reports: 12 leads, 30 calls, 18 connected, 9 follow-ups, 2 registrations.");
  assert.equal(figuresSentence(sumFigures([fig(3, 4, 1, 0, 0)]), 1, 1), "Figures from 1 of 1 report: 3 leads, 4 calls, 1 connected, 0 follow-ups, 0 registrations.");
  assert.equal(figuresSentence(sumFigures([]), 0, 4), "Figures: Not given.");
});

test("one notice per branch for its heads, with the counts and the branch's figures, and none for the head office", () => {
  const kot = { orgId: "kot", orgType: "BRANCH", branch: "Medcity Kottayam" };
  const hq = { orgId: "hq", orgType: "HQ", branch: "Medcity International Overseas Corporation" };
  const people = [
    { id: "head", name: "Kottayam Branch Head", role: "PARTNER", standing: "VERIFIED" as const, figures: fig(1, 2, 1, 0, 0), ...kot },
    { id: "uk", name: "UK Documentation", role: "COUNSELLOR", standing: "VERIFIED_LATE" as const, figures: fig(4, 5, 2, 1, 1), ...kot },
    { id: "de", name: "Germany Counsellor", role: "COUNSELLOR", standing: "VERIFIED" as const, figures: fig(0, 2, 0, 0, 0), ...kot },
    { id: "tr", name: "Rohit Das", role: "TRAINEE_COUNSELLOR", standing: "FLAGGED" as const, figures: fig(2, 1, 1, 0, 0), ...kot },
    { id: "sr", name: "Anju Mathew", role: "SENIOR_COUNSELLOR", standing: "MISSED" as const, figures: null, ...kot },
    { id: "adm", name: "Anita Menon", role: "ADMIN", standing: "VERIFIED" as const, figures: null, ...hq },
    { id: "doc", name: "Nithin Jose", role: "DOCUMENTATION", standing: "MISSED" as const, figures: null, ...hq },
  ];
  const notices = branchDayNotices("2026-10-23", people, figuresByBranch(people));
  assert.equal(notices.length, 1, "the head office is not a branch");
  const [n] = notices;
  assert.equal(n.orgId, "kot");
  assert.deepEqual(n.heads, ["head"]);
  assert.equal(n.title, "Medcity Kottayam's day end: 3 of 5 verified");
  assert.equal(n.body, "Day end reports for 23 Oct 2026: 2 verified, 1 verified after hours, 1 flagged a problem, 1 missed. Figures from 4 of 5 reports: 7 leads, 10 calls, 4 connected, 1 follow-up, 1 registration.");
  assert.equal(n.href, "/journal/report?view=month&month=2026-10");
  assert.ok(!n.body.includes("—"), "no em dashes");
});

test("a branch with two heads is told once, to both; a branch with no head is left out", () => {
  const people = [
    { id: "h1", name: "Head One", role: "PARTNER", orgId: "koc", orgType: "BRANCH", branch: "Medcity Kochi", standing: "VERIFIED" as const, figures: fig(1, 1, 1, 1, 1) },
    { id: "h2", name: "Head Two", role: "PARTNER", orgId: "koc", orgType: "BRANCH", branch: "Medcity Kochi", standing: "PENDING" as const, figures: null },
    { id: "c", name: "Counsellor", role: "COUNSELLOR", orgId: "tvm", orgType: "BRANCH", branch: "Medcity Trivandrum", standing: "VERIFIED" as const, figures: fig(1, 1, 1, 1, 1) },
  ];
  const notices = branchDayNotices("2026-10-23", people, figuresByBranch(people));
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].heads, ["h1", "h2"]);
  assert.equal(notices[0].title, "Medcity Kochi's day end: 1 of 2 verified");
  assert.equal(notices[0].body, "Day end reports for 23 Oct 2026: 1 verified, 1 not yet answered. Figures from 1 of 2 reports: 1 lead, 1 call, 1 connected, 1 follow-up, 1 registration.");
});

test("a branch where nobody answered reads 0 verified and Not given", () => {
  const people = [
    { id: "h", name: "Head", role: "PARTNER", orgId: "kot", orgType: "BRANCH", branch: "Medcity Kottayam", standing: "MISSED" as const, figures: null },
    { id: "c", name: "Counsellor", role: "COUNSELLOR", orgId: "kot", orgType: "BRANCH", branch: "Medcity Kottayam", standing: "MISSED" as const, figures: null },
  ];
  const [n] = branchDayNotices("2026-10-22", people, figuresByBranch(people));
  assert.equal(n.title, "Medcity Kottayam's day end: 0 of 2 verified");
  assert.equal(n.body, "Day end reports for 22 Oct 2026: 0 verified, 2 missed. Figures: Not given.");
});

test("a flag notice names the person and carries their note", () => {
  const n = flagNotice("Rohit Das", "2026-10-23", "The call at noon was Rohit's, not mine.");
  assert.equal(n.title, "Rohit Das flagged a problem on their day end report");
  assert.equal(n.body, "23 Oct 2026. Rohit Das wrote: The call at noon was Rohit's, not mine.");
});
