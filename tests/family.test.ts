import { test } from "node:test";
import assert from "node:assert/strict";
import { accessSummary, datesAhead, guardianAddedMessage, isSoon, SOON_DAYS } from "../src/lib/family";
import { stageCopy, stageRail } from "../src/lib/journey-copy";

const today = new Date("2026-10-02T09:00:00Z");

test("the dates a family sees are nearest first", () => {
  const dates = datesAhead(
    {
      documents: [
        { label: "Passport", dueOn: "2026-11-01" },
        { label: "Bank statement", dueOn: "2026-10-10" },
      ],
      applications: [{ offerAcceptBy: "2026-10-20", intakeMonth: 1, intakeYear: 2027, visaLodgedOn: null, visaDecision: null }],
    },
    today,
  );
  assert.deepEqual(
    dates.map((d) => d.kind),
    ["DOCUMENT_DUE", "OFFER_ACCEPT", "DOCUMENT_DUE", "COURSE_START"],
  );
  assert.equal(dates[0].about, "Bank statement");
  assert.equal(dates[0].inDays, 8);
});

test("a date already gone past is kept, because a missed one matters most", () => {
  const [first] = datesAhead({ documents: [{ label: "Passport", dueOn: "2026-09-25" }], applications: [] }, today);
  assert.equal(first.inDays, -7);
  assert.equal(isSoon(first), true);
});

test("a course start is the first of the intake month and nothing finer", () => {
  const [d] = datesAhead({ documents: [], applications: [{ offerAcceptBy: null, intakeMonth: 9, intakeYear: 2027, visaLodgedOn: null, visaDecision: null }] }, today);
  assert.equal(d.kind, "COURSE_START");
  assert.equal(d.on.getFullYear(), 2027);
  assert.equal(d.on.getMonth(), 8);
  assert.equal(d.on.getDate(), 1);
});

test("a visa already decided is not a date that is coming", () => {
  const waiting = datesAhead({ documents: [], applications: [{ offerAcceptBy: null, intakeMonth: null, intakeYear: null, visaLodgedOn: "2026-09-01", visaDecision: null }] }, today);
  assert.equal(waiting.length, 1);
  const decided = datesAhead({ documents: [], applications: [{ offerAcceptBy: null, intakeMonth: null, intakeYear: null, visaLodgedOn: "2026-09-01", visaDecision: "GRANTED" }] }, today);
  assert.equal(decided.length, 0);
});

test("nothing recorded means nothing shown, never a date invented", () => {
  assert.deepEqual(datesAhead({ documents: [{ label: "Passport", dueOn: null }], applications: [{ offerAcceptBy: null, intakeMonth: null, intakeYear: null, visaLodgedOn: null, visaDecision: null }] }, today), []);
});

test("the same date twice from two applications is listed once", () => {
  const dates = datesAhead(
    {
      documents: [],
      applications: [
        { offerAcceptBy: "2026-10-20", intakeMonth: 1, intakeYear: 2027, visaLodgedOn: null, visaDecision: null },
        { offerAcceptBy: "2026-10-20", intakeMonth: 1, intakeYear: 2027, visaLodgedOn: null, visaDecision: null },
      ],
    },
    today,
  );
  assert.equal(dates.length, 2);
});

test("a date beyond three weeks is listed but not flagged", () => {
  const [d] = datesAhead({ documents: [{ label: "Passport", dueOn: "2026-12-01" }], applications: [] }, today);
  assert.ok(d.inDays > SOON_DAYS);
  assert.equal(isSoon(d), false);
});

test("the access summary says what the parent can and cannot do", () => {
  assert.match(accessSummary(true), /fees/);
  assert.match(accessSummary(false), /No fees/);
  for (const seesMoney of [true, false]) assert.match(accessSummary(seesMoney), /[Cc]annot change anything/);
});

test("the student is told who was added and what they can see", () => {
  const en = guardianAddedMessage({ studentFirstName: "Fathima", guardianName: "Ismail", relation: "Father", seesMoney: false, branchName: "Medcity Kottayam" }, "en");
  assert.match(en, /Fathima/);
  assert.match(en, /Ismail \(Father\)/);
  assert.ok(!en.includes("the fees"));
  assert.match(en, /tell your counsellor/);
  const withMoney = guardianAddedMessage({ studentFirstName: "Fathima", guardianName: "Ismail", relation: "Father", seesMoney: true, branchName: "Medcity Kottayam" }, "en");
  assert.match(withMoney, /the fees/);
});

test("the notice exists in Malayalam and is not the English one", () => {
  const ml = guardianAddedMessage({ studentFirstName: "Fathima", guardianName: "Ismail", relation: "Father", seesMoney: true, branchName: "Medcity Kottayam" }, "ml");
  assert.match(ml, /[ഀ-ൿ]/);
  assert.ok(!/can now read your file/.test(ml));
});

test("the rail ticks what is behind and names what is now", () => {
  const rail = stageRail("VISA", "en");
  assert.equal(rail.length, 9);
  assert.deepEqual(
    rail.map((s) => s.position),
    ["DONE", "DONE", "DONE", "DONE", "DONE", "DONE", "NOW", "AHEAD", "AHEAD"],
  );
  assert.equal(rail[6].number, 7);
});

test("the first and last stages are handled without a stage behind or ahead", () => {
  assert.equal(stageRail("PROFILE", "en")[0].position, "NOW");
  const arrived = stageRail("ARRIVED", "en");
  assert.equal(arrived[8].position, "NOW");
  assert.ok(arrived.every((s) => s.position !== "AHEAD"));
});

test("every stage has copy in both languages, and Malayalam is not English", () => {
  for (const step of stageRail("PROFILE", "en")) {
    const en = stageCopy(step.stage, "en");
    const ml = stageCopy(step.stage, "ml");
    assert.ok(en.title.length > 0 && en.now.length > 0, step.stage);
    assert.match(ml.title, /[ഀ-ൿ]/, step.stage);
    assert.match(ml.now, /[ഀ-ൿ]/, step.stage);
  }
});
