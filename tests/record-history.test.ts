import { test } from "node:test";
import assert from "node:assert/strict";
import {
  columnValue,
  compareVersions,
  csvCell,
  dayRange,
  fieldLabel,
  HISTORY_FIELDS,
  idsToName,
  NOT_RECORDED,
  planFieldRestore,
  readHistoryFilters,
  restoreRule,
  showValue,
  trackedChanges,
  valueAt,
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
  assert.deepEqual(readHistoryFilters({ entity: "student", from: "2026-10-01", to: "nonsense", page: "2", by: "u1" }), { entity: "student", from: "2026-10-01", by: "u1", page: "2" });
  assert.deepEqual(readHistoryFilters({ entity: "invoice", page: "1" }), {});
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
