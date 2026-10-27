import { test } from "node:test";
import assert from "node:assert/strict";
import { isUnassignedFile, unassignedText } from "../src/lib/unassigned-files";

const handed = { handedOverAt: new Date("2026-10-20T09:00:00Z"), officerId: null, deskStage: "READY", statusGroup: "NEW" };

test("a file the branch has handed over with nobody on it is waiting for an officer", () => {
  assert.equal(isUnassignedFile(handed), true);
  // Wherever it is at the desk, as long as it is still at the desk.
  for (const deskStage of ["READY", "CHOSEN", "SUBMITTED"]) assert.equal(isUnassignedFile({ ...handed, deskStage }), true, deskStage);
  for (const statusGroup of ["NEW", "PENDING_PARTNER", "IN_PROGRESS", "OFFER", "HOLD", "SUCCESS"]) {
    assert.equal(isUnassignedFile({ ...handed, statusGroup }), true, statusGroup);
  }
});

test("a file the branch still has is the branch's, not the desk's to hand out", () => {
  assert.equal(isUnassignedFile({ ...handed, handedOverAt: null, deskStage: "PREPARING" }), false);
});

test("a file somebody carries is not unassigned", () => {
  assert.equal(isUnassignedFile({ ...handed, officerId: "officer-1" }), false);
});

test("a file sent back to the branch, or a closed case, is not waiting for anybody", () => {
  assert.equal(isUnassignedFile({ ...handed, deskStage: "RETURNED" }), false);
  assert.equal(isUnassignedFile({ ...handed, statusGroup: "CLOSED" }), false);
});

test("the count reads as a sentence, one or many", () => {
  assert.equal(unassignedText(0), "Every handed-over file has an officer");
  assert.equal(unassignedText(1), "1 file with no officer");
  assert.equal(unassignedText(4), "4 files with no officer");
});
