import { strict as assert } from "node:assert";
import test from "node:test";
import { amountsFor, fxToInr, rate } from "../src/lib/money";


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
