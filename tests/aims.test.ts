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
  // DEGREE reads "Study abroad" (the department's name), with the level after it.
  for (const want of ["Master's", "PhD", "diploma"]) {
    assert.ok(AIMS.some((a) => a.pathway === "DEGREE" && a.label === `Study abroad: ${want}`), `${want} is on the list`);
  }
  assert.ok(AIMS.some((a) => a.level === "TOP_UP"), "and the top-up degree");
});

test("a student already on file comes back to the right choice", () => {
  assert.equal(aimOf("DEGREE", "PG"), "DEGREE:PG");
  assert.equal(aimOf("DEGREE", null), "DEGREE", "recorded before the levels existed");
  assert.equal(aimOf("DEGREE", "SCHOOL"), "DEGREE", "a level this list does not offer keeps the journey");
  assert.equal(aimOf(null, null), "", "nothing recorded, nothing chosen");
  assert.equal(aimLabel("DEGREE", "PHD"), "Study abroad: PhD");
  assert.equal(aimLabel("DEGREE", null), "Study abroad (level not decided)", "the student file says Study abroad, not degree");
  assert.equal(aimLabel("AU_PAIR", null), "Au pair (a year with a host family abroad)");
});
