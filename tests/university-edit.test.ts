import { test } from "node:test";
import assert from "node:assert/strict";
import { ABOUT_MAX, FACT_MAX, factsText, readFacts, readUniversityForm, websiteProblem, type UniversityInput, type UniversityNow } from "../src/lib/university-edit";
import { diffFields } from "../src/lib/catalogue-history";

const now: UniversityNow = {
  name: "University of Hull",
  city: "Hull",
  website: "www.hull.ac.uk",
  isPublic: true,
  qsRank: "=580",
  qsYear: 2026,
  theRank: null,
  theYear: null,
  about: "First paragraph.\n\nSecond paragraph.",
  facts: ["Established 1927", "Address: Cottingham Road\nHull HU6 7RX"],
};

// The form as the page first shows it, before anybody types.
const shown = (u: UniversityNow): UniversityInput => ({
  name: u.name,
  city: u.city ?? "",
  website: u.website ?? "",
  isPublic: u.isPublic,
  qsRank: u.qsRank ?? "",
  qsYear: u.qsYear == null ? "" : String(u.qsYear),
  theRank: u.theRank ?? "",
  theYear: u.theYear == null ? "" : String(u.theYear),
  about: u.about ?? "",
  facts: factsText(u.facts),
});

test("saving the form untouched changes nothing, even where imports wrote things the form would now refuse", () => {
  // Browsers send a textarea's line breaks as \r\n.
  const input = { ...shown(now), about: now.about!.replace(/\n/g, "\r\n"), facts: factsText(now.facts).replace(/\n/g, "\r\n") };
  const { values, errors } = readUniversityForm(input, now);
  assert.deepEqual(errors, {});
  assert.deepEqual(diffFields(now, values), []);
  assert.equal(values.website, "www.hull.ac.uk");
  assert.deepEqual(values.facts, now.facts);
});

test("blank means not recorded, never zero", () => {
  const { values, errors } = readUniversityForm({ ...shown(now), city: "  ", website: "", qsRank: "", qsYear: "", about: " \n ", facts: "\n\n" }, now);
  assert.deepEqual(errors, {});
  assert.equal(values.city, null);
  assert.equal(values.website, null);
  assert.equal(values.qsRank, null);
  assert.equal(values.qsYear, null);
  assert.equal(values.about, null);
  assert.deepEqual(values.facts, []);
});

test("a website must be a full http or https address", () => {
  assert.equal(websiteProblem(""), null);
  assert.equal(websiteProblem("https://www.hull.ac.uk/study"), null);
  assert.equal(websiteProblem("http://example.edu"), null);
  assert.match(websiteProblem("www.hull.ac.uk")!, /starting https/);
  assert.match(websiteProblem("not a website")!, /spaces/);
  assert.ok(websiteProblem("javascript:alert(1)"));
  assert.ok(websiteProblem("ftp://example.edu"));
  assert.ok(websiteProblem("https://localhost"));
  assert.ok(websiteProblem("https://user:pass@example.edu"));
  assert.ok(websiteProblem(`https://example.edu/${"a".repeat(600)}`));
  const { errors } = readUniversityForm({ ...shown(now), website: "hull dot ac dot uk" }, now);
  assert.ok(errors.website);
});

test("rankings keep their published form and years are edition years", () => {
  const { values, errors } = readUniversityForm({ ...shown(now), qsRank: " #154 ", theRank: "601–650", theYear: "2025" }, now);
  assert.deepEqual(errors, {});
  assert.equal(values.qsRank, "154");
  assert.equal(values.theRank, "601-650");
  assert.equal(values.theYear, 2025);
  const bad = readUniversityForm({ ...shown(now), qsRank: "top 200", theYear: "25" }, now);
  assert.ok(bad.errors.qsRank);
  assert.ok(bad.errors.theYear);
  assert.ok(readUniversityForm({ ...shown(now), qsYear: "2026.5" }, now).errors.qsYear);
});

test("about keeps its line breaks and has a length cap", () => {
  const { values } = readUniversityForm({ ...shown(now), about: "  One.\r\n\r\nTwo.  " }, now);
  assert.equal(values.about, "One.\n\nTwo.");
  assert.ok(readUniversityForm({ ...shown(now), about: "x".repeat(ABOUT_MAX + 1) }, now).errors.about);
});

test("facts are one per line, blanks and repeats dropped", () => {
  assert.deepEqual(readFacts(" Established 1967 \r\n\r\nCity campus\nEstablished 1967\n"), ["Established 1967", "City campus"]);
  const { values } = readUniversityForm({ ...shown(now), facts: "Established 1927\nCampus by the river" }, now);
  assert.deepEqual(values.facts, ["Established 1927", "Campus by the river"]);
  assert.ok(readUniversityForm({ ...shown(now), facts: "y".repeat(FACT_MAX + 1) }, now).errors.facts);
});

test("a name is required", () => {
  assert.ok(readUniversityForm({ ...shown(now), name: "   " }, now).errors.name);
  assert.equal(readUniversityForm({ ...shown(now), name: "  University of Hull " }, now).values.name, "University of Hull");
});
