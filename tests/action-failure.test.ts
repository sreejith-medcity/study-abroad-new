import { test } from "node:test";
import assert from "node:assert/strict";
import { actionFailure, isNavigation } from "../src/lib/action-failure";

const withDigest = (digest: string) => Object.assign(new Error("thrown"), { digest });

test("a redirect goes straight back up, because it is how navigation works", () => {
  const e = withDigest("NEXT_REDIRECT;replace;/students;307;");
  assert.equal(isNavigation(e), true);
  assert.throws(() => actionFailure(e, "The upload"), (thrown) => thrown === e);
});

test("a not-found becomes something the person can act on, not a dead screen", () => {
  const r = actionFailure(withDigest("NEXT_HTTP_ERROR_FALLBACK;404"), "The upload", { studentId: "abc" });
  assert.match(r.error ?? "", /not open to you any more/);
  assert.equal(r.ok, undefined);
});

test("an ordinary failure is answered rather than thrown", () => {
  const r = actionFailure(new Error("EACCES: permission denied"), "The upload", { studentId: "abc" });
  assert.match(r.error ?? "", /did not go through and nothing was saved/);
  assert.match(r.error ?? "", /^The upload/);
});

test("a thrown string or null does not itself break the handler", () => {
  assert.match(actionFailure("boom", "The upload").error ?? "", /did not go through/);
  assert.match(actionFailure(null, "The upload").error ?? "", /did not go through/);
  assert.equal(isNavigation(null), false);
  assert.equal(isNavigation({ digest: 404 }), false);
});

test("the message names what was being done, so two actions do not read alike", () => {
  assert.match(actionFailure(new Error("x"), "The upload").error ?? "", /^The upload /);
  assert.match(actionFailure(new Error("x"), "Saving the contact").error ?? "", /^Saving the contact /);
});
