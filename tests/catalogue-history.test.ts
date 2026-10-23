import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFields, fieldLabel, formatValue, mergeRepeats, planRestore, plainText, programRestoreProblem, restorable, sameValue, skippedText, storable } from "../src/lib/catalogue-history";
import { fmtMoney } from "../src/lib/format";

test("only the fields being written are compared, and only real changes come back", () => {
  const current = { id: "p1", name: "MSc Data", applicationFee: 50, tuitionPerYear: 18000, updatedAt: new Date("2026-01-01") };
  const next = { name: "MSc Data", applicationFee: 60, updatedAt: new Date() };
  assert.deepEqual(diffFields(current, next), [{ field: "applicationFee", before: 50, after: 60 }]);
});

test("bookkeeping columns and ignored fields never count", () => {
  assert.deepEqual(diffFields({ id: "a", createdAt: 1, updatedAt: 1 }, { id: "b", createdAt: 2, updatedAt: 2 }), []);
  assert.deepEqual(diffFields({ inserted: false, campus: "Perth" }, { inserted: true, campus: "Perth" }, ["inserted"]), []);
});

test("a field the writer leaves undefined is not a change", () => {
  assert.deepEqual(diffFields({ applicationFee: 50 }, { applicationFee: undefined }), []);
});

test("null, blank text and an empty list all mean nothing recorded", () => {
  assert.equal(sameValue(null, []), true);
  assert.equal(sameValue([], null), true);
  assert.equal(sameValue(undefined, null), true);
  assert.equal(sameValue("", null), true);
  assert.deepEqual(diffFields({ tags: null }, { tags: [] }), []);
  assert.deepEqual(diffFields({ feeWaiver: "" }, { feeWaiver: null }), []);
});

test("zero is a value, not nothing", () => {
  // A fee the institution states is zero must never merge with an unverified one.
  assert.equal(sameValue(0, null), false);
  assert.deepEqual(diffFields({ applicationFee: null }, { applicationFee: 0 }), [{ field: "applicationFee", before: null, after: 0 }]);
  assert.deepEqual(diffFields({ applicationFee: 0 }, { applicationFee: null }), [{ field: "applicationFee", before: 0, after: null }]);
  assert.equal(sameValue(false, null), false);
});

test("lists compare without regard to order, but keep their contents", () => {
  assert.equal(sameValue([9, 1], [1, 9]), true);
  assert.equal(sameValue(["STEM", "FAST_OFFER"], ["FAST_OFFER", "STEM"]), true);
  assert.equal(sameValue([1, 9], [1, 9, 9]), false);
  assert.equal(sameValue([1], [2]), false);
  assert.equal(sameValue(["1"], [1]), false);
  assert.deepEqual(diffFields({ intakeMonths: [1] }, { intakeMonths: [1, 9] }), [{ field: "intakeMonths", before: [1], after: [1, 9] }]);
});

test("real numbers allow for float rounding, and still see a real change", () => {
  assert.equal(sameValue(6.1, 6.099999904632568), true);
  assert.equal(sameValue(6.5, 6.5), true);
  assert.equal(sameValue(6.5, 7), false);
  assert.equal(sameValue(6, 6.5), false);
  assert.equal(sameValue(18000, 18001), false);
  assert.equal(sameValue(0.1 + 0.2, 0.3), true);
});

test("a number that came back as text matches itself, and nothing else", () => {
  assert.equal(sameValue(60, "60"), true);
  assert.equal(sameValue("6.5", 6.5), true);
  assert.equal(sameValue(60, "sixty"), false);
  assert.equal(sameValue(60, " "), false);
});

test("text, booleans and enums compare exactly", () => {
  assert.equal(sameValue("LIVE", "LIVE"), true);
  assert.equal(sameValue("LIVE", "live"), false);
  assert.equal(sameValue(true, false), false);
  assert.equal(sameValue("a", ["a"]), false);
});

test("values are stored in a form jsonb can hold", () => {
  assert.equal(storable(undefined), null);
  assert.equal(storable(Number.NaN), null);
  assert.equal(storable(new Date("2026-10-23T00:00:00Z")), "2026-10-23T00:00:00.000Z");
  assert.deepEqual(storable([1, undefined]), [1, null]);
  assert.deepEqual(diffFields({ moiAccepted: undefined }, { moiAccepted: true }), [{ field: "moiAccepted", before: null, after: true }]);
});

test("fields read in plain words", () => {
  assert.equal(fieldLabel("program", "applicationFee"), "Application fee");
  assert.equal(fieldLabel("program", "workRights"), "Post-study work");
  assert.equal(fieldLabel("university", "qsRank"), "QS ranking");
  assert.equal(fieldLabel("program", "somethingNew"), "somethingNew");
});

test("values read as the rest of the admin screens show them", () => {
  const ctx = { currency: "GBP", docLabels: { PASSPORT: "Passport" } };
  assert.equal(formatValue("program", "applicationFee", null, ctx), "Not recorded");
  assert.equal(formatValue("program", "applicationFee", 0, ctx), "No application fee");
  assert.equal(formatValue("program", "applicationFee", 60, ctx), fmtMoney(60, "GBP"));
  assert.equal(formatValue("program", "tuitionPerYear", 18500, ctx), fmtMoney(18500, "GBP"));
  assert.equal(formatValue("program", "durationMonths", 24, ctx), "2 years");
  assert.equal(formatValue("program", "intakeMonths", [1, 9], ctx), "Jan, Sep");
  assert.equal(formatValue("program", "intakeMonths", [], ctx), "Not recorded");
  assert.equal(formatValue("program", "status", "LIVE", ctx), "Live");
  assert.equal(formatValue("program", "level", "PG", ctx), "Master's");
  assert.equal(formatValue("program", "workRights", "UNKNOWN", ctx), "Not confirmed");
  assert.equal(formatValue("program", "tags", ["STEM"], ctx), "STEM");
  assert.equal(formatValue("program", "tags", [], ctx), "None");
  assert.equal(formatValue("program", "requiredDocs", ["PASSPORT"], ctx), "Passport");
  assert.equal(formatValue("program", "moiAccepted", false, ctx), "No");
  assert.equal(formatValue("program", "offerTatDays", 1, ctx), "1 day");
  assert.equal(formatValue("program", "offerTatDays", 21, ctx), "21 days");
  assert.equal(formatValue("program", "minAcademicPercent", 60, ctx), "60%");
  assert.equal(formatValue("program", "minIelts", 6.5, ctx), "6.5");
  assert.equal(formatValue("program", "feeWaiver", "", ctx), "Not recorded");
  assert.equal(formatValue("university", "isPublic", true, ctx), "Yes");
  assert.equal(formatValue("university", "city", null, ctx), "Not recorded");
  assert.ok(formatValue("program", "entryRequirements", "x".repeat(400), ctx).length <= 160);
});

test("a register code is shown but never restored", () => {
  assert.equal(restorable("program", "externalCode"), false);
  assert.equal(restorable("university", "externalCode"), false);
  assert.equal(restorable("program", "applicationFee"), true);
  assert.equal(restorable("university", "city"), true);
  assert.equal(restorable("program", "updatedAt"), false);
});

test("a restore is held to the edit screen's rules, only for the fields it touches", () => {
  const live = { name: "MSc Data", level: "PG", pathway: "DEGREE", status: "LIVE", intakeMonths: [] as number[], workRights: "UNKNOWN", workRightsNote: null };
  // A register course live with no intakes may still have its fee put back.
  assert.equal(programRestoreProblem(live, ["applicationFee"]), null);
  assert.match(programRestoreProblem(live, ["status"]) ?? "", /no intake/);
  assert.equal(programRestoreProblem({ ...live, status: "DRAFT", intakeMonths: [] }, ["status", "intakeMonths"]), null);
  assert.match(programRestoreProblem({ ...live, intakeMonths: [9], workRights: "ELIGIBLE" }, ["workRights"]) ?? "", /evidence/);
  assert.equal(programRestoreProblem({ ...live, intakeMonths: [9], workRights: "ELIGIBLE", workRightsNote: "Institution page" }, ["workRights", "workRightsNote"]), null);
  assert.match(programRestoreProblem({ ...live, name: " " }, ["name"]) ?? "", /name/);
  assert.match(programRestoreProblem({ ...live, level: "NOPE" }, ["level"]) ?? "", /level/);
});

test("text ignores Windows line endings and trailing spaces, and nothing else", () => {
  assert.equal(plainText("One line.  \r\nTwo lines. \r\n"), "One line.\nTwo lines.");
  assert.equal(sameValue("About us\r\nWe teach.", "About us\nWe teach."), true);
  assert.equal(sameValue("About us   \nWe teach.\t", "About us\nWe teach."), true);
  assert.equal(sameValue("  indented", "indented"), false);
  assert.equal(sameValue("About us\nWe teach.", "About us We teach."), false);
  assert.equal(sameValue("   ", null), true);
  // A save of another field must not record the About text it sent back unchanged.
  assert.deepEqual(diffFields({ about: "Founded 1901.\r\nIn Leeds. ", city: "Leeds" }, { about: "Founded 1901.\nIn Leeds.", city: "York" }), [{ field: "city", before: "Leeds", after: "York" }]);
});

test("a row and field changed twice in one batch is recorded once, earliest before to latest after", () => {
  const twice = [
    { entity: "program" as const, entityId: "p1", field: "tuitionPerYear", before: 1000, after: 1200 },
    { entity: "program" as const, entityId: "p2", field: "tuitionPerYear", before: 900, after: 950 },
    { entity: "program" as const, entityId: "p1", field: "tuitionPerYear", before: 1200, after: 1500 },
    { entity: "program" as const, entityId: "p1", field: "applicationFee", before: null, after: 50 },
  ];
  assert.deepEqual(mergeRepeats(twice), [
    { entity: "program", entityId: "p1", field: "tuitionPerYear", before: 1000, after: 1500 },
    { entity: "program", entityId: "p2", field: "tuitionPerYear", before: 900, after: 950 },
    { entity: "program", entityId: "p1", field: "applicationFee", before: null, after: 50 },
  ]);
  // Changed and changed back within the batch: nothing to record.
  assert.deepEqual(
    mergeRepeats([
      { entity: "university", entityId: "u1", field: "city", before: null, after: "Perth" },
      { entity: "university", entityId: "u1", field: "city", before: "Perth", after: "" },
    ]),
    [],
  );
  // The same id under the other entity is a different row.
  assert.equal(
    mergeRepeats([
      { entity: "program", entityId: "x", field: "name", before: "A", after: "B" },
      { entity: "university", entityId: "x", field: "name", before: "A", after: "C" },
    ]).length,
    2,
  );
});

test("a restore puts back only fields that still hold the value the change gave them", () => {
  const change = [
    { field: "tuitionPerYear", before: 1000, after: 1200 },
    { field: "applicationFee", before: null, after: 50 },
    { field: "campus", before: "Perth", after: "Sydney" },
  ];
  // Tuition was saved again since; the fee is as the change left it; the campus is already back.
  const plan = planRestore({ tuitionPerYear: 1500, applicationFee: 50, campus: "Perth" }, change);
  assert.deepEqual(plan.values, { applicationFee: null });
  assert.deepEqual(plan.skipped, [{ field: "tuitionPerYear", now: 1500 }]);
  // Nothing moved since: everything goes back.
  assert.deepEqual(planRestore({ tuitionPerYear: 1200, applicationFee: 50, campus: "Sydney" }, change), {
    values: { tuitionPerYear: 1000, applicationFee: null, campus: "Perth" },
    skipped: [],
  });
  // Moved since to nothing at all is still moved.
  assert.deepEqual(planRestore({ applicationFee: null }, [{ field: "applicationFee", before: 30, after: 50 }]).skipped, [{ field: "applicationFee", now: null }]);
  // The comparison is the history's own: order of a list and CRLF do not count as a change since.
  assert.deepEqual(planRestore({ intakeMonths: [9, 1] }, [{ field: "intakeMonths", before: [1], after: [1, 9] }]).values, { intakeMonths: [1] });
  assert.deepEqual(planRestore({ about: "A\r\nB" }, [{ field: "about", before: null, after: "A\nB" }]).values, { about: null });
  // An old batch holding one field twice runs from its first before to its last after.
  assert.deepEqual(
    planRestore({ tuitionPerYear: 1500 }, [
      { field: "tuitionPerYear", before: 1000, after: 1200 },
      { field: "tuitionPerYear", before: 1200, after: 1500 },
    ]).values,
    { tuitionPerYear: 1000 },
  );
});

test("a field left alone says what it holds now, in plain words", () => {
  const ctx = { currency: "AUD" };
  assert.equal(
    skippedText("program", [{ field: "tuitionPerYear", now: 1500 }], ctx),
    `Tuition per year was changed again since, to ${fmtMoney(1500, "AUD")}; it was left as it is.`,
  );
  assert.equal(skippedText("program", [{ field: "applicationFee", now: null }], ctx), "Application fee was changed again since and is now not recorded; it was left as it is.");
  assert.equal(
    skippedText("university", [{ field: "city", now: "York" }, { field: "qsRank", now: "154" }], ctx),
    "City was changed again since, to York; it was left as it is. QS ranking was changed again since, to 154; it was left as it is.",
  );
});
