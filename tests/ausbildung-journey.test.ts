import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AUSBILDUNG_DEPARTMENTS, AUSBILDUNG_PAYMENT_MILESTONES, AUSBILDUNG_STEPS, AUSBILDUNG_TEAM, stepOfStatus } from "../src/lib/ausbildung";
import { MILESTONE_PHRASE, STUDENT_DESK_PHRASE, STUDENT_STEP_PHRASE, deskStanding, nextMilestone, nextStep, pickAusbildungApplication, studentMilestones, studentStepLine } from "../src/lib/ausbildung-journey";
import { translator } from "../src/lib/i18n";

/*
 * The journey card on the student portal: what each step of the written process
 * means in the student's words, which desk is lit, which application is shown
 * and which payment is next. Pure rules, so they are checked here without a
 * browser; the browser suite checks the markup they feed.
 */

const t = translator("en");

test("every step of the written process has a line for the student, and nothing else does", () => {
  for (const step of AUSBILDUNG_STEPS) {
    const line = studentStepLine(step.step);
    assert.ok(line && line.length > 0, `step ${step.step} has a student line`);
    assert.notEqual(line, step.title, `step ${step.step} does not reuse the staff title`);
  }
  assert.equal(Object.keys(STUDENT_STEP_PHRASE).length, AUSBILDUNG_STEPS.length, "one phrase per step, no strays");
  assert.equal(studentStepLine(17), null, "the guide has no step 17, so there is no line for it");
  assert.equal(studentStepLine(null), null);
});

test("the student lines read as the guide's examples do", () => {
  assert.equal(studentStepLine(4), "Your documentation mentor is being assigned");
  assert.equal(studentStepLine(stepOfStatus("EMPLOYER_INTERVIEW")?.step), "Interviews with employers are being arranged for you");
  assert.equal(studentStepLine(stepOfStatus("DOCUMENT_COLLECTION")?.step), "Collecting your documents");
});

test("every student line is distinct, and none carries anything internal", () => {
  const lines = AUSBILDUNG_STEPS.map((s) => studentStepLine(s.step)!);
  assert.equal(new Set(lines).size, lines.length, "two steps never read the same");
  const internal = [/@/, /T\+\d/, /turnaround/i, /\bTAT\b/, /same day/i, new RegExp(String.fromCharCode(8212))];
  for (const line of lines) for (const re of internal) assert.ok(!re.test(line), `"${line}" matches ${re}`);
  for (const c of AUSBILDUNG_TEAM) for (const line of lines) assert.ok(!line.includes(c.email), `no desk email in "${line}"`);
});

test("the desk names and milestone phrases cover every desk and every milestone", () => {
  for (const d of AUSBILDUNG_DEPARTMENTS) assert.ok(t(STUDENT_DESK_PHRASE[d.key]).length > 0, `${d.key} has a student name`);
  for (const m of AUSBILDUNG_PAYMENT_MILESTONES) {
    assert.ok(MILESTONE_PHRASE[m.step], `milestone at step ${m.step} has phrases`);
    assert.ok(t(MILESTONE_PHRASE[m.step].label).length > 0 && t(MILESTONE_PHRASE[m.step].when).length > 0);
  }
  assert.equal(Object.keys(MILESTONE_PHRASE).length, AUSBILDUNG_PAYMENT_MILESTONES.length);
});

test("the next step follows the guide's order and runs out at the happy call", () => {
  assert.equal(nextStep(stepOfStatus("DOCUMENT_COLLECTION"))?.step, 4);
  assert.equal(nextStep(stepOfStatus("PRE_DEPARTURE"))?.step, 18, "the guide skips 17");
  assert.equal(nextStep(stepOfStatus("HAPPY_CALL")), null);
  assert.equal(nextStep(null), null);
  assert.equal(nextStep(stepOfStatus("ON_HOLD_INTAKE")), null, "a status the guide does not place has no next step");
});

test("the desks light up by the current step, and a desk is done only once all its steps are behind", () => {
  const at = (code: string) => Object.fromEntries(deskStanding(stepOfStatus(code)).map((d) => [d.key, d.position]));
  const interview = at("EMPLOYER_INTERVIEW");
  assert.equal(interview.PLACEMENT, "NOW");
  assert.equal(interview.COUNSELLING, "DONE");
  assert.equal(interview.DOCUMENTATION, "DONE");
  assert.equal(interview.LANGUAGE, "DONE");
  assert.equal(interview.VISA, "AHEAD");
  assert.equal(interview.TRAVEL, "AHEAD");
  // Step 7 is language, but documentation still has step 9 to come.
  const readiness = at("LANGUAGE_ASSESSMENT");
  assert.equal(readiness.LANGUAGE, "NOW");
  assert.equal(readiness.DOCUMENTATION, "AHEAD");
  assert.equal(readiness.COUNSELLING, "DONE");
  // Nothing placed: nothing lit.
  assert.ok(deskStanding(null).every((d) => d.position === "AHEAD"));
  assert.equal(deskStanding(null).length, AUSBILDUNG_DEPARTMENTS.length);
});

test("the portal shows the Ausbildung application the staff tab does: open, live before finished, latest moved first", () => {
  const apps = [
    { id: "degree", pathway: "DEGREE", statusGroup: "IN_PROGRESS", changedAt: new Date("2026-10-01") },
    { id: "joined", pathway: "AUSBILDUNG", statusGroup: "SUCCESS", changedAt: new Date("2026-10-20") },
    { id: "interview", pathway: "AUSBILDUNG", statusGroup: "IN_PROGRESS", changedAt: new Date("2026-09-01") },
    { id: "closed", pathway: "AUSBILDUNG", statusGroup: "CLOSED", changedAt: new Date("2026-10-25") },
  ];
  assert.equal(pickAusbildungApplication(apps)?.id, "interview", "a round still being worked beats a finished one, whatever moved last");
  assert.equal(pickAusbildungApplication(apps.filter((a) => a.id !== "interview"))?.id, "joined", "a finished round is shown when it is all there is");
  assert.equal(pickAusbildungApplication(apps.filter((a) => a.pathway !== "AUSBILDUNG")), null, "a degree student has no Ausbildung application");
  assert.equal(pickAusbildungApplication([apps[3]]), null, "a closed round is not shown");
  const two = [
    { id: "older", pathway: "AUSBILDUNG", statusGroup: "IN_PROGRESS", changedAt: new Date("2026-08-01") },
    { id: "newer", pathway: "AUSBILDUNG", statusGroup: "NEW", changedAt: new Date("2026-10-01") },
  ];
  assert.equal(pickAusbildungApplication(two)?.id, "newer", "between two live rounds the one that moved last is shown");
});

test("the next milestone is the first percentage not yet covered by what came in", () => {
  assert.equal(nextMilestone(50000, 0, "EMPLOYER_INTERVIEW")?.step, 7, "nothing received: half is next");
  assert.equal(nextMilestone(50000, 25000, "DOCUMENT_COLLECTION")?.step, 11, "half paid early: 80% is next whatever the status");
  assert.equal(nextMilestone(50000, 40000, "VISA_FILED")?.step, 12);
  assert.equal(nextMilestone(50000, 50000, "VISA_FILED"), null, "everything paid: nothing is next");
  assert.equal(nextMilestone(50000, 60000, "VISA_FILED"), null, "overpaid still means nothing is next");
  assert.equal(nextMilestone(50000, 39999, "VISA_FILED")?.step, 11, "a rupee short of a milestone leaves it next");
});

test("with no charge raised the next milestone is read off the process and no amount is invented", () => {
  const rows = studentMilestones(0, 0, "EMPLOYER_INTERVIEW");
  assert.ok(rows.every((m) => m.amount === null), "no amount to show");
  assert.ok(rows.every((m) => !m.met), "nothing is marked paid");
  assert.equal(rows.find((m) => m.next)?.step, 11, "at step 10 the contract payment is the one coming");
  assert.equal(nextMilestone(0, 0, "LANGUAGE_PENDING")?.step, 7, "at step 5 the half is the one coming");
  assert.equal(nextMilestone(0, 0, null)?.step, 2, "with no step placed the registration fee comes first");
  assert.equal(nextMilestone(0, 0, "JOINED"), null, "past the last milestone nothing is marked next");
  assert.equal(nextMilestone(0, 0, "DOCUMENT_COLLECTION")?.step, 7, "at step 3 the registration fee is behind and the half is next");
});

test("the milestone amounts come from the shared constant and only one is next", () => {
  const rows = studentMilestones(50000, 25000, "EMPLOYER_INTERVIEW");
  assert.deepEqual(rows.map((m) => m.amount), [null, 25000, 40000, 50000]);
  assert.deepEqual(rows.map((m) => m.met), [false, true, false, false]);
  assert.equal(rows.filter((m) => m.next).length, 1);
  assert.deepEqual(rows.map((m) => m.step), AUSBILDUNG_PAYMENT_MILESTONES.map((m) => m.step));
});

test("the new portal phrases are marked untranslated rather than given invented Malayalam", () => {
  const src = readFileSync(new URL("../src/lib/i18n.ts", import.meta.url), "utf8");
  for (const key of ["ausbildungJourney", "whatHappensNext", "germanLevels", "paymentsTitle", "notRecorded"]) {
    assert.ok(src.includes(`| "${key}"`), `${key} is listed under Untranslated`);
  }
  // The step lines are listed under Untranslated as one template type, so the
  // fallback itself is what proves no Malayalam was invented for them.
  for (const step of AUSBILDUNG_STEPS) assert.equal(translator("ml")(STUDENT_STEP_PHRASE[step.step]), studentStepLine(step.step, "en"), `step ${step.step} falls back to the English line`);
  assert.equal(translator("ml")("ausbildungJourney"), "Your Ausbildung journey", "the card title falls back to English");
  assert.ok(!src.includes(String.fromCharCode(8212)), "no em dash in the dictionary");
});
