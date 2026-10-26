import { test } from "node:test";
import assert from "node:assert/strict";
import { convertedStudentOwner, type EnquiryOwner } from "../src/lib/conversion";

const branch = "org-kottayam";
const head = { id: "u-head", role: "PARTNER" };
const counsellorX: EnquiryOwner = { id: "u-x", role: "COUNSELLOR", orgId: branch, active: true };

test("a choice made on the form stands, whoever the enquiry was with", () => {
  assert.equal(convertedStudentOwner("u-chosen", head, branch, counsellorX), "u-chosen");
});

test("the branch head converting a counsellor's enquiry leaves the student with that counsellor", () => {
  assert.equal(convertedStudentOwner(null, head, branch, counsellorX), "u-x");
});

test("a counsellor converting a colleague's enquiry leaves the student with the colleague", () => {
  assert.equal(convertedStudentOwner(null, { id: "u-y", role: "COUNSELLOR" }, branch, counsellorX), "u-x");
});

test("without an enquiry, a counsellor keeps the student and anybody else leaves them unassigned", () => {
  assert.equal(convertedStudentOwner(null, { id: "u-y", role: "COUNSELLOR" }, branch, null), "u-y");
  assert.equal(convertedStudentOwner(null, head, branch, null), null);
  assert.equal(convertedStudentOwner(null, { id: "u-admin", role: "ADMIN" }, branch, null), null);
});

test("an enquiry owner who could not be chosen on the form does not count", () => {
  // Deactivated since.
  assert.equal(convertedStudentOwner(null, head, branch, { ...counsellorX, active: false }), null);
  // Moved to another branch.
  assert.equal(convertedStudentOwner(null, head, branch, { ...counsellorX, orgId: "org-kochi" }), null);
  // The head owned the enquiry themselves: a head is not a counsellor.
  assert.equal(convertedStudentOwner(null, head, branch, { id: "u-head", role: "PARTNER", orgId: branch, active: true }), null);
  // The rule then falls back to the registrar when they are a counsellor.
  assert.equal(convertedStudentOwner(null, { id: "u-y", role: "SENIOR_COUNSELLOR" }, branch, { ...counsellorX, active: false }), "u-y");
});
