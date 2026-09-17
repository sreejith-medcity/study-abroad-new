import { test } from "node:test";
import assert from "node:assert/strict";
import { financialYear, intakeLabel } from "../src/lib/format";
import { maskPassport } from "../src/lib/permissions";

test("Indian financial year rolls over in April", () => {
  assert.equal(financialYear(new Date(2026, 2, 31)), "25-26");
  assert.equal(financialYear(new Date(2026, 3, 1)), "26-27");
});

test("intake label", () => {
  assert.equal(intakeLabel(1, 2027), "Jan-2027");
});

test("passport masking keeps first and last characters only", () => {
  assert.equal(maskPassport("Z1234567"), "Z•••••67");
  assert.equal(maskPassport(null), "");
});
