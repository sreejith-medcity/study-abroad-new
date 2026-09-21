import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCricos, campusText, mapLevel, parseMoney, providerName, stripFieldCode, weeksToMonths, workRights485 } from "../src/lib/cricos";

test("the 485 course rule follows Home Affairs: eligible degree and 92 weeks", () => {
  assert.equal(workRights485("Bachelor Degree", 156).workRights, "ELIGIBLE");
  assert.equal(workRights485("Masters Degree (Coursework)", 92).workRights, "ELIGIBLE");
  const short = workRights485("Masters Degree (Coursework)", 52);
  assert.equal(short.workRights, "UNKNOWN");
  assert.match(short.note ?? "", /under 92 weeks/);
  assert.equal(workRights485("Graduate Diploma", 104).workRights, "UNKNOWN");
  assert.match(workRights485("Diploma", 104).note ?? "", /Post-Vocational/);
  assert.equal(workRights485("Non AQF Award", 20).note, null);
});

test("money, weeks and fields parse without inventing values", () => {
  assert.equal(parseMoney('$13,300.00'), 13300);
  assert.equal(parseMoney(""), null);
  assert.equal(weeksToMonths(104), 24);
  assert.equal(weeksToMonths(null), null);
  assert.equal(stripFieldCode("0905 - Human Welfare Studies and Services"), "Human Welfare Studies and Services");
  assert.equal(mapLevel("Masters Degree (Coursework)"), "PG");
  assert.equal(mapLevel("Certificate IV"), "CERTIFICATE");
  assert.equal(mapLevel("Associate Degree"), "UG_DIPLOMA");
});

test("provider names read the way students know them", () => {
  assert.equal(providerName("Melbourne Institute of Business & Technology Pty Ltd", "Deakin College"), "Deakin College");
  assert.equal(providerName("Deakin University (Deakin)", ""), "Deakin University");
  assert.equal(providerName("MONASH POLYTECHNIC COLLEGE PTY LTD", ""), "Monash Polytechnic College");
  assert.equal(campusText(["BRUCE", "Bruce", "GEELONG"]), "Bruce, Geelong");
  assert.equal(campusText(["A", "B", "C", "D", "E"]), "A, B, C and 2 more");
});

test("a small register builds providers and live courses, and drops expired ones", () => {
  const institutions = "﻿CRICOS Provider Code,Trading Name,Institution Name,Institution Type,Institution Capacity,Website,Postal Address Line 1,Postal Address Line 2,Postal Address Line 3,Postal Address Line 4,Postal Address City,Postal Address State,Postal Address Postcode\n00113B,,Deakin University (Deakin),Government,1,www.deakin.edu.au,,,,,BURWOOD,VIC,3125\n";
  const header = "CRICOS Provider Code,Institution Name,CRICOS Course Code,Course Name,VET National Code,Dual Qualification,Field of Education 1 Broad Field,Field of Education 1 Narrow Field,Field of Education 1 Detailed Field,Field of Education 2 Broad Field,Field of Education 2 Narrow Field,Field of Education 2 Detailed Field,Course Level,Foundation Studies,Work Component,Work Component Hours/Week,Work Component Weeks,Work Component Total Hours,Course Language,Duration (Weeks),Tuition Fee,Non Tuition Fee,Estimated Total Course Cost,Expired";
  const courses = `${header}\n00113B,Deakin,000001A,Master of Data Science,,No,02 - IT,0201 - Computer Science,,,,,Masters Degree (Coursework),No,No,,,,English,104,"$80,000.00",$0.00,"$80,000.00",No\n00113B,Deakin,000002B,Old Course,,No,,,,,,,Diploma,No,No,,,,English,52,"$1.00",,,Yes\n`;
  const locations = "CRICOS Provider Code,Institution Name,CRICOS Course Code,Location Name,Location City,Location State\n00113B,Deakin,000001A,Burwood,BURWOOD,VIC\n";
  const r = buildCricos({ institutions, courses, locations });
  assert.equal(r.providers.length, 1);
  assert.equal(r.courses.length, 1);
  const c = r.courses[0];
  assert.equal(c.tuitionTotal, 80000);
  assert.equal(c.durationMonths, 24);
  assert.equal(c.campus, "Burwood");
  assert.equal(c.workRights, "ELIGIBLE");
  assert.equal(r.providers[0].name, "Deakin University");
});
