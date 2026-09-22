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
