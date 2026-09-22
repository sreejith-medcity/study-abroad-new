import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEligibility, qualifyingLevel, type EligibilityProgram } from "../src/lib/eligibility";

const base: EligibilityProgram = { level: "PG", minIelts: 6.5, minPte: null, minOetGrade: null, minGermanLevel: null, maxBacklogs: null, maxGapYears: null, moiAccepted: false };
const t = (test: string, overall: string, isMock = false) => ({ test, overall, isMock });

test("the qualifying study follows the program level", () => {
  assert.equal(qualifyingLevel("UG"), "SCHOOL");
  assert.equal(qualifyingLevel("UG_DIPLOMA"), "SCHOOL");
  assert.equal(qualifyingLevel("PG"), "UG");
  assert.equal(qualifyingLevel("PHD"), "PG");
});

test("any named English test at its minimum is enough", () => {
  const p = { ...base, minToefl: 90, minDuolingo: 115 };
  assert.equal(checkEligibility({ backlogs: 0, gapYears: 0, tests: [t("DUOLINGO", "120")] }, p).verdict, "eligible");
  assert.equal(checkEligibility({ backlogs: 0, gapYears: 0, tests: [t("TOEFL", "80")] }, p).verdict, "blocked");
});

test("marks block only when a percentage is recorded and falls short", () => {
  const p = { ...base, minIelts: null, minAcademicPercent: 60 };
  const run = (academics: { level: string; gradingSystem: string | null; score: number | null }[]) => checkEligibility({ backlogs: 0, gapYears: 0, tests: [], academics }, p).verdict;
  assert.equal(run([{ level: "UG", gradingSystem: "percentage", score: 64 }]), "eligible");
  assert.equal(run([{ level: "UG", gradingSystem: "percentage", score: 55 }]), "blocked");
  assert.equal(run([{ level: "UG", gradingSystem: "cgpa10", score: 6.1 }]), "on-track");
  assert.equal(run([{ level: "SCHOOL", gradingSystem: "percentage", score: 90 }]), "on-track", "12th marks do not answer a master's minimum");
  assert.equal(checkEligibility({ backlogs: 0, gapYears: 0, tests: [] }, p).verdict, "unknown", "no academics passed, no academic check");
});

test("a required GRE blocks until an official score meets it", () => {
  const p = { ...base, minIelts: null, minGre: 310 };
  assert.equal(checkEligibility({ backlogs: 0, gapYears: 0, tests: [t("GRE", "300")] }, p).verdict, "blocked");
  assert.equal(checkEligibility({ backlogs: 0, gapYears: 0, tests: [t("GRE", "315")] }, p).verdict, "eligible");
});
