import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS,
  SIGNATURE_WINDOW_SECONDS,
  backoffSeconds,
  conflictSummary,
  isOutboundKind,
  nextAttemptAt,
  normalise,
  planFieldUpdates,
  shouldSend,
  worthRetrying,
} from "../src/lib/crm-link";
import { canonicalString, sign, verifySignature } from "../src/lib/crm-signing";

const older = "2026-09-01T10:00:00Z";
const newer = "2026-10-02T10:00:00Z";

// ---------- Which edit wins ----------

test("a newer message from the CRM is applied, and what it replaced is recorded", () => {
  const plan = planFieldUpdates({
    incoming: { firstName: "Meera", city: "Kochi" },
    current: { firstName: "Meera", city: "Thrissur" },
    theirUpdatedAt: newer,
    myUpdatedAt: older,
  });
  assert.deepEqual(plan.apply, { city: "Kochi" });
  assert.deepEqual(plan.changed, [{ field: "city", mine: "Thrissur", theirs: "Kochi" }]);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.stale, false);
});

test("an older message writes nothing and every field it would have changed is listed", () => {
  const plan = planFieldUpdates({
    incoming: { passportNumber: "Z1111111", city: "Kochi" },
    current: { passportNumber: "Z9999999", city: "Thrissur" },
    theirUpdatedAt: older,
    myUpdatedAt: newer,
  });
  assert.deepEqual(plan.apply, {});
  assert.deepEqual(plan.changed, []);
  assert.equal(plan.conflicts.length, 2);
  assert.equal(plan.stale, true);
  // Both values are kept, so a person can decide which is right.
  const passport = plan.conflicts.find((c) => c.field === "passportNumber")!;
  assert.equal(passport.mine, "Z9999999");
  assert.equal(passport.theirs, "Z1111111");
});

test("a blank the portal holds is filled whatever the dates say", () => {
  const plan = planFieldUpdates({
    incoming: { email: "meera@example.com" },
    current: { email: null },
    theirUpdatedAt: older,
    myUpdatedAt: newer,
  });
  assert.deepEqual(plan.apply, { email: "meera@example.com" });
  assert.deepEqual(plan.conflicts, []);
});

test("a blank from the CRM never clears what the portal holds", () => {
  for (const blank of [null, "", "   ", undefined]) {
    const plan = planFieldUpdates({ incoming: { email: blank }, current: { email: "kept@example.com" }, theirUpdatedAt: newer, myUpdatedAt: older });
    assert.deepEqual(plan.apply, {}, String(blank));
    assert.deepEqual(plan.changed, [], String(blank));
  }
});

test("the same value said differently is not a change", () => {
  const plan = planFieldUpdates({
    incoming: { dateOfBirth: "2004-03-11T00:00:00.000Z", backlogs: "3", city: " Kochi " },
    current: { dateOfBirth: new Date("2004-03-11"), backlogs: 3, city: "Kochi" },
    theirUpdatedAt: newer,
    myUpdatedAt: older,
  });
  assert.deepEqual(plan.apply, {});
  assert.deepEqual(plan.changed, []);
});

test("a field nobody agreed on is ignored and named, not written", () => {
  const plan = planFieldUpdates({
    incoming: { journeyStage: "VISA", commissionInr: 50000, firstName: "Meera" },
    current: { firstName: "Meera" },
    theirUpdatedAt: newer,
    myUpdatedAt: older,
  });
  assert.deepEqual(plan.apply, {});
  assert.deepEqual(plan.ignored.sort(), ["commissionInr", "journeyStage"]);
});

test("the envelope's own keys are not reported as ignored fields", () => {
  const plan = planFieldUpdates({
    incoming: { crmId: "CRM-1", updatedAt: newer, branch: "KOT", idempotencyKey: "x", medcityId: "MC-KOT-26-0001" },
    current: {},
    theirUpdatedAt: newer,
    myUpdatedAt: null,
  });
  assert.deepEqual(plan.ignored, []);
});

test("with no timestamp of ours, the CRM's message is applied", () => {
  const plan = planFieldUpdates({ incoming: { city: "Kochi" }, current: { city: "Thrissur" }, theirUpdatedAt: older, myUpdatedAt: null });
  assert.deepEqual(plan.apply, { city: "Kochi" });
  assert.equal(plan.stale, false);
});

test("a date field is compared by the day, not by the string", () => {
  assert.equal(normalise("dateOfBirth", "2004-03-11T18:30:00+05:30"), "2004-03-11");
  assert.equal(normalise("dateOfBirth", "not a date"), null);
  assert.equal(normalise("backlogs", "3.7"), 3);
  assert.equal(normalise("backlogs", "many"), null);
  assert.equal(normalise("city", "  Kochi "), "Kochi");
});

test("the conflict summary names the first few and counts the rest", () => {
  const four = ["city", "state", "pincode", "email"].map((f) => ({ field: f as "city", mine: "a", theirs: "b" }));
  assert.match(conflictSummary(four), /and 1 more/);
  assert.equal(conflictSummary([]), "");
});

// ---------- Signing ----------

test("what gets signed is the method, the path, the timestamp and the body, in that order", () => {
  assert.equal(canonicalString("post", "/api/crm/students", "1790000000", '{"a":1}'), 'POST\n/api/crm/students\n1790000000\n{"a":1}');
});

test("a signature made the documented way verifies", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  const body = '{"crmId":"CRM-1"}';
  const sig = sign("shhh", "POST", "/api/crm/students", ts, body);
  assert.deepEqual(verifySignature("shhh", sig, "POST", "/api/crm/students", ts, body, now), { ok: true });
});

test("a changed body, a wrong secret or a different path all fail", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  const sig = sign("shhh", "POST", "/api/crm/students", ts, '{"a":1}');
  assert.equal(verifySignature("shhh", sig, "POST", "/api/crm/students", ts, '{"a":2}', now).ok, false);
  assert.equal(verifySignature("wrong", sig, "POST", "/api/crm/students", ts, '{"a":1}', now).ok, false);
  assert.equal(verifySignature("shhh", sig, "POST", "/api/crm/enquiries", ts, '{"a":1}', now).ok, false);
  assert.equal(verifySignature("shhh", sig, "GET", "/api/crm/students", ts, '{"a":1}', now).ok, false);
});

test("a signature from outside the window is refused, so a copied one is no use", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const stale = String(Math.floor(now.getTime() / 1000) - SIGNATURE_WINDOW_SECONDS - 1);
  const sig = sign("shhh", "POST", "/p", stale, "{}");
  const check = verifySignature("shhh", sig, "POST", "/p", stale, "{}", now);
  assert.equal(check.ok, false);
  if (!check.ok) assert.match(check.why, /seconds out/);
});

test("a missing signature or timestamp says which one is missing", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const a = verifySignature("s", null, "POST", "/p", "1790000000", "{}", now);
  assert.equal(a.ok, false);
  if (!a.ok) assert.match(a.why, /signature/i);
  const b = verifySignature("s", "abc", "POST", "/p", null, "{}", now);
  assert.equal(b.ok, false);
  if (!b.ok) assert.match(b.why, /timestamp/i);
});

test("a signature is compared without caring about its case", () => {
  const now = new Date("2026-10-02T10:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  const sig = sign("shhh", "POST", "/p", ts, "{}");
  assert.equal(verifySignature("shhh", sig.toUpperCase(), "POST", "/p", ts, "{}", now).ok, true);
});

// ---------- Sending, and trying again ----------

test("only the four agreed kinds can be queued", () => {
  for (const k of ["student.stage", "application.status", "money.event", "document.decision"]) assert.equal(isOutboundKind(k), true, k);
  assert.equal(isOutboundKind("student.passport"), false);
  assert.equal(isOutboundKind(""), false);
});

test("a kind the desk has not ticked is not sent", () => {
  assert.equal(shouldSend("student.stage", ["student.stage", "money.event"]), true);
  assert.equal(shouldSend("document.decision", ["student.stage"]), false);
  assert.equal(shouldSend("student.stage", []), false);
});

test("the wait between attempts grows, and is capped", () => {
  assert.equal(backoffSeconds(1), 60);
  assert.equal(backoffSeconds(2), 240);
  assert.equal(backoffSeconds(3), 540);
  assert.ok(backoffSeconds(99) <= 6 * 60 * 60);
});

test("after the last attempt there is no next one", () => {
  const from = new Date("2026-10-02T10:00:00Z");
  assert.equal(nextAttemptAt(1, from)?.toISOString(), "2026-10-02T10:01:00.000Z");
  assert.equal(nextAttemptAt(MAX_ATTEMPTS, from), null);
  assert.equal(nextAttemptAt(MAX_ATTEMPTS + 1, from), null);
});

test("a refusal the CRM meant is not retried; a blip is", () => {
  assert.equal(worthRetrying(null), true);
  assert.equal(worthRetrying(500), true);
  assert.equal(worthRetrying(502), true);
  assert.equal(worthRetrying(429), true);
  assert.equal(worthRetrying(408), true);
  assert.equal(worthRetrying(400), false);
  assert.equal(worthRetrying(401), false);
  assert.equal(worthRetrying(422), false);
  assert.equal(worthRetrying(200), false);
});

test("a value the portal cannot use is named back, not dropped quietly", () => {
  const plan = planFieldUpdates({
    incoming: { dateOfBirth: "the eleventh of March", backlogs: "a few", preferredPathway: "MASTERS", city: "Kochi" },
    current: {},
    theirUpdatedAt: newer,
    myUpdatedAt: null,
  });
  assert.deepEqual(plan.apply, { city: "Kochi" });
  assert.deepEqual(plan.ignored.sort(), ["backlogs", "dateOfBirth", "preferredPathway"]);
});

test("a pathway is taken whatever case it arrives in, and only from the three", () => {
  assert.equal(normalise("preferredPathway", "ausbildung"), "AUSBILDUNG");
  assert.equal(normalise("preferredPathway", " Nursing "), "NURSING");
  assert.equal(normalise("preferredPathway", "PHD"), null);
});
