import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUSBILDUNG_HANDOVER_ROLES,
  AUSBILDUNG_STEPS,
  DESK_HANDOVER_STEP,
  MENTOR_PART,
  MENTOR_SETTING_ROLES,
  beforeTheDesk,
  canHandToDesk,
  handedToDeskByStatus,
  mentorOwnsStep,
  stepOfStatus,
} from "../src/lib/ausbildung";
import { STATUS_SEED } from "../src/db/statuses";
import { ADMIN_ROLES, DOCUMENTATION_ROLES, PARTNER_ROLES } from "../src/lib/permissions";

const codes = STATUS_SEED.AUSBILDUNG.map((s) => s.code);

test("the hand-over step is the guide's step 4, assigning a mentor", () => {
  const step = AUSBILDUNG_STEPS.find((s) => s.step === DESK_HANDOVER_STEP);
  assert.ok(step, "step 4 is in the written process");
  assert.equal(step.department, "DOCUMENTATION");
  assert.ok(step.statusCodes.includes("MENTOR_ASSIGNED"));
});

test("moving to Mentor assigned or any later step hands the file to the desk", () => {
  assert.equal(handedToDeskByStatus("MENTOR_ASSIGNED"), true);
  for (const code of ["DOCUMENT_PREPARATION", "PROFILE_CV", "LANGUAGE_ASSESSMENT", "EMPLOYER_MATCHING", "EMPLOYER_INTERVIEW", "CONTRACT_SIGNED", "VISA_FILED", "JOINED", "HAPPY_CALL"]) {
    assert.equal(handedToDeskByStatus(code), true, `${code} is at or past the desk`);
  }
});

test("document collection is the branch's step and hands nothing over by itself", () => {
  assert.equal(handedToDeskByStatus("DOCUMENT_COLLECTION"), false);
  assert.equal(beforeTheDesk("DOCUMENT_COLLECTION"), true);
  assert.equal(beforeTheDesk("MENTOR_ASSIGNED"), false);
});

test("a status the guide does not place hands nothing over and is not before the desk either", () => {
  for (const code of ["ON_HOLD_INTAKE", "DEFERRED", "CASE_CLOSED", "WITHDRAWN", "PENDING_PARTNER", null, undefined, ""]) {
    assert.equal(handedToDeskByStatus(code), false, `${code} hands nothing over`);
    assert.equal(beforeTheDesk(code), false, `${code} is not a branch step`);
  }
});

test("every Ausbildung status the guide places is either before the desk or hands over, never both", () => {
  for (const code of codes) {
    const step = stepOfStatus(code);
    if (!step) continue;
    assert.notEqual(handedToDeskByStatus(code), beforeTheDesk(code), `${code} is on one side of the hand-over`);
    assert.equal(handedToDeskByStatus(code), step.step >= DESK_HANDOVER_STEP, `${code} follows its step number`);
  }
});

test("the branch may hand over once the profile paper is in, and not twice", () => {
  assert.deepEqual(canHandToDesk({ handedOver: false, closed: false, gateClear: true, missing: [] }), { ready: true, why: null });
  const again = canHandToDesk({ handedOver: true, closed: false, gateClear: true, missing: [] });
  assert.equal(again.ready, false);
  assert.match(again.why ?? "", /Already with the documentation desk/);
});

test("a hand-over short of paper names what is missing, and a closed file is refused first", () => {
  const short = canHandToDesk({ handedOver: false, closed: false, gateClear: false, missing: ["Passport (front and back)", "German language certificate"] });
  assert.equal(short.ready, false);
  assert.equal(short.why, "Still needed before this can go: Passport (front and back), German language certificate.");
  const closed = canHandToDesk({ handedOver: false, closed: true, gateClear: false, missing: ["Passport (front and back)"] });
  assert.equal(closed.why, "This application is closed.");
});

test("the mentor carries the documentation and language steps, not placement, visa or travel", () => {
  assert.equal(mentorOwnsStep("DOCUMENTATION"), true);
  assert.equal(mentorOwnsStep("LANGUAGE"), true);
  for (const d of ["COUNSELLING", "PLACEMENT", "VISA", "TRAVEL", null, undefined] as const) assert.equal(mentorOwnsStep(d), false, `${d} is not the mentor's`);
});

test("the mentor is kept on the file under a readable part, and the roles are the branch's and the desk's", () => {
  assert.equal(MENTOR_PART, "Documentation mentor");
  for (const r of PARTNER_ROLES) assert.ok((AUSBILDUNG_HANDOVER_ROLES as readonly string[]).includes(r), `${r} hands over`);
  for (const r of ADMIN_ROLES) assert.ok((AUSBILDUNG_HANDOVER_ROLES as readonly string[]).includes(r), `${r} hands over`);
  assert.ok(!(AUSBILDUNG_HANDOVER_ROLES as readonly string[]).includes("DOCUMENTATION"), "the desk does not hand a file to itself");
  for (const r of DOCUMENTATION_ROLES) assert.ok((MENTOR_SETTING_ROLES as readonly string[]).includes(r), `${r} names the mentor`);
  assert.ok(!(MENTOR_SETTING_ROLES as readonly string[]).includes("PARTNER"), "the branch does not name the mentor");
});
