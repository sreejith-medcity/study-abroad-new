import { test } from "node:test";
import assert from "node:assert/strict";
import { branchCodeFrom, formatStudentId, idSearchKey, looksLikeStudentId, nextCodeCandidate, parseStudentId, yearPart } from "../src/lib/medcity-id";

test("a branch code skips the company's own words", () => {
  assert.equal(branchCodeFrom("Medcity Kottayam"), "KOT");
  assert.equal(branchCodeFrom("Medcity International Overseas Corporation"), "INT");
  assert.equal(branchCodeFrom("The Horizon Consultancy, Thrissur"), "HOR");
});

test("a branch code falls back when the name gives nothing usable", () => {
  assert.equal(branchCodeFrom("Medcity"), "MED");
  assert.equal(branchCodeFrom("A1"), "MED");
  assert.equal(branchCodeFrom("123"), "MED");
});

test("a taken code gets a digit and stays three characters", () => {
  assert.equal(nextCodeCandidate("KOT", 0), "KOT");
  assert.equal(nextCodeCandidate("KOT", 1), "KO2");
  assert.equal(nextCodeCandidate("KOT", 2), "KO3");
  // Past the ninth collision the suffix needs two digits, so the code grows.
  assert.equal(nextCodeCandidate("KOT", 9), "KO10");
});

test("the year is two digits, padded", () => {
  assert.equal(yearPart(2026), "26");
  assert.equal(yearPart(2005), "05");
  assert.equal(yearPart(2100), "00");
});

test("an ID reads the way it is said out loud", () => {
  assert.equal(formatStudentId("KOT", 2026, 41), "MC-KOT-26-0041");
  assert.equal(formatStudentId("kot", 2026, 1), "MC-KOT-26-0001");
  // A branch past ten thousand students in one year spills a fifth digit
  // rather than wrapping round to the start.
  assert.equal(formatStudentId("KOT", 2026, 10432), "MC-KOT-26-10432");
});

test("an ID parses back, however it was written down", () => {
  assert.deepEqual(parseStudentId("MC-KOT-26-0041"), { branchCode: "KOT", year: 2026, serial: 41 });
  assert.deepEqual(parseStudentId("mc kot 26 41"), { branchCode: "KOT", year: 2026, serial: 41 });
  // A code that collided carries a digit, and must still parse.
  assert.deepEqual(parseStudentId("MC-KO2-26-0007"), { branchCode: "KO2", year: 2026, serial: 7 });
  assert.equal(parseStudentId("KOT-26-0041"), null);
  assert.equal(parseStudentId("MC-KOT-26-0000"), null);
  assert.equal(parseStudentId(""), null);
});

test("the search box knows an ID from a name", () => {
  assert.equal(looksLikeStudentId("MC-KOT-26-0041"), true);
  assert.equal(looksLikeStudentId("mc ktm"), true);
  assert.equal(looksLikeStudentId("KOT-26-41"), true);
  assert.equal(looksLikeStudentId("Fathima"), false);
  assert.equal(looksLikeStudentId("+91 94470 00000"), false);
  assert.equal(looksLikeStudentId("mc"), false);
});

test("the search key strips whatever punctuation was used", () => {
  assert.equal(idSearchKey("mc kot 26 41"), "MCKOT2641");
  assert.equal(idSearchKey("MC-KOT-26-0041"), "MCKOT260041");
});

test("a name made only of the company's own words still gives a code", () => {
  // The head office is "Medcity International Overseas Corporation" in one
  // database and "The Medcity Overseas Pvt Ltd" in another. Neither should
  // come out as THE.
  assert.equal(branchCodeFrom("The Medcity Overseas Pvt Ltd"), "MED");
  assert.equal(branchCodeFrom("The Pvt Ltd"), "MED");
});
