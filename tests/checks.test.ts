import { test } from "node:test";
import assert from "node:assert/strict";
import { runPreSubmissionCheck, summarise, type CheckProgram, type CheckStudent } from "../src/lib/checks";

const student: CheckStudent = {
  dateOfBirth: new Date("2001-01-01"), gender: "Female", addressLine1: "House", city: "Kochi",
  passportNumber: "Z1234567", passportExpiry: new Date("2035-01-01"), backlogs: 2, gapYears: 1,
  academics: [{ level: "UG" }], tests: [{ test: "IELTS", overall: "7.0", isMock: false }],
  documentTypeCodes: ["PASSPORT", "SOP"],
};
const program: CheckProgram = {
  durationMonths: 12, minIelts: 6.5, minPte: null, minOetGrade: null, minGermanLevel: null,
  maxBacklogs: 5, maxGapYears: 3, moiAccepted: false, requiredDocs: ["PASSPORT", "SOP"],
};
const intake = { month: 9, year: 2027 };

test("complete student passes every check", () => {
  const r = runPreSubmissionCheck(student, program, intake);
  assert.deepEqual(summarise(r), { blockers: 0, warnings: 0 });
});

test("passport expiring before course end is a blocker", () => {
  const r = runPreSubmissionCheck({ ...student, passportExpiry: new Date("2028-03-01") }, program, intake);
  assert.ok(r.some((x) => x.code === "passport.expiry" && x.severity === "blocker"));
});

test("mock scores never satisfy English requirement", () => {
  const r = runPreSubmissionCheck({ ...student, tests: [{ test: "IELTS", overall: "8", isMock: true }] }, program, intake);
  assert.equal(r.find((x) => x.code === "english")?.severity, "blocker");
});

test("MOI acceptance downgrades missing English to a warning", () => {
  const r = runPreSubmissionCheck({ ...student, tests: [] }, { ...program, moiAccepted: true }, intake);
  assert.equal(r.find((x) => x.code === "english")?.severity, "warning");
});

test("German CEFR level compares by order", () => {
  const p = { ...program, minIelts: null, minGermanLevel: "B1" };
  assert.equal(runPreSubmissionCheck({ ...student, tests: [{ test: "GERMAN", overall: "B2", isMock: false }] }, p, intake).find((x) => x.code === "german")?.severity, "pass");
  assert.equal(runPreSubmissionCheck({ ...student, tests: [{ test: "GERMAN", overall: "A2", isMock: false }] }, p, intake).find((x) => x.code === "german")?.severity, "blocker");
});

test("missing required documents and gap warnings are reported", () => {
  const r = runPreSubmissionCheck({ ...student, gapYears: 5, documentTypeCodes: [] }, program, intake, { SOP: "Statement of purpose" });
  assert.ok(r.some((x) => x.message === "Statement of purpose missing"));
  assert.ok(r.some((x) => x.code === "gap" && x.severity === "warning"));
  assert.equal(r[0].severity, "blocker", "blockers sort first");
});

test("TOEFL or Duolingo satisfies English when the program names them", () => {
  const s = { ...student, tests: [{ test: "TOEFL", overall: "92", isMock: false }] };
  const r = runPreSubmissionCheck(s, { ...program, minToefl: 90 }, intake);
  assert.equal(r.find((x) => x.code === "english")?.severity, "pass");
  const r2 = runPreSubmissionCheck(s, program, intake);
  assert.equal(r2.find((x) => x.code === "english")?.severity, "blocker", "TOEFL does not count where only IELTS is named");
});

test("admission tests and the academic minimum", () => {
  const s = { ...student, academics: [{ level: "UG", gradingSystem: "percentage", score: 58 }] };
  const r = runPreSubmissionCheck(s, { ...program, level: "PG", minGre: 310, minAcademicPercent: 60 }, intake);
  assert.equal(r.find((x) => x.code === "gre")?.severity, "blocker");
  assert.match(r.find((x) => x.code === "academic")?.message ?? "", /bachelor's 58% is below the 60%/);
  const cgpa = { ...student, academics: [{ level: "UG", gradingSystem: "cgpa10", score: 7.2 }] };
  assert.equal(runPreSubmissionCheck(cgpa, { ...program, level: "PG", minAcademicPercent: 60 }, intake).find((x) => x.code === "academic")?.severity, "warning", "CGPA is never converted");
});
