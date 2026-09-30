import { test } from "node:test";
import assert from "node:assert/strict";
import { bestRoute, routeCommission, routeTerms, termsAge, tidyCode, isColour, type RouteLike } from "../src/lib/vendors";

const route = (over: Partial<RouteLike> = {}): RouteLike => ({
  basis: "PERCENT_TUITION",
  percentOfTuition: 10,
  flatAmount: null,
  currency: null,
  payableOn: null,
  daysToPay: null,
  applicationFee: null,
  offerTatDays: null,
  active: true,
  ...over,
});
const program = { tuitionPerYear: 23400, tuitionTotal: null, applicationFee: 0, offerTatDays: 5, currency: "GBP" };

test("a percentage is of the first year, in the tuition's own currency", () => {
  const c = routeCommission(route({ percentOfTuition: 9 }), program);
  assert.deepEqual(c, { known: true, amount: 2106, currency: "GBP", basis: "9% of the first year" });
});

test("a percentage is never applied to a whole-course fee", () => {
  const c = routeCommission(route(), { ...program, tuitionPerYear: null, tuitionTotal: 46800 });
  assert.equal(c.known, false);
  assert.match((c as { reason: string }).reason, /whole-course/);
});

test("a flat fee stands in its own currency, and an unrecorded one is not a zero", () => {
  assert.deepEqual(routeCommission(route({ basis: "FLAT", flatAmount: 1500, currency: "EUR" }), program), { known: true, amount: 1500, currency: "EUR", basis: "Flat fee" });
  assert.equal(routeCommission(route({ basis: "FLAT", flatAmount: null }), program).known, false);
  assert.equal(routeCommission(route({ percentOfTuition: null }), program).known, false);
});

test("terms fall back to the vendor's", () => {
  const vendor = { payableOn: "ENROLMENT_CONFIRMED" as const, daysToPay: 60 };
  assert.deepEqual(routeTerms(route(), vendor), { payableOn: "ENROLMENT_CONFIRMED", daysToPay: 60 });
  assert.deepEqual(routeTerms(route({ payableOn: "VISA_APPROVED", daysToPay: 45 }), vendor), { payableOn: "VISA_APPROVED", daysToPay: 45 });
});

test("the best route is the one that pays most in rupees, and an unknown never wins", () => {
  const rates = { GBP: 110, EUR: 95 };
  const rows = [
    { key: "kc", route: route(), commission: routeCommission(route({ percentOfTuition: 9 }), program) },
    { key: "md", route: route(), commission: routeCommission(route({ percentOfTuition: 12 }), program) },
    { key: "so", route: route(), commission: routeCommission(route({ percentOfTuition: null }), program) },
  ];
  assert.equal(bestRoute(rows, rates)!.key, "md");
  const noneKnown = [rows[2]];
  assert.equal(bestRoute(noneKnown, rates)!.key, "so");
  const paused = rows.map((r) => ({ ...r, route: route({ active: false }) }));
  assert.equal(bestRoute(paused, rates), null);
});

test("a route in a currency with no rate cannot win on a guess", () => {
  const rows = [
    { key: "gbp", route: route(), commission: routeCommission(route({ percentOfTuition: 9 }), program) },
    { key: "zzz", route: route(), commission: routeCommission(route({ basis: "FLAT", flatAmount: 99999, currency: "ZZZ" }), program) },
  ];
  assert.equal(bestRoute(rows, { GBP: 110 })!.key, "gbp");
});

test("terms go stale after six months, and never confirmed counts as stale", () => {
  const today = new Date(2026, 8, 30);
  assert.equal(termsAge(null, today).stale, true);
  assert.equal(termsAge(new Date(2026, 8, 1), today).stale, false);
  assert.equal(termsAge(new Date(2025, 8, 1), today).stale, true);
  assert.equal(termsAge(new Date(2026, 8, 30), today).text, "Terms confirmed today");
});

test("codes are letters only, and colours come from the list", () => {
  assert.equal(tidyCode(" kc-1 "), "KC");
  assert.equal(tidyCode("studentops"), "STUD");
  assert.equal(isColour("#4338CA"), true);
  assert.equal(isColour("#123456"), false);
});
