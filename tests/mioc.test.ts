import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMioc, durationMonths, feeFigure, intakeMonths, parseDump, tuitionFigure } from "../src/lib/mioc";

const sample = readFileSync(new URL("./fixtures/mioc-sample.sql", import.meta.url), "utf8");
const tables = parseDump(sample);
const built = buildMioc(tables);
const course = (id: number) => built.programs.find((p) => p.miocId === id);

test("only the four catalogue tables are kept; students are parsed past and dropped", () => {
  assert.deepEqual(Object.keys(tables).sort(), ["tb_courses", "tb_destinations", "tb_main_course", "tb_universities"]);
  assert.equal(tables.tb_courses.length, 12);
  assert.ok(!JSON.stringify(tables).includes("Never Kept"));
});

test("escaped quotes and line breaks come through as written", () => {
  const p = course(101)!;
  assert.match(p.entryRequirements ?? "", /^•60% in the bachelor's degree\n•No backlogs\nRemarks: It doesn't accept NIOS/);
});

test("switched-off destinations, switched-off universities and orphaned courses are left out", () => {
  assert.deepEqual(built.skipped.hiddenCountries, ["Slovenia"]);
  assert.equal(built.skipped.hiddenUniversities, 1);
  assert.equal(built.skipped.orphanCourses, 3);
  assert.equal(course(107), undefined);
  assert.equal(course(108), undefined);
  assert.equal(course(109), undefined);
  assert.ok(!built.universities.some((u) => u.name === "Empty Mioc College"), "a university with no courses does not come over");
  assert.deepEqual(built.countries.map((c) => c.code), ["GB", "US", "VN"]);
});

test("a course filed under two study areas comes over once, naming the other area", () => {
  assert.equal(course(102), undefined);
  assert.equal(built.skipped.duplicateCourses, 1);
  assert.equal(course(101)!.studyArea, "Computer Science and IT");
  assert.match(course(101)!.entryRequirements ?? "", /Also filed in the MIOC app under: Health Science$/);
});

test("the yearly fee is taken only as a plain figure in the country's own currency", () => {
  assert.equal(course(101)!.tuitionPerYear, 17500);
  assert.equal(course(105)!.tuitionPerYear, 32760);
  assert.equal(course(110)!.tuitionPerYear, 24104, "a figure marked per year is still a yearly figure");
  // A semester pathway is not a year: kept in words, never divided or multiplied.
  assert.equal(course(103)!.tuitionPerYear, null);
  assert.match(course(103)!.entryRequirements ?? "", /Tuition in the MIOC app: £ 14,250 for 3 semester pathway\./);
  // Dollars at a Vietnamese institute are not dong.
  assert.equal(course(106)!.tuitionPerYear, null);
  assert.match(course(106)!.entryRequirements ?? "", /Tuition in the MIOC app: USD 5000/);
  assert.equal(feeFigure("€ 9,000", "€", "EUR"), 9000);
  assert.equal(feeFigure("19,969.56", "Can$", "CAD"), 19970);
  assert.equal(feeFigure("27,786 for 9 months.", "$", "USD"), null);
  assert.equal(feeFigure("TBC", "£", "GBP"), null);
  assert.equal(feeFigure("12,000", "", "GBP"), null, "no currency recorded, no figure");
});

test("noughts are read as not recorded, not as free or as a score of nought", () => {
  const p = course(104)!;
  assert.equal(p.applicationFee, null);
  assert.equal(p.minIelts, null);
  assert.equal(p.minToefl, null);
  assert.equal(p.minPte, null);
  assert.equal(p.minDuolingo, null);
});

test("application fees: a figure, a waiver, or the words as recorded", () => {
  assert.equal(course(105)!.applicationFee, 50);
  assert.equal(course(103)!.feeWaiver, "Application fee waiver recorded in the MIOC app");
  assert.equal(course(103)!.applicationFee, null);
  assert.equal(course(110)!.applicationFee, null);
  assert.match(course(110)!.entryRequirements ?? "", /Application fee in the MIOC app: If applying through the portal: USD 75 plus USD 10/);
  assert.equal(course(111)!.applicationFee, 75);
});

test("scores land in their fields; the rest are kept in words", () => {
  const p = course(105)!;
  assert.equal(p.minIelts, 6);
  assert.equal(p.minIeltsBand, 5.5);
  assert.equal(p.minToefl, 79);
  assert.equal(p.minPte, 53);
  assert.equal(p.minSat, 1060);
  assert.equal(p.minDuolingo, 105, "the DET column is the Duolingo English Test");
  assert.match(p.entryRequirements ?? "", /TOEFL, lowest in any section: 17/);
  assert.match(p.entryRequirements ?? "", /ACT: 21/);
  assert.match(p.entryRequirements ?? "", /Deadline in the MIOC app: Fall : 01 Jun, Spring : 15 Nov/);
  assert.equal(course(110)!.minGmat, 550);
  assert.equal(course(110)!.minGre, 300);
  assert.match(course(103)!.entryRequirements ?? "", /English test in the MIOC app: No Test Requirement/);
});

test("levels, with the app's wording kept where the portal's level is broader", () => {
  assert.equal(course(101)!.level, "PG");
  assert.equal(course(105)!.level, "UG");
  assert.equal(course(103)!.level, "CERTIFICATE");
  assert.match(course(103)!.entryRequirements ?? "", /^Level in the MIOC app: Foundation/);
});

test("durations: months and years, never a range or weeks", () => {
  assert.equal(durationMonths("12 months"), 12);
  assert.equal(durationMonths("48 Month(s) months"), 48);
  assert.equal(durationMonths("2 YEARS months"), 24);
  assert.equal(durationMonths("7-10 months"), null);
  assert.equal(durationMonths("32 WEEKS months"), null);
  assert.equal(durationMonths("1.5-2.5 years"), null);
  assert.match(course(103)!.entryRequirements ?? "", /Duration in the MIOC app: 7-10 months/);
});

test("intakes as the app's users typed them", () => {
  assert.deepEqual(intakeMonths("January,September"), [1, 9]);
  assert.deepEqual(intakeMonths("SEP"), [9]);
  assert.deepEqual(intakeMonths("Spring (jan),Fall (Aug)"), [1, 8]);
  assert.deepEqual(intakeMonths("septemberNovember"), [9, 11]);
  assert.deepEqual(intakeMonths("sepetember"), [9]);
  assert.deepEqual(intakeMonths("Summer (May)"), [5]);
  assert.deepEqual(intakeMonths("2025"), []);
});

test("a file cut short says so rather than loading half", () => {
  assert.throws(() => parseDump(sample.slice(0, sample.indexOf("(105,") + 60)), /cut short/);
});

test("a European thousands point is not read as a decimal, and a tiny figure is not a year's tuition", () => {
  assert.equal(feeFigure("€ 12.500", "€", "EUR"), null);
  assert.equal(feeFigure("1.500", "€", "EUR"), null);
  assert.equal(feeFigure("7659.60", "$", "NZD"), 7660);
  assert.equal(tuitionFigure("45", "£", "GBP"), null);
  assert.equal(tuitionFigure("17,500", "£", "GBP"), 17500);
});

test("words that merely contain a month's letters are not intakes", () => {
  assert.deepEqual(intakeMonths("Rolling, dates may vary"), [5]);
  assert.deepEqual(intakeMonths("Rolling admissions"), []);
  assert.deepEqual(intakeMonths("As per university decision"), []);
  assert.deepEqual(intakeMonths("March, Sept"), [3, 9]);
});

test("a file cut between statements, or an INSERT with no VALUES, is refused", () => {
  const cut = sample.slice(0, sample.lastIndexOf("COMMIT;"));
  assert.throws(() => parseDump(cut), /cut short/);
  assert.throws(() => parseDump("INSERT INTO `tb_courses` SELECT * FROM x;\nCOMMIT;"), /Could not read the rows/);
  assert.throws(() => parseDump(sample.slice(0, sample.indexOf("(105,") - 2)), /cut short/);
});
