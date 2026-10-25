import { strict as assert } from "node:assert";
import test from "node:test";
import {
  FIGURE_BLANK,
  FIGURE_KEYS,
  FIGURE_LABEL,
  FIGURE_MAX,
  FIGURE_NOT_WHOLE,
  FIGURE_TOO_BIG,
  FIGURES_ROLES,
  figuresByBranch,
  givesFigures,
  journalIssued,
  parseFigures,
  prefillFigures,
  sumFigures,
  type DayEndFigures,
} from "../src/lib/journal";
import { APP_ROLES, COUNSELLING_ROLES } from "../src/lib/permissions";

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

test("pre-fill puts the portal's counts in their boxes and leaves the two typed ones blank", () => {
  assert.deepEqual(prefillFigures({ callsMade: 7, followUpsDone: 2, registrationsDone: 1 }), {
    leadsReceived: null,
    callsMade: 7,
    connectedCalls: null,
    followUpsDone: 2,
    registrationsDone: 1,
  });
});

test("a day with nothing counted pre-fills 0, not blank, for the counted figures", () => {
  // Nothing logged is itself an answer; a blank would make them type 0 three
  // times on a quiet day.
  assert.deepEqual(prefillFigures({}), { leadsReceived: null, callsMade: 0, connectedCalls: null, followUpsDone: 0, registrationsDone: 0 });
  assert.deepEqual(prefillFigures({ callsMade: 3 }), { leadsReceived: null, callsMade: 3, connectedCalls: null, followUpsDone: 0, registrationsDone: 0 });
});

test("pre-fill never fills leads received or connected calls", () => {
  const f = prefillFigures({ callsMade: 4 });
  assert.equal(f.leadsReceived, null);
  assert.equal(f.connectedCalls, null);
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
