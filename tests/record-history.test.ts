import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columnValue,
  compareVersions,
  csvCell,
  dayRange,
  feedWindow,
  fieldLabel,
  HISTORY_FIELDS,
  idsToName,
  NOT_RECORDED,
  numberVersions,
  planFieldRestore,
  readFeedCursor,
  readHistoryFilters,
  restoreRule,
  showValue,
  trackedChanges,
  valueAt,
  VERSION_LIMIT,
} from "../src/lib/record-history";

test("only kept fields that really changed are recorded", () => {
  const before = { id: "s1", firstName: "Anu", city: "Kochi", passwordHash: "x", updatedAt: new Date("2026-01-01"), portalToken: "a" };
  const after = { id: "s1", firstName: "Anu", city: "Thrissur", passwordHash: "y", updatedAt: new Date("2026-02-01"), portalToken: "b" };
  assert.deepEqual(trackedChanges("student", before, after), [{ field: "city", before: "Kochi", after: "Thrissur" }]);
});

test("a password hash, a session counter and a sign-in time never reach a staff account's history", () => {
  const before = { name: "Asha", passwordHash: "a", sessionVersion: 1, lastSignInAt: new Date(1), skin: "soft" };
  const after = { name: "Asha", passwordHash: "b", sessionVersion: 2, lastSignInAt: new Date(2), skin: "night" };
  assert.deepEqual(trackedChanges("user", before, after), []);
  for (const f of ["passwordHash", "sessionVersion", "lastSignInAt", "mustChangePassword", "skin", "textSize"]) assert.equal(f in HISTORY_FIELDS.user, false, f);
});

test("blank and nothing are the same, and dates are stored as text", () => {
  assert.deepEqual(trackedChanges("enquiry", { email: null, notes: "" }, { email: "", notes: null }), []);
  const [c] = trackedChanges("student", { dateOfBirth: null }, { dateOfBirth: new Date("2001-05-04T00:00:00Z") });
  assert.deepEqual(c, { field: "dateOfBirth", before: null, after: "2001-05-04T00:00:00.000Z" });
});

test("a field the write did not include is not compared", () => {
  assert.deepEqual(trackedChanges("student", { city: "Kochi", firstName: "A" }, { firstName: "A" }), []);
});

test("assignment, branch, stage, status, route and money are never offered for restore, and say why", () => {
  for (const [entity, field] of [
    ["student", "assignedToId"],
    ["student", "orgId"],
    ["student", "journeyStage"],
    ["enquiry", "assignedToId"],
    ["enquiry", "stage"],
    ["application", "statusId"],
    ["application", "officerId"],
    ["application", "routeId"],
    ["application", "feeStatus"],
    ["application", "visaDecision"],
  ] as const) {
    const rule = restoreRule(entity, field);
    assert.equal(rule.ok, false, `${entity}.${field}`);
    if (!rule.ok) assert.ok(rule.reason.length > 20, `${entity}.${field} has a reason`);
  }
});

test("plain profile fields may be restored, staff accounts never from here", () => {
  assert.equal(restoreRule("student", "city").ok, true);
  assert.equal(restoreRule("student", "passportNumber").ok, true);
  assert.equal(restoreRule("enquiry", "budgetLakhs").ok, true);
  assert.equal(restoreRule("application", "vendorReference").ok, true);
  assert.equal(restoreRule("user", "name").ok, false);
  assert.equal(restoreRule("student", "noSuchField").ok, false);
});

test("a restore puts the old value back while the field still holds what the change gave it", () => {
  const change = { field: "city", before: "Kochi", after: "Thrissur" };
  assert.deepEqual(planFieldRestore("student", { city: "Thrissur" }, change), { ok: true, value: "Kochi" });
});

test("a field changed again since is left alone, and the answer says what it is now", () => {
  const plan = planFieldRestore("student", { city: "Kannur" }, { field: "city", before: "Kochi", after: "Thrissur" });
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.match(plan.reason, /changed again since, to Kannur/);
});

test("a field already back at the old value needs nothing", () => {
  const plan = planFieldRestore("student", { city: "Kochi" }, { field: "city", before: "Kochi", after: "Thrissur" });
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.equal(plan.already, true);
});

test("an unsafe field is refused by the restore plan too, not only hidden by the page", () => {
  const plan = planFieldRestore("student", { assignedToId: "u2" }, { field: "assignedToId", before: "u1", after: "u2" });
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.match(plan.reason, /Reassign/);
});

test("stored dates go back to the column type they came from", () => {
  assert.ok(columnValue("student", "dateOfBirth", "2001-05-04T00:00:00.000Z") instanceof Date);
  assert.equal(columnValue("application", "deadline", null), null);
  assert.equal(columnValue("student", "city", "Kochi"), "Kochi");
  assert.equal(columnValue("application", "offerDate", "2026-03-01"), "2026-03-01");
});

test("values read as words, and nothing recorded reads Not recorded", () => {
  const names = new Map([["u1", "Asha Nair"]]);
  assert.equal(showValue("student", "city", null), NOT_RECORDED);
  assert.equal(showValue("student", "city", ""), NOT_RECORDED);
  assert.equal(showValue("student", "assignedToId", "u1", names), "Asha Nair");
  assert.equal(showValue("student", "assignedToId", "gone", names), NOT_RECORDED);
  assert.equal(showValue("student", "whatsappOptIn", false), "No");
  assert.equal(showValue("student", "journeyStage", "VISA"), "7. Visa");
  assert.equal(showValue("enquiry", "intakeMonth", 9), "Sep");
  assert.equal(showValue("enquiry", "backlogs" as string, 0), "0");
  assert.equal(fieldLabel("enquiry", "assignedToId"), "Owner");
});

test("a passport number is masked unless the reader may see it whole", () => {
  assert.equal(showValue("student", "passportNumber", "K1234567"), "K•••••67");
  assert.equal(showValue("student", "passportNumber", "K1234567", undefined, { fullPassport: true }), "K1234567");
});

test("the ids a set of changes needs named are collected by kind", () => {
  const ids = idsToName("application", [
    { field: "statusId", before: "s1", after: "s2" },
    { field: "officerId", before: null, after: "u1" },
    { field: "vendorReference", before: "a", after: "b" },
  ]);
  assert.deepEqual([...ids.status].sort(), ["s1", "s2"]);
  assert.deepEqual([...ids.user], ["u1"]);
});

const versions = [
  { n: 1, changes: [{ field: "city", before: "Kochi", after: "Thrissur" }] },
  { n: 2, changes: [{ field: "phone", before: "1", after: "2" }] },
  { n: 3, changes: [{ field: "city", before: "Thrissur", after: "Kannur" }, { field: "gender", before: null, after: "F" }] },
  { n: 4, changes: [{ field: "city", before: "Kannur", after: "Kochi" }] },
];

test("a field's value at any version is read from the changes alone", () => {
  assert.deepEqual(valueAt(versions, "city", 0), { known: true, value: "Kochi" });
  assert.deepEqual(valueAt(versions, "city", 1), { known: true, value: "Thrissur" });
  assert.deepEqual(valueAt(versions, "city", 2), { known: true, value: "Thrissur" });
  assert.deepEqual(valueAt(versions, "city", 3), { known: true, value: "Kannur" });
  assert.deepEqual(valueAt(versions, "phone", 0), { known: true, value: "1" });
  assert.deepEqual(valueAt(versions, "email", 2), { known: false, value: null });
});

test("comparing two versions lists only the fields that differ, either way round", () => {
  assert.deepEqual(compareVersions("student", versions, 1, 3), [
    { field: "phone", a: "1", b: "2" },
    { field: "gender", a: null, b: "F" },
    { field: "city", a: "Thrissur", b: "Kannur" },
  ].sort((x, y) => Object.keys(HISTORY_FIELDS.student).indexOf(x.field) - Object.keys(HISTORY_FIELDS.student).indexOf(y.field)));
  const back = compareVersions("student", versions, 3, 1);
  assert.equal(back.find((d) => d.field === "city")?.a, "Kannur");
});

test("a field changed and changed back is the same in a compare", () => {
  const diff = compareVersions("student", versions, 0, 4);
  assert.equal(diff.some((d) => d.field === "city"), false);
  assert.equal(diff.some((d) => d.field === "phone"), true);
});

test("the feed's filters keep what makes sense and drop the rest", () => {
  assert.deepEqual(readHistoryFilters({ entity: "student", from: "2026-10-01", to: "nonsense", after: "abcdefgh12", by: "u1" }), { entity: "student", from: "2026-10-01", by: "u1" });
  assert.deepEqual(readHistoryFilters({ entity: "invoice", page: "1" }), {});
});

test("the feed's cursor is a row id, Next before Previous, and anything else is the newest page", () => {
  assert.deepEqual(readFeedCursor({ after: "mvplcqazDSyLVAzKIocV" }), { dir: "after", id: "mvplcqazDSyLVAzKIocV" });
  assert.deepEqual(readFeedCursor({ before: "mvplcr6tJm-dW4DK5B1Z" }), { dir: "before", id: "mvplcr6tJm-dW4DK5B1Z" });
  assert.deepEqual(readFeedCursor({ after: "aaaaaaaa1", before: "bbbbbbbb1" }), { dir: "after", id: "aaaaaaaa1" });
  assert.equal(readFeedCursor({ after: "x' or 1=1" }), null);
  assert.equal(readFeedCursor({ page: "2" }), null);
  assert.equal(readFeedCursor({}), null);
});

test("a page of the feed knows which way there is more", () => {
  const rows = (...ids: string[]) => ids.map((id) => ({ id }));
  // The newest page, with more behind it: Next only.
  assert.deepEqual(feedWindow(rows("e", "d", "c"), 2, null), { rows: rows("e", "d"), older: "d", newer: null });
  // The newest page, all of it: no links.
  assert.deepEqual(feedWindow(rows("b", "a"), 2, null), { rows: rows("b", "a"), older: null, newer: null });
  // Next, with still more: both links.
  assert.deepEqual(feedWindow(rows("c", "b", "a"), 2, { dir: "after", id: "d" }), { rows: rows("c", "b"), older: "b", newer: "c" });
  // Next, the last page: Previous only.
  assert.deepEqual(feedWindow(rows("a"), 2, { dir: "after", id: "b" }), { rows: rows("a"), older: null, newer: "a" });
  // Previous reads oldest first and is shown newest first; more newer: both links.
  assert.deepEqual(feedWindow(rows("c", "d", "e"), 2, { dir: "before", id: "b" }), { rows: rows("d", "c"), older: "c", newer: "d" });
  // Previous back to the newest: Next only.
  assert.deepEqual(feedWindow(rows("c", "d"), 2, { dir: "before", id: "b" }), { rows: rows("d", "c"), older: "c", newer: null });
  // A cursor that leads nowhere: an empty page with no links.
  assert.deepEqual(feedWindow([], 2, { dir: "after", id: "zzzzzzzz" }), { rows: [], older: null, newer: null });
});

test("the History tab numbers the newest versions as they stand in the whole history", () => {
  const newestFirst = [{ id: "v250" }, { id: "v249" }, { id: "v248" }];
  assert.deepEqual(numberVersions(newestFirst, 250), [
    { id: "v248", n: 248 },
    { id: "v249", n: 249 },
    { id: "v250", n: 250 },
  ]);
  assert.deepEqual(numberVersions([{ id: "b" }, { id: "a" }], 2), [
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ]);
  assert.deepEqual(numberVersions([], 0), []);
  assert.equal(VERSION_LIMIT, 200);
});

test("a day is the India day it names", () => {
  const { start, end } = dayRange("2026-10-26", "2026-10-26");
  assert.equal(start?.toISOString(), "2026-10-25T18:30:00.000Z");
  assert.equal(end?.toISOString(), "2026-10-26T18:30:00.000Z");
});

test("a CSV cell is quoted where needed and never starts a formula", () => {
  assert.equal(csvCell('He said "hi", then left'), '"He said ""hi"", then left"');
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell(null), "");
});

test("an enquiry's lost reason, merge and reopening are kept, named, and never put back from the history", () => {
  const before = { stage: "LOST", lostReasonId: "r1", lostReason: "UK fees", lostAt: new Date("2026-10-01T05:00:00Z"), repeatCount: 0, mergedIntoId: null };
  const after = { stage: "MERGED", lostReasonId: null, lostReason: null, lostAt: null, repeatCount: 1, mergedIntoId: "e2" };
  const changes = trackedChanges("enquiry", before, after);
  assert.deepEqual(
    changes.map((c) => c.field),
    ["stage", "lostReasonId", "lostReason", "lostAt", "repeatCount", "mergedIntoId"],
  );
  for (const c of changes) assert.equal(restoreRule("enquiry", c.field).ok, false, c.field);
  assert.equal(showValue("enquiry", "stage", "MERGED"), "Merged");
  const names = new Map([
    ["r1", "Budget"],
    ["e2", "Rahul Nair"],
  ]);
  assert.equal(showValue("enquiry", "lostReasonId", "r1", names), "Budget");
  assert.equal(showValue("enquiry", "mergedIntoId", "e2", names), "Rahul Nair");
  assert.equal(showValue("enquiry", "mergedIntoId", "gone", names), NOT_RECORDED);
  const ids = idsToName("enquiry", changes);
  assert.deepEqual([...ids.lostReason], ["r1"]);
  assert.deepEqual([...ids.enquiry], ["e2"]);
});
