import { test } from "node:test";
import assert from "node:assert/strict";
import { splitName } from "../src/lib/import-values";

test("split columns are used as they are", () => {
  assert.deepEqual(splitName(undefined, "Anjali", "Menon"), { first: "Anjali", last: "Menon" });
  assert.deepEqual(splitName("Ignored Name", "Anjali", "Menon"), { first: "Anjali", last: "Menon" });
});

test("a whole name in one column is split at the last space", () => {
  assert.deepEqual(splitName("Anjali Menon", undefined, undefined), { first: "Anjali", last: "Menon" });
  assert.deepEqual(splitName("Anjali Maria Menon", "", ""), { first: "Anjali Maria", last: "Menon" });
  assert.deepEqual(splitName(undefined, "Arathi Krishnan", ""), { first: "Arathi", last: "Krishnan" });
});

test("a single name gives no surname rather than an invented one", () => {
  assert.deepEqual(splitName("Anjali", "", ""), { first: "Anjali", last: "" });
  assert.deepEqual(splitName("", "", ""), { first: "", last: "" });
});

test("extra spaces are tidied, never the name itself", () => {
  assert.deepEqual(splitName("  Anjali   Maria  Menon ", "", ""), { first: "Anjali Maria", last: "Menon" });
  assert.deepEqual(splitName(undefined, "  Anjali ", " Menon "), { first: "Anjali", last: "Menon" });
});
