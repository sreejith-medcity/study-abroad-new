import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { adhocStudent, budgetWhere, knownInsideBudgetWhere, QUICK, readSearch } from "../src/server/program-search";

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

test("a fee nobody recorded stays in a budget search but is never counted as fitting it", () => {
  const render = (q: ReturnType<typeof budgetWhere>) => new PgDialect().sqlToQuery(q).sql.replace(/\s+/g, " ");
  const lenient = render(budgetWhere(15e5, { GBP: 112 }));
  const strict = render(knownInsideBudgetWhere(15e5, { GBP: 112 }));
  // The lenient filter keeps the unknowns: no rate, or no fee of either kind.
  assert.match(lenient, /when \(case .* end\) is null then true/);
  assert.match(lenient, /else true end/);
  // The strict one, used for "N sit inside the budget" and for ranking, does not.
  assert.match(strict, /when \(case .* end\) is null then false/);
  assert.match(strict, /else false end/);
  // Neither ever turns a whole-course fee into a yearly one without the course length.
  for (const q of [lenient, strict]) assert.match(q, /"tuition_total" is not null and .*"duration_months" > 0 then/);
});

test("the English chip filters on what is recorded and says so", () => {
  const chip = QUICK.find((q) => q.key === "noEnglish")!;
  assert.equal(chip.label, "No English test recorded");
  const sqlText = new PgDialect().sqlToQuery(chip.cond()).sql;
  assert.match(sqlText, /"min_ielts" is null/);
});
