import { test } from "node:test";
import assert from "node:assert/strict";
import { autoKeys, byNewest, SUGGESTED_FOLLOW_UP, suggestedFollowUp, whenDue, WHEN_ORDER, type TimelineEntry } from "../src/lib/crm";

const today = new Date("2026-10-01T09:00:00Z");
const day = 86_400_000;
const on = (offset: number) => new Date(today.getTime() + offset * day).toISOString().slice(0, 10);

test("a task falls under the heading somebody would look for it under", () => {
  assert.equal(whenDue(on(-5), today), "OVERDUE");
  assert.equal(whenDue(on(0), today), "TODAY");
  assert.equal(whenDue(on(1), today), "TOMORROW");
  assert.equal(whenDue(on(6), today), "THIS_WEEK");
  assert.equal(whenDue(on(7), today), "THIS_WEEK");
  assert.equal(whenDue(on(8), today), "LATER");
});

test("the time of day cannot move a task between headings", () => {
  const lateToday = new Date("2026-10-01T23:30:00Z");
  assert.equal(whenDue(on(0), lateToday), "TODAY");
  const earlyToday = new Date("2026-10-01T00:01:00Z");
  assert.equal(whenDue(on(0), earlyToday), "TODAY");
});

test("overdue work is read before anything else", () => {
  assert.equal(WHEN_ORDER[0], "OVERDUE");
  assert.equal(WHEN_ORDER[1], "TODAY");
});

test("what came of a call decides when to look again", () => {
  assert.equal(suggestedFollowUp("NO_ANSWER", today), on(1), "nobody answered, so try tomorrow");
  assert.equal(suggestedFollowUp("WILL_SEND", today), on(3));
  assert.equal(suggestedFollowUp("WANTS_TIME", today), on(14), "a family that wants time is not helped by a call on Monday");
  assert.equal(suggestedFollowUp("WRONG_NUMBER", today), null, "there is nothing to follow up on a wrong number");
});

test("every outcome either suggests a day or openly suggests none", () => {
  for (const [outcome, days] of Object.entries(SUGGESTED_FOLLOW_UP)) {
    assert.ok(days === null || (Number.isInteger(days) && days > 0), `${outcome} is ${days}`);
  }
});

test("one fact has one key, so the portal never puts it on a desk twice", () => {
  assert.equal(autoKeys.documentSilent("i1"), "document-silent:i1");
  assert.equal(autoKeys.gateClear("s1", "VISA"), "gate-clear:s1:VISA");
  assert.notEqual(autoKeys.gateClear("s1", "VISA"), autoKeys.gateClear("s1", "OFFER"), "a different stage is a different fact");
  // A vendor that goes quiet again after answering is a new fact, not the old one.
  assert.notEqual(autoKeys.vendorQuiet("a1", "2026-09-01"), autoKeys.vendorQuiet("a1", "2026-09-20"));
});

test("the feed reads newest first, and two things in the same second keep a stable order", () => {
  const at = new Date("2026-09-30T10:00:00Z");
  const entries: TimelineEntry[] = [
    { id: "b", at, kind: "STATUS", title: "status" },
    { id: "a", at, kind: "CONTACT", title: "call" },
    { id: "c", at: new Date("2026-10-01T10:00:00Z"), kind: "TASK", title: "task" },
  ];
  const sorted = [...entries].sort(byNewest);
  assert.deepEqual(sorted.map((e) => e.id), ["c", "a", "b"]);
  assert.deepEqual([...entries].sort(byNewest).map((e) => e.id), sorted.map((e) => e.id), "sorting twice gives the same order");
});
