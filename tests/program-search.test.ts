import { test } from "node:test";
import assert from "node:assert/strict";
import { adhocStudent, readSearch } from "../src/server/program-search";

test("readSearch joins repeated multi-value keys and keeps the first of others", () => {
  const f = readSearch({ level: ["UG", "PG,UG"], season: "spring", q: ["nursing", "ignored"], id: ["a", "b"], empty: "" });
  assert.equal(f.level, "UG,PG");
  assert.equal(f.season, "spring");
  assert.equal(f.q, "nursing");
  assert.equal(f.id, undefined);
  assert.equal(f.empty, undefined);
});

test("adhocStudent reads typed scores as official ones and marks as percentages", () => {
  assert.equal(adhocStudent({ q: "x" }), null);
  const s = adhocStudent({ ae_ielts: "6.5", ae_ug: "62", ae_backlogs: "2", ae_gre: "abc" })!;
  assert.deepEqual(s.tests, [{ test: "IELTS", overall: "6.5", isMock: false }]);
  assert.deepEqual(s.academics, [{ level: "UG", gradingSystem: "percentage", score: 62 }]);
  assert.equal(s.backlogs, 2);
  assert.equal(s.gapYears, null);
  assert.equal(s.label, "IELTS 6.5 · bachelor's 62% · 2 backlogs");
});
