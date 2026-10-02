import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canWithdraw,
  conditionsFor,
  heldToEveryCondition,
  earningFrom,
  rateFor,
  rateText,
  withdrawableNow,
  withdrawalConditions,
  withdrawalSummary,
  type AgentRate,
  type WithdrawalFacts,
} from "../src/lib/agents";

const rate = (over: Partial<AgentRate> = {}): AgentRate => ({
  id: "r1",
  orgId: null,
  kind: "SHARE_OF_COMMISSION",
  percent: 10,
  flatAmountInr: null,
  activeFrom: "2026-01-01",
  ...over,
});

const facts = (over: Partial<WithdrawalFacts> = {}): WithdrawalFacts => ({
  balanceInr: 50_000,
  minimumInr: null,
  mouAccepted: true,
  mouPublished: true,
  hasBankDetails: true,
  pendingRequestInr: null,
  ...over,
});

// ---------- Rates ----------

test("a sub-agent's own rate beats the platform default, however old it is", () => {
  const rates = [
    rate({ id: "platform", orgId: null, percent: 10, activeFrom: "2026-06-01" }),
    rate({ id: "theirs", orgId: "o1", percent: 15, activeFrom: "2026-01-01" }),
  ];
  assert.equal(rateFor(rates, "o1", "2026-07-01")?.id, "theirs");
  // Another sub-agent falls back to the platform rate.
  assert.equal(rateFor(rates, "o2", "2026-07-01")?.id, "platform");
});

test("within one scope the newest rate that has started wins", () => {
  const rates = [
    rate({ id: "old", orgId: "o1", percent: 10, activeFrom: "2026-01-01" }),
    rate({ id: "new", orgId: "o1", percent: 12, activeFrom: "2026-06-01" }),
  ];
  assert.equal(rateFor(rates, "o1", "2026-05-31")?.id, "old");
  assert.equal(rateFor(rates, "o1", "2026-06-01")?.id, "new");
});

test("a rate dated in the future is not in force yet", () => {
  const rates = [rate({ orgId: "o1", activeFrom: "2027-01-01" })];
  assert.equal(rateFor(rates, "o1", "2026-10-02"), null);
});

test("no rate at all is null, never a guess", () => {
  assert.equal(rateFor([], "o1"), null);
  assert.equal(earningFrom(null, 100_000), null);
  assert.equal(rateText(null), "Not recorded");
});

test("a share is worked out from the commission, and rounded to the rupee", () => {
  assert.equal(earningFrom(rate({ percent: 10 }), 123_456), 12_346);
  assert.equal(earningFrom(rate({ percent: 7.5 }), 200_000), 15_000);
});

test("a share of a commission nobody has worked out stays null", () => {
  assert.equal(earningFrom(rate({ percent: 10 }), null), null);
});

test("a share with no percentage on it stays null rather than becoming nought", () => {
  assert.equal(earningFrom(rate({ percent: null }), 100_000), null);
  assert.match(rateText(rate({ percent: null })), /not recorded/i);
});

test("a flat fee ignores the commission, and says so when it is unset", () => {
  assert.equal(earningFrom(rate({ kind: "FLAT_PER_ENROLMENT", percent: null, flatAmountInr: 25_000 }), null), 25_000);
  assert.equal(earningFrom(rate({ kind: "FLAT_PER_ENROLMENT", percent: null, flatAmountInr: null }), 500_000), null);
  assert.match(rateText(rate({ kind: "FLAT_PER_ENROLMENT", percent: null, flatAmountInr: null })), /not recorded/i);
});

test("a rate reads as a sentence either way", () => {
  assert.match(rateText(rate({ percent: 10 })), /10% of what Medcity earns/);
  assert.match(rateText(rate({ kind: "FLAT_PER_ENROLMENT", percent: null, flatAmountInr: 25_000 })), /25,000 per enrolment/);
});

// ---------- Withdrawal ----------

test("all four conditions met means the money can be asked for", () => {
  assert.equal(canWithdraw(facts()), true);
  assert.equal(withdrawableNow(facts()), 50_000);
  assert.match(withdrawalSummary(facts()), /ready to withdraw/);
});

test("an unaccepted agreement stops it, and says to read it", () => {
  const f = facts({ mouAccepted: false });
  assert.equal(canWithdraw(f), false);
  const mou = withdrawalConditions(f).find((c) => c.key === "MOU")!;
  assert.equal(mou.met, false);
  assert.match(mou.fix, /accept it/i);
});

test("no agreement published cannot be the thing holding anybody up", () => {
  const f = facts({ mouPublished: false, mouAccepted: false });
  assert.equal(withdrawalConditions(f).find((c) => c.key === "MOU")!.met, true);
  assert.equal(canWithdraw(f), true);
});

test("no bank details stops it, and points at where to add them", () => {
  const f = facts({ hasBankDetails: false });
  assert.equal(canWithdraw(f), false);
  assert.match(withdrawalConditions(f).find((c) => c.key === "BANK")!.fix, /Settings/);
});

test("a minimum is measured against the balance, and says how far to go", () => {
  const under = facts({ minimumInr: 100_000, balanceInr: 60_000 });
  assert.equal(canWithdraw(under), false);
  assert.match(withdrawalConditions(under).find((c) => c.key === "MINIMUM")!.fix, /40,000 to go/);
  assert.equal(canWithdraw(facts({ minimumInr: 100_000, balanceInr: 100_000 })), true);
});

test("no minimum set is not a minimum of nought", () => {
  const f = facts({ minimumInr: null, balanceInr: 1 });
  const min = withdrawalConditions(f).find((c) => c.key === "MINIMUM")!;
  assert.equal(min.met, true);
  assert.match(min.what, /No minimum/);
});

test("an empty balance is the money-not-in condition, not the minimum", () => {
  const f = facts({ balanceInr: 0 });
  assert.equal(canWithdraw(f), false);
  const received = withdrawalConditions(f).find((c) => c.key === "RECEIVED")!;
  assert.equal(received.met, false);
  assert.match(received.fix, /once Medcity has been paid/);
  assert.equal(withdrawableNow(f), 0);
});

test("a request already with the desk blocks a second one", () => {
  const f = facts({ pendingRequestInr: 20_000 });
  assert.equal(canWithdraw(f), false);
  assert.match(withdrawalConditions(f).find((c) => c.key === "NOTHING_PENDING")!.fix, /20,000 is already waiting/);
});

test("every condition is returned whether met or not, so the whole list is shown", () => {
  const all = withdrawalConditions(facts({ mouAccepted: false, hasBankDetails: false, balanceInr: 0 }));
  assert.equal(all.length, 5);
  assert.equal(all.filter((c) => c.met).length, 2);
  // A met condition carries no instruction to act on.
  for (const c of all) assert.equal(c.met, c.fix === "");
});

test("the summary counts what is wrong rather than listing it twice", () => {
  assert.match(withdrawalSummary(facts({ mouAccepted: false, hasBankDetails: false })), /2 things to sort out/);
  assert.match(withdrawalSummary(facts({ hasBankDetails: false })), /Settings/);
});

test("a branch is held only to the condition that was always there", () => {
  const f = facts({ mouAccepted: false, hasBankDetails: false, minimumInr: 100_000, balanceInr: 5_000 });
  const branch = conditionsFor(f, "BRANCH");
  assert.deepEqual(branch.map((c) => c.key), ["NOTHING_PENDING"]);
  assert.equal(branch.every((c) => c.met), true);
  // The same facts stop a sub-agent, which is what the conditions are for.
  assert.equal(conditionsFor(f, "SUB_AGENT").filter((c) => !c.met).length, 3);
});

test("the head office is not a sub-agent either", () => {
  for (const type of ["HQ", "BRANCH"]) assert.equal(heldToEveryCondition(type), false);
  assert.equal(heldToEveryCondition("SUB_AGENT"), true);
});

test("the summary follows whichever list the organisation is held to", () => {
  const f = facts({ mouAccepted: false, hasBankDetails: false });
  assert.match(withdrawalSummary(f, "SUB_AGENT"), /2 things to sort out/);
  assert.match(withdrawalSummary(f, "BRANCH"), /ready to withdraw/);
});
