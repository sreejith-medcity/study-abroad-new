import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrief } from "../src/lib/brief";

const VOCAB = {
  countries: [
    { code: "GB", name: "United Kingdom" },
    { code: "IE", name: "Ireland" },
    { code: "CA", name: "Canada" },
    { code: "DE", name: "Germany" },
  ],
  fields: ["Computer Science", "Science", "Nursing"],
};

test("parseBrief reads scores, marks, destinations and a budget", () => {
  const b = parseBrief("B.Com graduate with 62%, IELTS 6.0, wants a master's in Canada or Ireland, budget 15 lakh, September intake", VOCAB);
  assert.equal(b.params.ae_ielts, "6");
  assert.equal(b.params.ae_ug, "62");
  assert.equal(b.params.level, "PG");
  assert.equal(b.params.country, "IE,CA");
  assert.equal(b.params.season, "fall");
  assert.equal(b.params.budget, "15");
});

test("parseBrief takes an unlabelled mark at the level being asked for, and says so", () => {
  const pg = parseBrief("masters in the UK, 68%", VOCAB);
  assert.equal(pg.params.ae_ug, "68");
  assert.ok(pg.read.some((r) => r.includes("taken from the level asked for")));
  const ug = parseBrief("bachelors in Canada, 72%", VOCAB);
  assert.equal(ug.params.ae_12, "72");
  assert.equal(ug.params.ae_ug, undefined);
});

test("parseBrief never turns a CGPA into a percentage", () => {
  const b = parseBrief("degree with 7.4 CGPA, looking at Germany", VOCAB);
  assert.equal(b.params.ae_ug, undefined);
  assert.equal(b.params.ae_12, undefined);
  assert.ok(b.notes.some((n) => n.includes("CGPA")));
  assert.equal(b.params.country, "DE");
});

test("parseBrief reads a score written either way round and ignores impossible ones", () => {
  assert.equal(parseBrief("scored 7.5 in IELTS", VOCAB).params.ae_ielts, "7.5");
  assert.equal(parseBrief("PTE 67 and TOEFL 95", VOCAB).params.ae_pte, "67");
  assert.equal(parseBrief("PTE 67 and TOEFL 95", VOCAB).params.ae_toefl, "95");
  assert.equal(parseBrief("ielts 12", VOCAB).params.ae_ielts, undefined);
});

test("parseBrief picks the longest field name and the pathway behind a level", () => {
  const b = parseBrief("computer science masters", VOCAB);
  assert.equal(b.params.field, "Computer Science");
  const a = parseBrief("Ausbildung in Germany", VOCAB);
  assert.equal(a.params.level, "VOCATIONAL");
  assert.equal(a.params.pathway, "AUSBILDUNG");
});

test("parseBrief reads the asks a family makes", () => {
  const b = parseBrief("no IELTS, scholarship needed, post study work, 3 backlogs, 2 year gap", VOCAB);
  assert.equal(b.params.noEnglish, "1");
  assert.equal(b.params.scholarship, "1");
  assert.equal(b.params.workRights, "1");
  assert.equal(b.params.ae_backlogs, "3");
  assert.equal(b.params.ae_gap, "2");
});

test("parseBrief says when it understood nothing", () => {
  const b = parseBrief("she is a lovely student", VOCAB);
  assert.deepEqual(b.read, []);
  assert.equal(b.notes.length, 1);
});
