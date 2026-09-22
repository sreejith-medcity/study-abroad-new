import { strict as assert } from "node:assert";
import test from "node:test";
import { amountsFor, fxToInr, partnerEstimate, pickRule, rate } from "../src/lib/money";


test("a percentage rule takes its cut of first year tuition", () => {
  const rule = { basis: "PERCENT_TUITION", percentOfTuition: 15, flatAmount: null, partnerSharePercent: 50 };
  const { gross, partner } = amountsFor(rule, 19450);
  assert.equal(gross, 2918);
  assert.equal(partner, 1459);
});

test("a flat rule ignores tuition", () => {
  const rule = { basis: "FLAT", percentOfTuition: null, flatAmount: 150000, partnerSharePercent: 40 };
  assert.deepEqual(amountsFor(rule, 99999), { gross: 150000, partner: 60000 });
  assert.deepEqual(amountsFor(rule, null), { gross: 150000, partner: 60000 });
});

test("a percentage rule with no tuition earns nothing, so no commission is created", () => {
  const rule = { basis: "PERCENT_TUITION", percentOfTuition: 15, flatAmount: null, partnerSharePercent: 50 };
  assert.deepEqual(amountsFor(rule, null), { gross: 0, partner: 0 });
});

test("the partner share is rounded to whole units", () => {
  const rule = { basis: "PERCENT_TUITION", percentOfTuition: 12.5, flatAmount: null, partnerSharePercent: 33 };
  const { gross, partner } = amountsFor(rule, 10001);
  assert.ok(Number.isInteger(gross) && Number.isInteger(partner));
  assert.equal(gross, 1250);
  assert.equal(partner, 413);
});

test("rupees convert with the configured rate and default to one for rupees", () => {
  assert.equal(fxToInr("INR"), 1);
  assert.ok(fxToInr("GBP") > 1);
  assert.equal(fxToInr("ZZZ"), 1);
  process.env.COMMISSION_FX = "GBP:120";
  assert.equal(fxToInr("GBP"), 120);
  delete process.env.COMMISSION_FX;
});

test("rates never divide by zero", () => {
  assert.equal(rate(0, 0), 0);
  assert.equal(rate(3, 0), 0);
  assert.equal(rate(1, 3), 33);
  assert.equal(rate(2, 4), 50);
});

test("the rule shown on a program: most specific first, past-year rules ignored", () => {
  const base = { basis: "PERCENT_TUITION", percentOfTuition: 10, flatAmount: null, partnerSharePercent: 50, currency: "INR", programId: null, universityId: null, countryId: null, intakeYear: null };
  const rules = [
    { ...base, id: "country", countryId: "GB" },
    { ...base, id: "uni", universityId: "hull" },
    { ...base, id: "old", programId: "msc", intakeYear: 2020 },
  ];
  assert.equal(pickRule(rules, "msc", "hull", "GB", 2027)?.id, "uni");
  assert.equal(pickRule(rules, "other", "york", "GB", 2027)?.id, "country");
  assert.equal(pickRule(rules, "other", "york", "CA", 2027), null);
  assert.deepEqual(partnerEstimate(rules[1], 18000, "GBP"), { amount: 900, currency: "GBP", terms: "50% of 10% of first-year tuition" });
  assert.equal(partnerEstimate(rules[1], null, "GBP").amount, null, "no yearly tuition, no figure");
  assert.equal(partnerEstimate({ ...base, id: "f", basis: "FLAT", flatAmount: 100000 }, null, "GBP").amount, 50000);
});

import { GSTIN_RE, IFSC_RE, PAN_RE, gstinMatchesPan, lutState, maskAccount } from "../src/lib/billing";

test("billing identifiers: PAN, GSTIN with its PAN, IFSC, masking and LUT dates", () => {
  assert.ok(PAN_RE.test("ABCDE1234F"));
  assert.ok(!PAN_RE.test("ABCD1234F"));
  assert.ok(GSTIN_RE.test("32ABCDE1234F1Z5"));
  assert.ok(gstinMatchesPan("32ABCDE1234F1Z5", "ABCDE1234F"));
  assert.ok(!gstinMatchesPan("32ABCDE1234F1Z5", "ABCDE9999F"));
  assert.ok(IFSC_RE.test("SBIN0001234"));
  assert.ok(!IFSC_RE.test("SBIN1001234"));
  assert.equal(maskAccount("123456789012"), "•••• 9012");
  assert.equal(lutState(null), "none");
  assert.equal(lutState("2027-03-31", new Date("2026-09-22")), "valid");
  assert.equal(lutState("2026-03-31", new Date("2026-09-22")), "expired");
});

import { daysLeft, promotionState } from "../src/lib/promotions";

test("promotions: state and days left by the IST calendar day", () => {
  // 20:00 UTC on 21 Sep is already 22 Sep in India.
  const now = new Date("2026-09-21T20:00:00Z");
  assert.equal(promotionState("2026-09-22", "2026-09-30", now), "running");
  assert.equal(promotionState("2026-09-23", "2026-09-30", now), "upcoming");
  assert.equal(promotionState("2026-09-01", "2026-09-21", now), "ended");
  assert.equal(daysLeft("2026-09-22", now), 1);
  assert.equal(daysLeft("2026-09-30", now), 9);
});
