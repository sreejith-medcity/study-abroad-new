import { test } from "node:test";
import assert from "node:assert/strict";
import { studentIdFromHref } from "../src/lib/notification-links";

test("a link to a student's profile names that student", () => {
  assert.equal(studentIdFromHref("/students/mvjgxvgiPU2KhSnEENFB/profile"), "mvjgxvgiPU2KhSnEENFB");
});

test("every tab of the file and a link with a query string name the student too", () => {
  assert.equal(studentIdFromHref("/students/abc_12-XY/applications?app=a1"), "abc_12-XY");
  assert.equal(studentIdFromHref("/students/abc/documentation?view=student"), "abc");
  assert.equal(studentIdFromHref("/students/abc/documentation/ask"), "abc");
  assert.equal(studentIdFromHref("/students/abc"), "abc");
  assert.equal(studentIdFromHref("/students/abc?x=1"), "abc");
  assert.equal(studentIdFromHref("/students/abc#top"), "abc");
});

test("the register form and the board are not students", () => {
  assert.equal(studentIdFromHref("/students/new"), null);
  assert.equal(studentIdFromHref("/students/new?enquiryId=e1"), null);
  assert.equal(studentIdFromHref("/students/board"), null);
});

test("anything that is not a single student's page gives nothing back", () => {
  assert.equal(studentIdFromHref(null), null);
  assert.equal(studentIdFromHref(undefined), null);
  assert.equal(studentIdFromHref(""), null);
  assert.equal(studentIdFromHref("/students"), null);
  assert.equal(studentIdFromHref("/students/"), null);
  assert.equal(studentIdFromHref("/referrals"), null);
  assert.equal(studentIdFromHref("/applications/abc"), null);
  assert.equal(studentIdFromHref("https://example.com/students/abc/profile"), null);
  assert.equal(studentIdFromHref("/students/a.b/profile"), null);
});
