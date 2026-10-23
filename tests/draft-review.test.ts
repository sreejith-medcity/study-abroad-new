import { test } from "node:test";
import assert from "node:assert/strict";
import { firstLines, outcomeText, publishProblems, readReviewFilters, reviewQuery, share, type ReviewOutcome } from "../src/lib/draft-review";

const ready = { intakeMonths: [9], workRights: "UNKNOWN", workRightsNote: null };

test("a draft with an intake and no work rights verdict is ready", () => {
  assert.deepEqual(publishProblems(ready), []);
});

test("a draft with no intake cannot go live, as on the edit screen", () => {
  assert.deepEqual(publishProblems({ ...ready, intakeMonths: [] }), ["intakes"]);
  assert.deepEqual(publishProblems({ ...ready, intakeMonths: null }), ["intakes"]);
});

test("a work rights verdict needs its evidence, and blank evidence is none", () => {
  assert.deepEqual(publishProblems({ ...ready, workRights: "ELIGIBLE", workRightsNote: null }), ["evidence"]);
  assert.deepEqual(publishProblems({ ...ready, workRights: "INELIGIBLE", workRightsNote: "  \n " }), ["evidence"]);
  assert.deepEqual(publishProblems({ ...ready, workRights: "ELIGIBLE", workRightsNote: "Graduate Route, gov.uk" }), []);
  // "Not confirmed" claims nothing, so it needs no evidence.
  assert.deepEqual(publishProblems({ ...ready, workRights: "UNKNOWN", workRightsNote: "" }), []);
});

test("both problems are reported together", () => {
  assert.deepEqual(publishProblems({ intakeMonths: [], workRights: "ELIGIBLE", workRightsNote: "" }), ["intakes", "evidence"]);
});

const base: ReviewOutcome = { op: "publish", done: 0, left: 0, noIntakes: 0, noEvidence: 0, gone: 0 };

test("a clean publish just says how many", () => {
  assert.equal(outcomeText({ ...base, done: 38 }), "Published 38.");
});

test("drafts left for one reason say that reason", () => {
  assert.equal(
    outcomeText({ ...base, done: 38, left: 4, noIntakes: 4 }),
    "Published 38. 4 left as drafts because they have no intakes. Open each one to add what is missing.",
  );
  assert.equal(outcomeText({ ...base, done: 2, left: 1, noIntakes: 1 }), "Published 2. 1 left as a draft because it has no intakes. Open it to add what is missing.");
  assert.equal(
    outcomeText({ ...base, done: 1, left: 1, noEvidence: 1 }),
    "Published 1. 1 left as a draft because it has a post-study work answer with no evidence behind it. Open it to add what is missing.",
  );
});

test("drafts left for different reasons list each with its count", () => {
  assert.equal(
    outcomeText({ ...base, done: 5, left: 3, noIntakes: 2, noEvidence: 1 }),
    "Published 5. 3 left as drafts: 2 have no intakes, 1 has a post-study work answer with no evidence behind it. Open each one to add what is missing.",
  );
  // One course can break both rules, so the reasons can add up to more than the drafts left.
  assert.match(outcomeText({ ...base, left: 2, noIntakes: 2, noEvidence: 1 }), /^Nothing published\. 2 left as drafts: 2 have no intakes, 1 has/);
});

test("courses that were no longer drafts are counted, not passed over", () => {
  assert.equal(outcomeText({ ...base, done: 3, gone: 1 }), "Published 3. 1 was no longer a draft, so it was left as it was.");
  assert.equal(outcomeText({ ...base, op: "archive", done: 2, gone: 2 }), "Archived 2. 2 were no longer drafts, so they were left as they were.");
  assert.equal(outcomeText({ ...base, op: "archive" }), "Nothing archived.");
});

test("no text the desk reads uses a long dash", () => {
  const all = [
    outcomeText({ ...base, done: 5, left: 3, noIntakes: 2, noEvidence: 1, gone: 1 }),
    outcomeText({ ...base, op: "archive", done: 1, gone: 1 }),
  ].join(" ");
  assert.equal(/\u2014|\u2013/.test(all), false);
});

test("filters read from the address keep only what the screen understands", () => {
  assert.deepEqual(readReviewFilters({}), { q: undefined, country: undefined, source: undefined, sort: "drafts", page: 1 });
  assert.deepEqual(readReviewFilters({ q: "  Aston ", country: "gb", source: "MIOC", sort: "name", page: "3" }), { q: "Aston", country: "GB", source: "MIOC", sort: "name", page: 3 });
  const odd = readReviewFilters({ country: "Britain", source: "catalogue", sort: "size", page: "-2" });
  assert.equal(odd.country, undefined);
  assert.equal(odd.source, undefined);
  assert.equal(odd.sort, "drafts");
  assert.equal(odd.page, 1);
  assert.equal(readReviewFilters({ page: "abc" }).page, 1);
  assert.equal(readReviewFilters({ source: ["CRICOS", "MIOC"] }).source, "CRICOS");
});

test("the query string carries the filters and leaves out the defaults", () => {
  assert.equal(reviewQuery({ sort: "drafts", page: 1 }), "");
  assert.equal(reviewQuery({ country: "AU", source: "CRICOS", sort: "name" }), "?country=AU&source=CRICOS&sort=name");
  assert.equal(reviewQuery({ q: "King's College" }, { page: 2 }), "?q=King%27s+College&page=2");
  assert.equal(reviewQuery({}, { page: 1 }), "");
});

test("entry notes are cut to their first lines", () => {
  assert.equal(firstLines(null), "");
  assert.equal(firstLines("Bachelor's in a related subject\n\n  IELTS 6.5 overall\nInterview may be required"), "Bachelor's in a related subject IELTS 6.5 overall");
  const long = firstLines("x".repeat(400));
  assert.equal(long.length, 160);
  assert.ok(long.endsWith("…"));
});

test("a share of nothing is nothing, not a division by zero", () => {
  assert.equal(share(0, 0), 0);
  assert.equal(share(1, 3), 33);
  assert.equal(share(40, 40), 100);
});
