import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PACK_RULES, coverSheet, nameInPack, packFileName, packName, packShapeText, type PackContents, type PackRules, withinLimit } from "../src/lib/pack";

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
    vendorReference: "KC-2026-99814",
    vendor: { name: "KC Overseas", code: "KC", extraDocuments: "KC application form, counsellor declaration", interviewRequired: true },
  },
  rules: DEFAULT_PACK_RULES,
  student: {
    id: "s1",
    medcityId: "MC-KOT-26-0041",
    name: "Arathi Krishnan",
    branch: "Medcity Kottayam",
    passportNumber: "Z1234567",
    dateOfBirth: new Date("2002-04-18"),
    surname: "Krishnan",
    given: "Arathi",
  },
  files: [
    { itemId: "i1", documentId: "d1", label: "Passport (front and back)", stage: "1. Profile", version: 2, validTo: "2031-03-18", acceptedOn: new Date("2026-09-01"), fileName: "passport.PDF", storageKey: "k1", mimeType: "application/pdf", bytes: 2_200_000 },
    { itemId: "i2", documentId: "d2", label: "IELTS test report", stage: "1. Profile", version: 1, validTo: "2026-11-10", acceptedOn: new Date("2026-09-02"), fileName: "ielts.jpg", storageKey: "k2", mimeType: "image/jpeg", bytes: 900_000 },
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
  // A vendor who takes one upload gets a PDF, and the download says so.
  assert.equal(packName(contents({ rules: { shape: "ONE_PDF", naming: null, limitMb: null } })), "Arathi Krishnan 144472 26-27 University of Dundee.pdf");
});

test("the vendor's own number for the application is on the sheet, or says it is not", () => {
  assert.match(coverSheet(contents(), "Ops"), /Their number   KC-2026-99814/);
  assert.match(coverSheet(contents({ application: { ...contents().application, vendorReference: null } }), "Ops"), /Their number {3}Not recorded/);
});

test("the sheet names the files the way the folder does, not its own way", () => {
  const sheet = coverSheet(contents({ rules: { shape: "FOLDER", naming: "{SURNAME}_{TYPE}", limitMb: null } }), "Ops");
  assert.match(sheet, /KRISHNAN_PASSPORT_FRONT_AND_BACK\.pdf/);
  assert.doesNotMatch(sheet, /01 Passport front and back\.pdf/);
});

test("a document put in before the desk accepted it is marked as such", () => {
  const c = contents();
  c.files[1].notYetAccepted = true;
  const sheet = coverSheet(c, "Ops");
  assert.match(sheet, /IELTS test report.*NOT CHECKED, put in deliberately/);
  assert.match(sheet, /added by hand before the desk accepted it/);
  // The accepted one carries no such mark.
  assert.doesNotMatch(sheet.split("\n").find((l) => l.includes("Passport")) ?? "", /NOT CHECKED/);
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

test("each vendor's own naming, down to the capitals they write it in", () => {
  const parts = { surname: "Krishnan", given: "Arathi", type: "Passport", medcityId: "MC-KTM-26-0041" };
  const rules = (naming: string | null): PackRules => ({ shape: "FOLDER", naming, limitMb: null });

  // KC writes it in capitals, so the file comes out in capitals.
  assert.equal(nameInPack(rules("{SURNAME}_{GIVEN}_{TYPE}"), 0, parts, "scan.pdf"), "KRISHNAN_ARATHI_PASSPORT.pdf");
  // Medcity's own agreements are written the way the student wrote their name.
  assert.equal(nameInPack(rules("{Surname}_{Given}_{Type}"), 0, parts, "scan.pdf"), "Krishnan_Arathi_Passport.pdf");
  // And a vendor who wants the ID in front of it gets that.
  assert.equal(nameInPack(rules("{ID}_{TYPE}"), 0, parts, "a.jpg"), "MC-KTM-26-0041_PASSPORT.jpg");
  assert.equal(nameInPack(rules("{N} {TYPE}"), 4, parts, "a.pdf"), "05 PASSPORT.pdf");

  // No pattern recorded: the portal's own numbering, as before.
  assert.equal(nameInPack(rules(null), 0, parts, "scan.pdf"), "01 Passport.pdf");

  // The extension follows the file, not the pattern.
  assert.equal(nameInPack(rules("{SURNAME}_{TYPE}"), 0, parts, "photo.PNG"), "KRISHNAN_PASSPORT.png");
  // A name with punctuation in it does not become a name with punctuation in it.
  assert.equal(nameInPack(rules("{SURNAME}_{TYPE}"), 0, { ...parts, surname: "O'Brien-Smith" }, "a.pdf"), "OBRIEN-SMITH_PASSPORT.pdf");

  // A vendor who wrote underscores between the parts did not mean to receive
  // half a name with spaces in it.
  const long = { ...parts, type: "Passport (front and back)" };
  assert.equal(nameInPack(rules("{SURNAME}_{GIVEN}_{TYPE}"), 0, long, "a.pdf"), "KRISHNAN_ARATHI_PASSPORT_FRONT_AND_BACK.pdf");
  assert.equal(nameInPack(rules("{Surname}-{Type}"), 0, long, "a.pdf"), "Krishnan-Passport-front-and-back.pdf");
  // One who wrote spaces keeps spaces.
  assert.equal(nameInPack(rules("{N} {TYPE}"), 0, long, "a.pdf"), "01 PASSPORT FRONT AND BACK.pdf");
});

test("a pack bigger than the vendor accepts is refused with what to do about it", () => {
  const rules: PackRules = { shape: "ONE_PDF", naming: null, limitMb: 10 };
  assert.equal(withinLimit(rules, 9 * 1024 * 1024).ok, true);
  const over = withinLimit(rules, 13 * 1024 * 1024);
  assert.equal(over.ok, false);
  assert.match(over.says, /13 MB and the vendor accepts 10 MB/);
  assert.match(over.says, /Take out 3 MB/);

  // A vendor who has not said is not second-guessed.
  assert.equal(withinLimit({ shape: "FOLDER", naming: null, limitMb: null }, 500 * 1024 * 1024).ok, true);
});

test("the screen says what shape the pack will be before anybody builds it", () => {
  assert.match(packShapeText({ shape: "ONE_PDF", naming: null, limitMb: null }), /One PDF/);
  assert.match(packShapeText({ shape: "FOLDER", naming: null, limitMb: null }), /folder/);
});
