import { test } from "node:test";
import assert from "node:assert/strict";
import { coverSheet, packFileName, packName, type PackContents } from "../src/lib/pack";

const contents = (over: Partial<PackContents> = {}): PackContents => ({
  application: {
    id: "a1",
    ackNo: "144472/26-27",
    intake: "Sep 2027",
    course: "MSc Computer Science",
    university: "University of Dundee",
    campus: null,
    country: "United Kingdom",
    status: "Application in progress",
    vendor: { name: "KC Overseas", code: "KC", extraDocuments: "KC application form, counsellor declaration", interviewRequired: true },
  },
  student: { id: "s1", medcityId: "MC-KOT-26-0041", name: "Arathi Krishnan", branch: "Medcity Kottayam", passportNumber: "Z1234567", dateOfBirth: new Date("2002-04-18") },
  files: [
    { itemId: "i1", documentId: "d1", label: "Passport (front and back)", stage: "1. Profile", version: 2, validTo: "2031-03-18", acceptedOn: new Date("2026-09-01"), fileName: "passport.PDF", storageKey: "k1", mimeType: "application/pdf" },
    { itemId: "i2", documentId: "d2", label: "IELTS test report", stage: "1. Profile", version: 1, validTo: "2026-11-10", acceptedOn: new Date("2026-09-02"), fileName: "ielts.jpg", storageKey: "k2", mimeType: "image/jpeg" },
  ],
  missing: [{ label: "Statement of purpose", why: "Asked for, nothing back", owedBy: "STUDENT" }],
  expiring: [{ label: "IELTS test report", validTo: "2026-11-10" }],
  ...over,
});

test("a file in the folder is numbered, named and keeps its own extension", () => {
  assert.equal(packFileName(0, "Passport (front and back)", "passport.PDF"), "01 Passport front and back.pdf");
  assert.equal(packFileName(9, "CV / resume", "cv.docx"), "10 CV resume.docx");
  assert.equal(packFileName(0, "Bank statement", null), "01 Bank statement.pdf", "no original name falls back to pdf rather than nothing");
});

test("the front sheet says what the folder is and who it is for", () => {
  const sheet = coverSheet(contents(), "Jeslin, documentation", new Date("2026-09-30"));
  assert.match(sheet, /University of Dundee — MSc Computer Science/);
  assert.match(sheet, /Application 144472\/26-27, Sep 2027 intake/);
  assert.match(sheet, /Arathi Krishnan/);
  assert.match(sheet, /Jeslin, documentation/);
});

test("the route is named, with what it asks for beyond the university's list", () => {
  const sheet = coverSheet(contents(), "Ops");
  assert.match(sheet, /KC Overseas \(KC\)/);
  assert.match(sheet, /counsellor declaration/);
  assert.match(sheet, /An interview is part of this route/);
});

test("Medcity's own route says so rather than leaving a blank", () => {
  const sheet = coverSheet(contents({ application: { ...contents().application, vendor: null } }), "Ops");
  assert.match(sheet, /direct to the university/);
  assert.doesNotMatch(sheet, /asks for this beyond/);
});

test("what is missing is on the sheet, not left for the university to notice", () => {
  const sheet = coverSheet(contents(), "Ops");
  assert.match(sheet, /Not in this folder, and still required/);
  assert.match(sheet, /Statement of purpose/);
  assert.match(sheet, /owed by student/);
});

test("a complete folder says so plainly", () => {
  const sheet = coverSheet(contents({ missing: [], expiring: [] }), "Ops");
  assert.match(sheet, /Nothing required is missing\./);
  assert.doesNotMatch(sheet, /running out too early/);
});

test("anything that runs out too early is called out where it will be read", () => {
  const sheet = coverSheet(contents(), "Ops");
  assert.match(sheet, /In the folder, but running out too early/);
  assert.match(sheet, /count as missing until they are renewed/);
  assert.match(sheet, /IELTS test report/);
});

test("nothing unverified is filled in: a missing date reads as not recorded", () => {
  const sheet = coverSheet(contents({ student: { ...contents().student, passportNumber: null, dateOfBirth: null } }), "Ops");
  assert.match(sheet, /Date of birth {2}Not recorded/);
  assert.match(sheet, /Passport {7}Not recorded/);
});

test("the download is named so it can be found again on a desktop", () => {
  assert.equal(packName(contents()), "Arathi Krishnan 144472 26-27 University of Dundee.zip");
});

test("a document in the folder that is out of date is one problem, not two", () => {
  const c = contents({ missing: [{ label: "IELTS test report", why: "Expires before the course starts", owedBy: "STUDENT" }] });
  const sheet = coverSheet(c, "Ops");
  assert.match(sheet, /In the folder, but running out too early/);
  assert.doesNotMatch(sheet, /Not in this folder, and still required/);
});

test("the front sheet carries the Medcity ID, and says so when there is none", () => {
  assert.match(coverSheet(contents(), "Priya"), /Medcity ID {5}MC-KOT-26-0041/);
  const noId = contents({ student: { ...contents().student, medcityId: null } });
  assert.match(coverSheet(noId, "Priya"), /Medcity ID {5}Not recorded/);
});
