import { test } from "node:test";
import assert from "node:assert/strict";
import {
  duplicateText,
  feeInWords,
  feeOutlier,
  FLAG_LABEL,
  flagText,
  looksDuplicate,
  nameKey,
  oddDuration,
  oddScore,
  readShow,
  REVIEW_FLAGS,
  reviewFlags,
  SHORT_UG_COUNTRIES,
  SHOW_LABEL,
} from "../src/lib/review-flags";
import { outcomeText } from "../src/lib/draft-review";

test("names compare without case, punctuation or the spelling of and", () => {
  assert.equal(nameKey("MSc Accounting & Finance"), nameKey("msc accounting and finance"));
  assert.equal(nameKey("B.Sc. (Hons) Nursing"), "bschonsnursing");
  assert.notEqual(nameKey("MSc Accounting"), nameKey("MSc Accountancy"));
});

test("a duplicate is the same name at a different level or length", () => {
  const msc = { name: "Accounting MSc", level: "PG", durationMonths: 12 };
  assert.equal(looksDuplicate(msc, { name: "Accounting  MSc.", level: "PG", durationMonths: 24 }), true);
  assert.equal(looksDuplicate(msc, { name: "accounting msc", level: "PG_DIPLOMA", durationMonths: 12 }), true);
  // The same name, level and length is one course entered twice at most, which the import already keys on, not a flag.
  assert.equal(looksDuplicate(msc, { name: "Accounting MSc", level: "PG", durationMonths: 12 }), false);
  // A missing length against a recorded one is a different length.
  assert.equal(looksDuplicate(msc, { name: "Accounting MSc", level: "PG", durationMonths: null }), true);
  assert.equal(looksDuplicate({ ...msc, durationMonths: null }, { name: "Accounting MSc", level: "PG", durationMonths: undefined }), false);
  assert.equal(looksDuplicate(msc, { name: "Finance MSc", level: "UG", durationMonths: 36 }), false);
});

test("a fee is far from the others below a quarter or above four times the median, on at least 20 fees", () => {
  assert.equal(feeOutlier(2000, 10000, 20), true);
  assert.equal(feeOutlier(2500, 10000, 20), false);
  assert.equal(feeOutlier(40000, 10000, 20), false);
  assert.equal(feeOutlier(40001, 10000, 20), true);
  assert.equal(feeOutlier(1000, 10000, 19), false);
  assert.equal(feeOutlier(null, 10000, 50), false);
  assert.equal(feeOutlier(1000, null, 50), false);
  // A median of nothing says every real fee is odd, and a fee of nothing is not.
  assert.equal(feeOutlier(500, 0, 50), true);
  assert.equal(feeOutlier(0, 0, 50), false);
});

test("a fee kept in words is a missing yearly fee with the import's note", () => {
  assert.equal(feeInWords({ tuitionPerYear: null, entryRequirements: "Tuition in the MIOC app: £ 14,250 for 3 semester pathway." }), true);
  assert.equal(feeInWords({ tuitionPerYear: 14250, entryRequirements: "Tuition in the MIOC app: £ 14,250 for 3 semester pathway." }), false);
  assert.equal(feeInWords({ tuitionPerYear: null, entryRequirements: "IELTS 6.5" }), false);
  assert.equal(feeInWords({ tuitionPerYear: null, entryRequirements: null }), false);
});

test("a course length is odd when it is kept in words, over six years, a long master's or a short bachelor's", () => {
  const gb = { countryCode: "GB", entryRequirements: null };
  assert.equal(oddDuration({ ...gb, level: "PG", durationMonths: null, entryRequirements: "Duration in the MIOC app: 7-10 months" }), true);
  assert.equal(oddDuration({ ...gb, level: "PG", durationMonths: null }), false);
  assert.equal(oddDuration({ ...gb, level: "PHD", durationMonths: 73 }), true);
  assert.equal(oddDuration({ ...gb, level: "PHD", durationMonths: 72 }), false);
  assert.equal(oddDuration({ ...gb, level: "PG", durationMonths: 37 }), true);
  assert.equal(oddDuration({ ...gb, level: "PG", durationMonths: 36 }), false);
  assert.equal(oddDuration({ ...gb, level: "UG", durationMonths: 23 }), true);
  assert.equal(oddDuration({ ...gb, level: "UG", durationMonths: 24 }), false);
  assert.equal(oddDuration({ ...gb, level: "UG", durationMonths: 36 }), false);
  // A diploma or a top-up can be short; only a bachelor's is held to two years.
  assert.equal(oddDuration({ ...gb, level: "TOP_UP", durationMonths: 12 }), false);
  assert.equal(oddDuration({ ...gb, level: "UG_DIPLOMA", durationMonths: 6 }), false);
});

test("no country is excused a short bachelor's yet, so the rule holds everywhere", () => {
  assert.deepEqual([...SHORT_UG_COUNTRIES], []);
  for (const countryCode of ["GB", "AU", "IN", "US"]) assert.equal(oddDuration({ level: "UG", durationMonths: 12, entryRequirements: null, countryCode }), true);
});

test("a score is odd outside what the tests give", () => {
  const none = { minIelts: null, minPte: null, minToefl: null };
  assert.equal(oddScore(none), false);
  assert.equal(oddScore({ ...none, minIelts: 3.5 }), true);
  assert.equal(oddScore({ ...none, minIelts: 4 }), false);
  assert.equal(oddScore({ ...none, minIelts: 8 }), false);
  assert.equal(oddScore({ ...none, minIelts: 8.5 }), true);
  assert.equal(oddScore({ ...none, minIelts: 65 }), true);
  assert.equal(oddScore({ ...none, minPte: 29 }), true);
  assert.equal(oddScore({ ...none, minPte: 30 }), false);
  assert.equal(oddScore({ ...none, minToefl: 39 }), true);
  assert.equal(oddScore({ ...none, minToefl: 40 }), false);
});

test("a row's flags come in chip order and a clean row has none", () => {
  const clean = {
    level: "PG",
    durationMonths: 12,
    entryRequirements: "Second class bachelor's",
    countryCode: "GB",
    tuitionPerYear: 15000,
    intakeMonths: [9],
    minIelts: 6.5,
    minPte: null,
    minToefl: null,
    feeMedian: 14000,
    feeCourses: 56,
    duplicate: null,
  };
  assert.deepEqual(reviewFlags(clean), []);
  assert.deepEqual(reviewFlags({ ...clean, intakeMonths: [] }), ["NO_INTAKES"]);
  assert.deepEqual(
    reviewFlags({
      ...clean,
      duplicate: { name: "x", level: "UG", durationMonths: 36 },
      tuitionPerYear: 100,
      intakeMonths: [],
      durationMonths: 80,
      minIelts: 9,
    }),
    ["DUPLICATE", "FEE_OUTLIER", "NO_INTAKES", "ODD_DURATION", "SCORE_ODD"],
  );
  assert.deepEqual(reviewFlags({ ...clean, tuitionPerYear: null, entryRequirements: "Tuition in the MIOC app: USD 5000" }), ["FEE_IN_WORDS"]);
  assert.deepEqual(REVIEW_FLAGS, ["DUPLICATE", "FEE_OUTLIER", "FEE_IN_WORDS", "NO_INTAKES", "ODD_DURATION", "SCORE_ODD"]);
});

test("the chips use plain words", () => {
  const self = { name: "Accounting MSc", level: "PG", durationMonths: 12 };
  assert.equal(flagText("FEE_OUTLIER", self, null), "Fee far from others");
  assert.equal(flagText("FEE_IN_WORDS", self, null), "Fee kept in words");
  assert.equal(flagText("NO_INTAKES", self, null), "No intakes");
  assert.equal(flagText("ODD_DURATION", self, null), "Course length odd");
  assert.equal(flagText("SCORE_ODD", self, null), "Score odd");
  assert.equal(flagText("DUPLICATE", self, { name: "MSc Accounting", level: "PG", durationMonths: 24 }), "Duplicate of MSc Accounting");
  // Spelt the same, the other course is told apart by what differs.
  assert.equal(duplicateText(self, { name: "Accounting MSc", level: "PG", durationMonths: 24 }), "Duplicate of the 2 years one");
  assert.equal(duplicateText(self, { name: "Accounting MSc", level: "UG", durationMonths: 12 }), "Duplicate of the Bachelor's one");
  assert.equal(duplicateText(self, { name: "Accounting MSc", level: "UG", durationMonths: null }), "Duplicate of the Bachelor's, not recorded one");
  assert.equal(flagText("DUPLICATE", self, null), FLAG_LABEL.DUPLICATE);
  const all = [...Object.values(FLAG_LABEL), ...Object.values(SHOW_LABEL)].join(" ");
  assert.equal(/\u2014|\u2013/.test(all), false);
});

test("the show filter reads only its three values", () => {
  assert.equal(readShow(undefined), "all");
  assert.equal(readShow("flagged"), "flagged");
  assert.equal(readShow("clean"), "clean");
  assert.equal(readShow("odd"), "all");
  assert.equal(readShow(["clean", "flagged"]), "clean");
});

test("a clean publish says how many flagged drafts it left for the desk", () => {
  const base = { op: "publish" as const, done: 0, left: 0, noIntakes: 0, noEvidence: 0, gone: 0 };
  assert.equal(outcomeText({ ...base, done: 12, flagged: 3 }), "Published 12. 3 drafts worth a look were left for you to check.");
  assert.equal(outcomeText({ ...base, done: 1, flagged: 1 }), "Published 1. 1 draft worth a look was left for you to check.");
  assert.equal(
    outcomeText({ ...base, done: 2, left: 1, noEvidence: 1, flagged: 2 }),
    "Published 2. 1 left as a draft because it has a post-study work answer with no evidence behind it. Open it to add what is missing. 2 drafts worth a look were left for you to check.",
  );
  assert.equal(outcomeText({ ...base, done: 5, flagged: 0 }), "Published 5.");
});
