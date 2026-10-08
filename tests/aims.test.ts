import { strict as assert } from "node:assert";
import test from "node:test";
import { AIMS, aimLabel, aimOf, readAim } from "../src/lib/aims";

test("one question on the form, two columns behind it", () => {
  assert.deepEqual(readAim("DEGREE:PG"), { pathway: "DEGREE", level: "PG" });
  assert.deepEqual(readAim("DEGREE:TOP_UP"), { pathway: "DEGREE", level: "TOP_UP" });
  assert.deepEqual(readAim("NURSING"), { pathway: "NURSING", level: null });
  assert.deepEqual(readAim(""), { pathway: null, level: null }, "not decided stays undecided");
  assert.deepEqual(readAim("NONSENSE"), { pathway: null, level: null }, "and so does anything unrecognised");
});

test("the four levels asked for are all offered", () => {
  for (const want of ["Master's", "PhD", "Diploma"]) {
    assert.ok(AIMS.some((a) => a.label === want), `${want} is on the list`);
  }
  assert.ok(AIMS.some((a) => a.level === "TOP_UP"), "and the top-up degree");
});

test("a student already on file comes back to the right choice", () => {
  assert.equal(aimOf("DEGREE", "PG"), "DEGREE:PG");
  assert.equal(aimOf("DEGREE", null), "DEGREE", "recorded before the levels existed");
  assert.equal(aimOf("DEGREE", "SCHOOL"), "DEGREE", "a level this list does not offer keeps the journey");
  assert.equal(aimOf(null, null), "", "nothing recorded, nothing chosen");
  assert.equal(aimLabel("DEGREE", "PHD"), "PhD");
});
