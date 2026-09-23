import { test } from "node:test";
import assert from "node:assert/strict";
import { phoneKey } from "../src/lib/phone";

test("phoneKey takes the last ten digits, however the number is written", () => {
  assert.equal(phoneKey("+91 98470 12345"), "9847012345");
  assert.equal(phoneKey("09847012345"), "9847012345");
  assert.equal(phoneKey("+91-98470-12345"), "9847012345");
  assert.equal(phoneKey("9847012345"), "9847012345");
});

test("phoneKey gives nothing when there are not ten digits", () => {
  assert.equal(phoneKey("98470"), null);
  assert.equal(phoneKey(""), null);
  assert.equal(phoneKey(null), null);
  assert.equal(phoneKey(undefined), null);
});

test("two different numbers never share a key", () => {
  assert.notEqual(phoneKey("+91 98470 12345"), phoneKey("+91 98470 12346"));
});
