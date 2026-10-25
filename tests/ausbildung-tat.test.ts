import { test } from "node:test";
import assert from "node:assert/strict";
import { AUSBILDUNG_STEPS, TAT_TASK_KEY_PREFIX, tatOverdue, tatOwners, tatStanding, tatTaskKey, timedStatusCodes, stepOfStatus } from "../src/lib/ausbildung";
import { ADMIN_ROLES, DOCUMENTATION_ROLES } from "../src/lib/permissions";

const day = 86_400_000;
const now = new Date("2026-10-26T04:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * day);

test("a file inside its turnaround is not over, and is over by nothing", () => {
  // Document collection, T+7: seven whole days is still within the guide.
  const t = tatOverdue("DOCUMENT_COLLECTION", ago(7), now);
  assert.equal(t.over, false);
  assert.equal(t.daysOver, 0);
  assert.equal(t.days, 7);
  assert.equal(t.step?.step, 3);
});

test("the day after the turnaround the file is over by one, and the count grows a day at a time", () => {
  assert.deepEqual([tatOverdue("DOCUMENT_COLLECTION", ago(8), now).over, tatOverdue("DOCUMENT_COLLECTION", ago(8), now).daysOver], [true, 1]);
  assert.equal(tatOverdue("DOCUMENT_COLLECTION", ago(17), now).daysOver, 10);
  // A part day never counts: 7.9 days is still seven.
  assert.equal(tatOverdue("DOCUMENT_COLLECTION", new Date(now.getTime() - 7.9 * day), now).over, false);
});

test("a same-day step is over from the next day", () => {
  assert.equal(tatOverdue("MENTOR_ASSIGNED", ago(0), now).over, false);
  assert.equal(tatOverdue("MENTOR_ASSIGNED", new Date(now.getTime() - 0.5 * day), now).over, false);
  const t = tatOverdue("MENTOR_ASSIGNED", ago(1), now);
  assert.equal(t.over, true);
  assert.equal(t.daysOver, 1);
});

test("a step whose turnaround depends on something else is never over, however long it sits", () => {
  for (const code of ["LANGUAGE_PENDING", "LANGUAGE_ASSESSMENT", "VISA_FILED"]) {
    const t = tatOverdue(code, ago(400), now);
    assert.equal(t.over, false, `${code} is never late`);
    assert.equal(t.daysOver, 0);
    assert.equal(t.step?.tatDays, null);
  }
});

test("a status the guide does not place, or no status, or no entry time, is not over", () => {
  assert.equal(tatOverdue("ON_HOLD", ago(100), now).over, false);
  assert.equal(tatOverdue(null, ago(100), now).over, false);
  assert.equal(tatOverdue("DOCUMENT_COLLECTION", null, now).over, false);
  assert.equal(tatOverdue("DOCUMENT_COLLECTION", null, now).days, null);
});

test("tatOverdue reads the same arithmetic as the tracker's cell", () => {
  for (const [code, days] of [["EMPLOYER_INTERVIEW", 31], ["EMPLOYER_INTERVIEW", 30], ["PRE_VISA_DOCUMENTS", 9], ["VISA_PROCESSING", 45], ["HAPPY_CALL", 3]] as const) {
    const cell = tatStanding(code, ago(days), now);
    const job = tatOverdue(code, ago(days), now);
    assert.equal(job.over, cell.over, `${code} at ${days} days`);
    assert.equal(job.daysOver, cell.daysOver);
    if (cell.over) assert.equal(cell.daysOver, cell.days! - cell.tatDays!);
  }
});

test("the timed codes are exactly the statuses of steps with a number of days", () => {
  const timed = timedStatusCodes();
  const expected = AUSBILDUNG_STEPS.filter((s) => s.tatDays != null).flatMap((s) => s.statusCodes);
  assert.deepEqual(timed.map((t) => t.code), expected);
  for (const t of timed) {
    const step = stepOfStatus(t.code)!;
    assert.equal(t.step, step.step);
    assert.equal(t.tatDays, step.tatDays);
  }
  assert.ok(!timed.some((t) => t.code === "LANGUAGE_PENDING"), "a step with no number is left out");
  assert.equal(new Set(timed.map((t) => t.code)).size, timed.length, "no code twice");
});

test("the documentation desk owns the documentation and language steps", () => {
  for (const dept of ["DOCUMENTATION", "LANGUAGE"] as const) {
    const o = tatOwners(dept);
    assert.deepEqual(o.roles, [...DOCUMENTATION_ROLES]);
    assert.equal(o.branch, false);
  }
});

test("the team leader and the admins own the placement, visa and travel steps", () => {
  for (const dept of ["PLACEMENT", "VISA", "TRAVEL"] as const) {
    const o = tatOwners(dept);
    assert.ok(o.roles.includes("APPLICATION_TEAM_LEADER"));
    for (const r of ADMIN_ROLES) assert.ok(o.roles.includes(r), `${r} owns ${dept}`);
    assert.ok(!o.roles.includes("DOCUMENTATION"), "a documentation officer is not told about the placement desk's files");
    assert.equal(o.branch, false);
  }
});

test("the counselling steps are the branch's: the head and the counsellor, no desk role", () => {
  const o = tatOwners("COUNSELLING");
  assert.deepEqual(o.roles, []);
  assert.equal(o.branch, true);
  assert.deepEqual(tatOwners(null), { roles: [], branch: false });
});

test("every step of the written process has somebody who owns its turnaround", () => {
  for (const step of AUSBILDUNG_STEPS) {
    const o = tatOwners(step.department);
    assert.ok(o.roles.length > 0 || o.branch, `step ${step.step} (${step.department}) has an owner`);
  }
});

test("the task key is one per application per stay in a step, and all keys share the prefix", () => {
  const since = new Date("2026-10-01T03:30:00.000Z");
  const key = tatTaskKey("app1", 10, since);
  assert.ok(key.startsWith(TAT_TASK_KEY_PREFIX));
  assert.equal(key, tatTaskKey("app1", 10, new Date(since.getTime())), "the same stay gives the same key");
  assert.notEqual(key, tatTaskKey("app1", 10, new Date(since.getTime() + 1000)), "a later entry into the same step is a new stay");
  assert.notEqual(key, tatTaskKey("app1", 11, since));
  assert.notEqual(key, tatTaskKey("app2", 10, since));
});
