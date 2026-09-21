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

test("reads work rights from the words a university actually uses", () => {
  const h = "program,university,country_code,level,intakes,work_rights,work_rights_note";
  const { rows, errors } = parseProgramCsv(
    `${h}\nA,Uni,CA,PG,Jan,PGWP-ineligible,Under 2 years\nB,Uni,US,PG,Jan,STEM OPT,Named on the university's own list\nC,Uni,GB,PG,Jan,,\nD,Uni,IE,PG,Jan,ELIGIBLE,`,
    [],
  );
  assert.equal(errors.length, 0);
  assert.equal(rows[0].workRights, "INELIGIBLE");
  assert.equal(rows[0].workRightsNote, "Under 2 years");
  assert.equal(rows[1].workRights, "ELIGIBLE");
  // An empty cell is an unknown, never an assumed yes.
  assert.equal(rows[2].workRights, "UNKNOWN");
  assert.equal(rows[2].workRightsNote, null);
  assert.equal(rows[3].workRights, "ELIGIBLE");
});

test("refuses a work rights value it does not recognise, rather than guessing", () => {
  const h = "program,university,country_code,level,intakes,work_rights";
  const { rows, errors } = parseProgramCsv(`${h}\nA,Uni,CA,PG,Jan,probably`, []);
  assert.equal(rows.length, 0);
  assert.match(errors[0].message, /work_rights must be one of/);
});

test("a file with no work rights column leaves every row unknown", () => {
  const { rows } = parseProgramCsv(`${header}\nMSc X,Uni A,GB,DEGREE,PG,Sep,6.5,,`, []);
  assert.equal(rows[0].workRights, "UNKNOWN");
});

test("the template shown in the admin paste box parses with no errors", async () => {
  const { PROGRAM_CSV_TEMPLATE } = await import("../src/lib/program-import");
  const { rows, errors } = parseProgramCsv(PROGRAM_CSV_TEMPLATE, ["PASSPORT", "MARKSHEET_12", "DEGREE_MARKSHEETS", "ENGLISH_TEST", "SOP"]);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].workRights, "ELIGIBLE");
});
