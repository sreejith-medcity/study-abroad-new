import { test } from "node:test";
import assert from "node:assert/strict";
import { askDate, askSummary, buildAskMessage, reminderFor, type ReminderItem } from "../src/lib/ask";

const base = {
  firstName: "Arathi",
  branchName: "Medcity Kottayam",
  link: "https://doc.medcityoverseas.com/portal",
};

test("one message carries every outstanding document, with one link", () => {
  const body = buildAskMessage(
    { ...base, items: [{ label: "TB test certificate" }, { label: "Bank statement", reason: "The period it covers is too short" }] },
    "en",
  );
  assert.match(body, /Hello Arathi,/);
  assert.match(body, /- TB test certificate\n/);
  assert.match(body, /- Bank statement: The period it covers is too short/);
  assert.equal((body.match(/portal/g) ?? []).length, 1, "one link, not one per document");
});

test("the reason travels with the request, because a student cannot act on a bare refusal", () => {
  const body = buildAskMessage({ ...base, items: [{ label: "Bank statement", reason: "Six months ending within the last 28 days" }] }, "en");
  assert.match(body, /Six months ending within the last 28 days/);
});

test("a reminder says it is a reminder rather than repeating the first ask", () => {
  const first = buildAskMessage({ ...base, items: [{ label: "CV" }] }, "en");
  const again = buildAskMessage({ ...base, items: [{ label: "CV" }], reminder: true }, "en");
  assert.notEqual(first, again);
  assert.match(again, /reminder/i);
});

test("Malayalam is the whole message, not an English message with a Malayalam line", () => {
  const body = buildAskMessage({ ...base, items: [{ label: "പാസ്പോർട്ട്" }], dueOn: "2026-10-03" }, "ml");
  assert.match(body, /നമസ്കാരം Arathi,/);
  assert.match(body, /3 ഒക്ടോബർ 2026/);
  assert.doesNotMatch(body, /Hello|Please send/);
});

test("the date is written the same way a family would read it out", () => {
  assert.equal(askDate("2026-10-03", "en"), "3 October 2026");
  assert.equal(askDate("2026-10-03", "ml"), "3 ഒക്ടോബർ 2026");
  assert.equal(askDate("not a date", "en"), "");
});

test("no date given means no deadline is invented", () => {
  const body = buildAskMessage({ ...base, items: [{ label: "CV" }] }, "en");
  assert.doesNotMatch(body, /by /);
});

test("the summary reads as a person would say it", () => {
  assert.equal(askSummary([]), "Nothing outstanding");
  assert.equal(askSummary([{ label: "CV" }]), "CV");
  assert.equal(askSummary([{ label: "CV" }, { label: "SOP" }]), "CV and SOP");
  assert.equal(askSummary([{ label: "CV" }, { label: "SOP" }, { label: "LOR" }, { label: "Passport" }]), "CV, SOP and 2 more");
});

const day = 86_400_000;
const today = new Date("2026-09-30T09:00:00Z");
const item = (over: Partial<ReminderItem> = {}): ReminderItem => ({
  id: "x",
  state: "ASKED",
  askedAt: new Date(today.getTime() - 4 * day),
  decidedAt: null,
  lastChasedAt: null,
  escalatedAt: null,
  ...over,
});

test("silence for three days earns one nudge", () => {
  assert.equal(reminderFor(item({ askedAt: new Date(today.getTime() - 2 * day) }), today), "NOTHING");
  assert.equal(reminderFor(item(), today), "NUDGE");
});

test("a student chased yesterday is left alone today", () => {
  assert.equal(reminderFor(item({ lastChasedAt: new Date(today.getTime() - 1 * day) }), today), "NOTHING");
});

test("at a week it stops being the portal's job and becomes the counsellor's", () => {
  assert.equal(reminderFor(item({ askedAt: new Date(today.getTime() - 8 * day) }), today), "ESCALATE");
  assert.equal(reminderFor(item({ askedAt: new Date(today.getTime() - 8 * day), escalatedAt: today }), today), "NUDGE", "told once, then back to nudging");
});

test("a rejection is repeated sooner, because the student is waiting on our words", () => {
  assert.equal(reminderFor(item({ state: "REJECTED", askedAt: null, decidedAt: new Date(today.getTime() - 1 * day) }), today), "NOTHING");
  assert.equal(reminderFor(item({ state: "REJECTED", askedAt: null, decidedAt: new Date(today.getTime() - 3 * day) }), today), "NUDGE");
});

test("nothing is chased that nobody has asked for, or that is already in", () => {
  assert.equal(reminderFor(item({ state: "NOT_ASKED", askedAt: null }), today), "NOTHING");
  assert.equal(reminderFor(item({ state: "ACCEPTED" }), today), "NOTHING");
  assert.equal(reminderFor(item({ state: "IN_REVIEW" }), today), "NOTHING");
  assert.equal(reminderFor(item({ state: "NOT_NEEDED" }), today), "NOTHING");
});
