import { test } from "node:test";
import assert from "node:assert/strict";
import { durationText, feeText, intakesText } from "../src/lib/catalogue";
import { fmtMoney } from "../src/lib/format";

test("an unverified fee never reads as free", () => {
  assert.equal(feeText(null, "GBP", { zero: "No application fee" }), "Not recorded");
  assert.equal(feeText(undefined, "GBP", { zero: "No application fee", unknown: "Fee to confirm" }), "Fee to confirm");
  assert.equal(feeText(0, "GBP", { zero: "No application fee" }), "No application fee");
  assert.equal(feeText(75, "GBP", { zero: "No application fee" }), fmtMoney(75, "GBP"));
});

test("intakes and duration say when nothing is recorded", () => {
  assert.equal(intakesText([]), "Not recorded");
  assert.equal(intakesText([1, 9]), "Jan, Sep");
  assert.equal(durationText(null), "Not recorded");
  assert.equal(durationText(12), "1 year");
  assert.equal(durationText(24), "2 years");
  assert.equal(durationText(16), "16 months");
});

test("rupee figures are rough, marked, and only with a rate", async () => {
  const { inrApprox } = await import("../src/lib/catalogue");
  const rates = { GBP: 112, AUD: 58 };
  assert.equal(inrApprox(19355, "GBP", rates), "≈ ₹21.7 lakh");
  assert.equal(inrApprox(193792, "AUD", rates), "≈ ₹1.1 crore");
  assert.equal(inrApprox(500, "GBP", rates), "≈ ₹56,000");
  assert.equal(inrApprox(19355, "NZD", rates), null);
  assert.equal(inrApprox(null, "GBP", rates), null);
  assert.equal(inrApprox(0, "GBP", rates), null);
});
