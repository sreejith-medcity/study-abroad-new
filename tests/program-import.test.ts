import { test } from "node:test";
import assert from "node:assert/strict";
import { parseProgramCsv } from "../src/lib/program-import";

const header = "program,university,country_code,pathway,level,intakes,min_ielts,required_docs,moi_accepted";

test("parses month names and numbers, docs and booleans", () => {
  const { rows, errors } = parseProgramCsv(`${header}\nMSc X,Uni A,gb,DEGREE,PG,Sep|1|jan,6.5,PASSPORT|SOP,yes`, ["PASSPORT", "SOP"]);
  assert.equal(errors.length, 0);
  assert.deepEqual(rows[0].intakeMonths, [1, 9]);
  assert.equal(rows[0].countryCode, "GB");
  assert.equal(rows[0].moiAccepted, true);
  assert.deepEqual(rows[0].requiredDocs, ["PASSPORT", "SOP"]);
});

test("reports row errors with line numbers and keeps valid rows", () => {
  const { rows, errors } = parseProgramCsv(`${header}\nGood,Uni,GB,DEGREE,PG,Jan,,,\nBad,Uni,GBR,WRONG,PG,Smarch,abc,NOPE,`, ["PASSPORT"]);
  assert.equal(rows.length, 1);
  assert.equal(errors[0].line, 3);
  assert.match(errors[0].message, /country_code/);
  assert.match(errors[0].message, /pathway/);
  assert.match(errors[0].message, /Smarch/);
  assert.match(errors[0].message, /NOPE/);
});

test("rejects files missing required columns", () => {
  const { errors } = parseProgramCsv("program,university\nA,B", []);
  assert.match(errors[0].message, /Missing required columns/);
});
