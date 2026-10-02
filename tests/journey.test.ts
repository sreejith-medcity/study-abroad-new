import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXPIRY_WARNING_DAYS,
  canWaive,
  gate,
  lockedMissing,
  nextStage,
  stageLabel,
  stageRank,
  standing,
  standingText,
  validUntil,
  waiveRefusal,
  type GateItem,
} from "../src/lib/journey";

const day = 86_400_000;
const today = new Date("2026-09-30T00:00:00Z");
const courseStart = new Date("2027-01-10T00:00:00Z");
const item = (over: Partial<GateItem> = {}): GateItem => ({
  typeCode: "PASSPORT",
  label: "Passport",
  required: true,
  owedBy: "STUDENT",
  state: "ACCEPTED",
  validTo: null,
  ...over,
});

test("the nine stages are numbered and ordered as the team describes them", () => {
  assert.equal(stageLabel("PROFILE"), "1. Profile");
  assert.equal(stageLabel("VISA"), "7. Visa");
  assert.equal(stageRank("ARRIVED"), 8);
  assert.equal(nextStage("ARRIVED"), null);
  assert.equal(nextStage("PROFILE"), "SHORTLIST");
});

test("expiry is measured against the course start, not against today", () => {
  // Good for another 90 days, which is comfortably past today and short of the
  // course start: today would call it fine, the course start calls it expired.
  const validTo = new Date(today.getTime() + 90 * day);
  assert.equal(standing(item({ validTo }), courseStart, today).standing, "EXPIRED");
  assert.equal(standing(item({ validTo }), null, today).standing, "DONE");
});

test("a document that runs out soon after the course starts is flagged, not failed", () => {
  const validTo = new Date(courseStart.getTime() + (EXPIRY_WARNING_DAYS - 5) * day);
  assert.equal(standing(item({ validTo }), courseStart, today).standing, "EXPIRING");
});

test("an accepted document with no date on record is in hand, never guessed at", () => {
  assert.equal(standing(item(), courseStart, today).standing, "DONE");
  assert.equal(standing(item({ validTo: null, state: "ASKED" }), courseStart, today).standing, "OUTSTANDING");
});

test("a document marked not needed is out of the reckoning entirely", () => {
  const g = gate([item({ state: "NOT_NEEDED", required: true })], courseStart, today);
  assert.deepEqual([g.total, g.done, g.clear], [0, 0, true]);
});

test("only required documents hold the gate", () => {
  const g = gate([item(), item({ typeCode: "CV", label: "CV", required: false, state: "NOT_ASKED" })], courseStart, today);
  assert.equal(g.clear, true);
  assert.equal(g.withStudent, 1, "it is still owed by the student and still chased");
});

test("the gate names what is missing and who is holding it up", () => {
  const g = gate(
    [
      item(),
      item({ typeCode: "TB_TEST", label: "TB test certificate", state: "ASKED" }),
      item({ typeCode: "VISA_FORM", label: "Visa form", state: "NOT_ASKED", owedBy: "MEDCITY" }),
      item({ typeCode: "BANK_STATEMENT", label: "Bank statement", state: "REJECTED" }),
    ],
    courseStart,
    today,
  );
  assert.equal(g.clear, false);
  assert.deepEqual(
    g.missing.map((m) => [m.label, m.why]),
    [
      ["TB test certificate", "Asked for, nothing back"],
      ["Visa form", "Not asked for yet"],
      ["Bank statement", "Sent back"],
    ],
  );
  assert.deepEqual([g.withStudent, g.withUs, g.rejected], [2, 1, 1]);
  assert.deepEqual([g.done, g.total], [1, 4]);
});

test("an expired document counts as missing, and says why", () => {
  const g = gate([item({ validTo: new Date(today.getTime() + 10 * day) })], courseStart, today);
  assert.equal(g.clear, false);
  assert.equal(g.missing[0].why, "Expires before the course starts");
  assert.equal(standingText("EXPIRED", null), "Out of date");
});

test("validity is counted from the date on the document, and a short month does not roll over", () => {
  assert.deepEqual(validUntil("2026-04-12", 6), new Date("2026-10-12T00:00:00.000Z"));
  assert.deepEqual(validUntil("2026-08-31", 6), new Date("2027-02-28T00:00:00.000Z"));
  assert.equal(validUntil(null, 6), null, "no date on the document means no expiry, not today plus six months");
  assert.equal(validUntil("2026-04-12", null), null, "no validity recorded means none is invented");
});


test("a gate marked as never waived cannot be let through, and says which item", () => {
  const g = gate(
    [
      item({ typeCode: "PASSPORT", label: "Passport", state: "NOT_ASKED", neverWaive: true }),
      item({ typeCode: "SOP", label: "Statement of purpose", state: "NOT_ASKED" }),
    ],
    courseStart,
    today,
  );
  assert.equal(g.clear, false);
  assert.equal(canWaive(g), false);
  assert.deepEqual(
    lockedMissing(g).map((m) => m.label),
    ["Passport"],
    "only the marked one is locked; the rest can still be let through once it is in",
  );
  const refusal = waiveRefusal(g);
  assert.match(refusal, /^Passport cannot be waived by anybody/);
  assert.match(refusal, /It has been marked/, "one item reads as one item");
});

test("a gate with nothing marked can still be let through with a reason", () => {
  const g = gate([item({ state: "NOT_ASKED" })], courseStart, today);
  assert.equal(g.clear, false);
  assert.equal(canWaive(g), true);
  assert.equal(lockedMissing(g).length, 0);
  assert.equal(waiveRefusal(g), "", "nothing to refuse, so nothing is said");
});

test("a clear gate is waivable in the trivial sense, and refuses nothing", () => {
  const g = gate([item()], courseStart, today);
  assert.equal(g.clear, true);
  assert.equal(canWaive(g), true);
  assert.equal(waiveRefusal(g), "");
});

test("an item that is marked but not required never reaches the gate at all", () => {
  // Only required items gate a stage, so a nice-to-have marked as never waived
  // is a contradiction the gate simply does not see.
  const g = gate([item({ required: false, state: "NOT_ASKED", neverWaive: true })], courseStart, today);
  assert.equal(g.clear, true);
  assert.equal(lockedMissing(g).length, 0);
});

test("two locked items are named together and read as plural", () => {
  const g = gate(
    [
      item({ typeCode: "PASSPORT", label: "Passport", state: "NOT_ASKED", neverWaive: true }),
      item({ typeCode: "DEGREE", label: "Degree certificate", state: "REJECTED", neverWaive: true }),
    ],
    courseStart,
    today,
  );
  const refusal = waiveRefusal(g);
  assert.match(refusal, /Passport, Degree certificate cannot be waived/);
  assert.match(refusal, /They have been marked/);
  assert.match(refusal, /until they are in/);
});
