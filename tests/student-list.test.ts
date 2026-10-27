import { test } from "node:test";
import assert from "node:assert/strict";
import { countryCell, programmesSummary, shortUniversity } from "../src/lib/student-list";

test("a university's short name drops a leading The and a bracketed note", () => {
  assert.equal(shortUniversity("NHS Trust recruitment partner (sample)"), "NHS Trust recruitment partner");
  assert.equal(shortUniversity("The University of Westbridge"), "University of Westbridge");
  assert.equal(shortUniversity("Northgate University"), "Northgate University");
  // Only a bracket at the end goes, and a name that is only a bracket stays.
  assert.equal(shortUniversity("Institute (North) of Art"), "Institute (North) of Art");
  assert.equal(shortUniversity("(sample)"), "(sample)");
});

test("one or two programmes are named and the rest counted", () => {
  const apps = [
    { programme: "MSc Nursing", university: "Northgate University" },
    { programme: "BSc Computing", university: "The Harbour City University" },
  ];
  assert.deepEqual(programmesSummary(apps, 2), { shown: ["MSc Nursing (Northgate University)", "BSc Computing (Harbour City University)"], more: 0, moreLabel: null });
  assert.deepEqual(programmesSummary(apps, 5), { shown: ["MSc Nursing (Northgate University)", "BSc Computing (Harbour City University)"], more: 3, moreLabel: "+3 more" });
  assert.deepEqual(programmesSummary(apps, 3, 1), { shown: ["MSc Nursing (Northgate University)"], more: 2, moreLabel: "+2 more" });
});

test("no applications is nothing to show and nothing more", () => {
  assert.deepEqual(programmesSummary([], 0), { shown: [], more: 0, moreLabel: null });
});

test("applied countries win over the preference, once each", () => {
  assert.deepEqual(countryCell(["Germany", "germany", "Ireland", null], "United Kingdom"), { names: ["Germany", "Ireland"], preference: false });
});

test("the preferred country is shown as a preference when nothing has been applied for", () => {
  assert.deepEqual(countryCell([], "United Kingdom"), { names: ["United Kingdom"], preference: true });
  assert.deepEqual(countryCell([null, " "], "  "), { names: [], preference: false });
  assert.deepEqual(countryCell([], null), { names: [], preference: false });
});
