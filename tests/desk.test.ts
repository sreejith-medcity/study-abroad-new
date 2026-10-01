import { test } from "node:test";
import assert from "node:assert/strict";
import { canHandOver, OUTCOME_GROUP, SETTLES_IT, TELLS_THE_BRANCH, turnaroundText, vendorSilence, vendorTurnaround, VENDOR_SILENCE_DAYS } from "../src/lib/desk";

const day = 86_400_000;

test("a counsellor may hand over only once the documents are in", () => {
  assert.deepEqual(canHandOver({ deskStage: "PREPARING", gateClear: true, missing: [], closed: false }), { ready: true, why: null });
  const short = canHandOver({ deskStage: "PREPARING", gateClear: false, missing: ["Statement of purpose", "Passport"], closed: false });
  assert.equal(short.ready, false);
  assert.match(short.why ?? "", /Statement of purpose, Passport/, "the refusal names what is missing rather than being a bare error");
});

test("a file already with the desk is not handed over twice", () => {
  for (const stage of ["READY", "CHOSEN", "SUBMITTED"] as const) {
    assert.equal(canHandOver({ deskStage: stage, gateClear: true, missing: [], closed: false }).ready, false, stage);
  }
});

test("a file sent back may be handed over again once it is fixed", () => {
  assert.equal(canHandOver({ deskStage: "RETURNED", gateClear: true, missing: [], closed: false }).ready, true);
  assert.equal(canHandOver({ deskStage: "RETURNED", gateClear: false, missing: ["Bank statement"], closed: false }).ready, false);
});

test("a closed application goes nowhere", () => {
  const v = canHandOver({ deskStage: "PREPARING", gateClear: true, missing: [], closed: true });
  assert.equal(v.ready, false);
  assert.match(v.why ?? "", /closed/);
});

test("turnaround is counted in the vendor's dates, from lodged to answered", () => {
  assert.equal(vendorTurnaround(new Date("2026-09-01T18:00:00Z"), "2026-09-06"), 5, "the clock is in days, not hours, so the time of day cannot skew it");
  assert.equal(vendorTurnaround(new Date("2026-09-01"), "2026-09-01"), 0, "answered the same day is nought, not nothing");
});

test("a turnaround that cannot be known is not invented", () => {
  assert.equal(vendorTurnaround(null, "2026-09-06"), null);
  assert.equal(vendorTurnaround(new Date("2026-09-01"), null), null);
  assert.equal(vendorTurnaround(new Date("2026-09-10"), "2026-09-01"), null, "an answer before it was lodged is a typing error, not a negative turnaround");
});

test("the turnaround reads against what the vendor quotes", () => {
  assert.equal(turnaroundText(5, 7), "Took 5 days, inside the 7 they quote");
  assert.equal(turnaroundText(12, 7), "Took 12 days, 5 past the 7 they quote");
  assert.equal(turnaroundText(1, null), "Took 1 day");
  assert.equal(turnaroundText(null, 7), "Promised within 7 days");
  assert.equal(turnaroundText(null, null), "Not recorded");
});

test("a vendor that has said nothing for a week is called quiet, and one that has not is not", () => {
  const today = new Date("2026-09-30T00:00:00Z");
  const lodged = new Date(today.getTime() - (VENDOR_SILENCE_DAYS + 1) * day);
  assert.equal(vendorSilence({ submittedAt: lodged, lastUpdateAt: null, settled: false }, today).quiet, true);
  assert.equal(vendorSilence({ submittedAt: new Date(today.getTime() - 2 * day), lastUpdateAt: null, settled: false }, today).quiet, false);
});

test("silence is measured from the last thing they said, not from the day it was lodged", () => {
  const today = new Date("2026-09-30T00:00:00Z");
  const lodged = new Date(today.getTime() - 30 * day);
  const spokeYesterday = new Date(today.getTime() - 1 * day);
  assert.equal(vendorSilence({ submittedAt: lodged, lastUpdateAt: spokeYesterday, settled: false }, today).quiet, false);
});

test("nothing is chased once the vendor has answered for good, or before it is lodged", () => {
  const today = new Date("2026-09-30T00:00:00Z");
  const lodged = new Date(today.getTime() - 30 * day);
  assert.equal(vendorSilence({ submittedAt: lodged, lastUpdateAt: null, settled: true }, today).quiet, false);
  assert.deepEqual(vendorSilence({ submittedAt: null, lastUpdateAt: null, settled: false }, today), { quiet: false, days: null });
});

test("every outcome has a place in the status flow, or openly has none", () => {
  assert.equal(OUTCOME_GROUP.OFFER_ISSUED, "OFFER");
  assert.equal(OUTCOME_GROUP.DOCUMENTS_ASKED, "PENDING_PARTNER");
  assert.equal(OUTCOME_GROUP.REJECTED, "CLOSED");
  assert.equal(OUTCOME_GROUP.DEFERRED, "HOLD");
  assert.equal(OUTCOME_GROUP.OTHER, null, "something else moves nothing on its own");
});

test("the branch hears about what affects them, and the clock stops on what settles it", () => {
  assert.ok(TELLS_THE_BRANCH.includes("DOCUMENTS_ASKED"), "the branch has to collect it");
  assert.ok(TELLS_THE_BRANCH.includes("OFFER_ISSUED"));
  assert.ok(!TELLS_THE_BRANCH.includes("ACKNOWLEDGED"), "a receipt is not news");
  assert.deepEqual(SETTLES_IT, ["OFFER_ISSUED", "REJECTED", "WITHDRAWN"]);
});
