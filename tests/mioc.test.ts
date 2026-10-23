import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MIOC_CONTENT_TABLES, buildMioc, durationMonths, factText, feeFigure, guideFill, intakeMonths, paragraphs, parseDump, profileFill, sameSite, tuitionFigure, websiteUrl } from "../src/lib/mioc";

const sample = readFileSync(new URL("./fixtures/mioc-sample.sql", import.meta.url), "utf8");
const tables = parseDump(sample);
const built = buildMioc(tables);
const course = (id: number) => built.programs.find((p) => p.miocId === id);

test("only the catalogue tables are kept; students are parsed past and dropped", () => {
  assert.deepEqual(Object.keys(tables).sort(), [
    "tb_country_accomodation",
    "tb_country_faq",
    "tb_courses",
    "tb_destinations",
    "tb_main_course",
    "tb_universities",
    "tb_university_info",
  ]);
  assert.equal(tables.tb_courses.length, 12);
  assert.ok(!JSON.stringify(tables).includes("Never Kept"));
});

test("escaped quotes and line breaks come through as written", () => {
  const p = course(101)!;
  assert.match(p.entryRequirements ?? "", /^•60% in the bachelor's degree\n•No backlogs\nRemarks: It doesn't accept NIOS/);
});

test("switched-off destinations, switched-off universities and orphaned courses are left out", () => {
  assert.deepEqual(built.skipped.hiddenCountries, ["Slovenia"]);
  assert.equal(built.skipped.hiddenUniversities, 1);
  assert.equal(built.skipped.orphanCourses, 3);
  assert.equal(course(107), undefined);
  assert.equal(course(108), undefined);
  assert.equal(course(109), undefined);
  assert.ok(!built.universities.some((u) => u.name === "Empty Mioc College"), "a university with no courses does not come over");
  assert.deepEqual(built.countries.map((c) => c.code), ["GB", "US", "VN"]);
});

test("a course filed under two study areas comes over once, naming the other area", () => {
  assert.equal(course(102), undefined);
  assert.equal(built.skipped.duplicateCourses, 1);
  assert.equal(course(101)!.studyArea, "Computer Science and IT");
  assert.match(course(101)!.entryRequirements ?? "", /Also filed in the MIOC app under: Health Science$/);
});

test("the yearly fee is taken only as a plain figure in the country's own currency", () => {
  assert.equal(course(101)!.tuitionPerYear, 17500);
  assert.equal(course(105)!.tuitionPerYear, 32760);
  assert.equal(course(110)!.tuitionPerYear, 24104, "a figure marked per year is still a yearly figure");
  // A semester pathway is not a year: kept in words, never divided or multiplied.
  assert.equal(course(103)!.tuitionPerYear, null);
  assert.match(course(103)!.entryRequirements ?? "", /Tuition in the MIOC app: £ 14,250 for 3 semester pathway\./);
  // Dollars at a Vietnamese institute are not dong.
  assert.equal(course(106)!.tuitionPerYear, null);
  assert.match(course(106)!.entryRequirements ?? "", /Tuition in the MIOC app: USD 5000/);
  assert.equal(feeFigure("€ 9,000", "€", "EUR"), 9000);
  assert.equal(feeFigure("19,969.56", "Can$", "CAD"), 19970);
  assert.equal(feeFigure("27,786 for 9 months.", "$", "USD"), null);
  assert.equal(feeFigure("TBC", "£", "GBP"), null);
  assert.equal(feeFigure("12,000", "", "GBP"), null, "no currency recorded, no figure");
});

test("noughts are read as not recorded, not as free or as a score of nought", () => {
  const p = course(104)!;
  assert.equal(p.applicationFee, null);
  assert.equal(p.minIelts, null);
  assert.equal(p.minToefl, null);
  assert.equal(p.minPte, null);
  assert.equal(p.minDuolingo, null);
});

test("application fees: a figure, a waiver, or the words as recorded", () => {
  assert.equal(course(105)!.applicationFee, 50);
  assert.equal(course(103)!.feeWaiver, "Application fee waiver recorded in the MIOC app");
  assert.equal(course(103)!.applicationFee, null);
  assert.equal(course(110)!.applicationFee, null);
  assert.match(course(110)!.entryRequirements ?? "", /Application fee in the MIOC app: If applying through the portal: USD 75 plus USD 10/);
  assert.equal(course(111)!.applicationFee, 75);
});

test("scores land in their fields; the rest are kept in words", () => {
  const p = course(105)!;
  assert.equal(p.minIelts, 6);
  assert.equal(p.minIeltsBand, 5.5);
  assert.equal(p.minToefl, 79);
  assert.equal(p.minPte, 53);
  assert.equal(p.minSat, 1060);
  assert.equal(p.minDuolingo, 105, "the DET column is the Duolingo English Test");
  assert.match(p.entryRequirements ?? "", /TOEFL, lowest in any section: 17/);
  assert.match(p.entryRequirements ?? "", /ACT: 21/);
  assert.match(p.entryRequirements ?? "", /Deadline in the MIOC app: Fall : 01 Jun, Spring : 15 Nov/);
  assert.equal(course(110)!.minGmat, 550);
  assert.equal(course(110)!.minGre, 300);
  assert.match(course(103)!.entryRequirements ?? "", /English test in the MIOC app: No Test Requirement/);
});

test("levels, with the app's wording kept where the portal's level is broader", () => {
  assert.equal(course(101)!.level, "PG");
  assert.equal(course(105)!.level, "UG");
  assert.equal(course(103)!.level, "CERTIFICATE");
  assert.match(course(103)!.entryRequirements ?? "", /^Level in the MIOC app: Foundation/);
});

test("durations: months and years, never a range or weeks", () => {
  assert.equal(durationMonths("12 months"), 12);
  assert.equal(durationMonths("48 Month(s) months"), 48);
  assert.equal(durationMonths("2 YEARS months"), 24);
  assert.equal(durationMonths("7-10 months"), null);
  assert.equal(durationMonths("32 WEEKS months"), null);
  assert.equal(durationMonths("1.5-2.5 years"), null);
  assert.match(course(103)!.entryRequirements ?? "", /Duration in the MIOC app: 7-10 months/);
});

test("intakes as the app's users typed them", () => {
  assert.deepEqual(intakeMonths("January,September"), [1, 9]);
  assert.deepEqual(intakeMonths("SEP"), [9]);
  assert.deepEqual(intakeMonths("Spring (jan),Fall (Aug)"), [1, 8]);
  assert.deepEqual(intakeMonths("septemberNovember"), [9, 11]);
  assert.deepEqual(intakeMonths("sepetember"), [9]);
  assert.deepEqual(intakeMonths("Summer (May)"), [5]);
  assert.deepEqual(intakeMonths("2025"), []);
});

test("a file cut short says so rather than loading half", () => {
  assert.throws(() => parseDump(sample.slice(0, sample.indexOf("(105,") + 60)), /cut short/);
});

test("a European thousands point is not read as a decimal, and a tiny figure is not a year's tuition", () => {
  assert.equal(feeFigure("€ 12.500", "€", "EUR"), null);
  assert.equal(feeFigure("1.500", "€", "EUR"), null);
  assert.equal(feeFigure("7659.60", "$", "NZD"), 7660);
  assert.equal(tuitionFigure("45", "£", "GBP"), null);
  assert.equal(tuitionFigure("17,500", "£", "GBP"), 17500);
});

test("words that merely contain a month's letters are not intakes", () => {
  assert.deepEqual(intakeMonths("Rolling, dates may vary"), [5]);
  assert.deepEqual(intakeMonths("Rolling admissions"), []);
  assert.deepEqual(intakeMonths("As per university decision"), []);
  assert.deepEqual(intakeMonths("March, Sept"), [3, 9]);
});

test("a file cut between statements, or an INSERT with no VALUES, is refused", () => {
  const cut = sample.slice(0, sample.lastIndexOf("COMMIT;"));
  assert.throws(() => parseDump(cut), /cut short/);
  assert.throws(() => parseDump("INSERT INTO `tb_courses` SELECT * FROM x;\nCOMMIT;"), /Could not read the rows/);
  assert.throws(() => parseDump(sample.slice(0, sample.indexOf("(105,") - 2)), /cut short/);
});

// ---------------------------------------------------------------- profiles and guides

const profile = (id: number) => built.profiles.find((p) => p.universityMiocId === id);
const guide = (code: string) => built.guides.find((g) => g.code === code);

test("websites become https addresses, and only real-looking ones", () => {
  assert.equal(websiteUrl("www.example.ac.uk/"), "https://www.example.ac.uk");
  assert.equal(websiteUrl("  www.Example.edu/en/  "), "https://www.example.edu/en/");
  assert.equal(websiteUrl("http://example.edu"), "https://example.edu", "http is read as https");
  assert.equal(websiteUrl("https://www.example.edu/page/campuses/vancouver"), "https://www.example.edu/page/campuses/vancouver");
  assert.equal(websiteUrl("example.com/courses/#foundation"), "https://example.com/courses/#foundation");
  assert.equal(websiteUrl("www.example.com."), "https://www.example.com", "a full stop closing the sentence is not part of it");
  assert.equal(websiteUrl("localhost"), null);
  assert.equal(websiteUrl("not a web address"), null);
  assert.equal(websiteUrl("javascript:alert(1)"), null);
  assert.equal(websiteUrl("ftp://example.com"), null);
  assert.equal(websiteUrl("example.com:8080"), null);
  assert.equal(websiteUrl("https://user@example.com"), null);
  assert.equal(websiteUrl(""), null);
  assert.ok(sameSite("https://www.example.edu/", "http://example.edu"));
  assert.ok(!sameSite("https://example.edu", "https://other.edu"));
});

test("the website comes from a Web Url line however it is punctuated, and leaves the facts", () => {
  const p = profile(10)!;
  assert.equal(p.website, "https://www.westbridge-mioc.example", "a line break before the colon is still a Web Url line");
  assert.ok(!p.facts.some((f) => /web url/i.test(f)));
  // An address that does not read as one stays as a fact, so it is not lost.
  assert.equal(profile(12)!.website, null);
  assert.ok(profile(12)!.facts.includes("Web Url : localhost"));
});

test("about text keeps its paragraphs", () => {
  assert.equal(profile(10)!.about, "Westbridge Mioc University is invented for the suites.\n\nIts second paragraph is made up too.");
  assert.equal(paragraphs("  One  line \r\n\r\n\r\n\r\n Two\r\n\r\n "), "One line\n\nTwo");
  assert.equal(paragraphs("   "), null);
});

test("info lines are kept as facts, as written and in the app's order; rankings and 'public' are not taken as figures", () => {
  assert.deepEqual(profile(10)!.facts, ["Type: Public research university", "QS World Ranking ; 1438", "34 in Webometrics Mioc National Ranking"]);
  assert.deepEqual(profile(12)!.facts, ["Web Url : localhost", "Established: 1901"]);
  // Nothing about rankings or public status is lifted out of the profile.
  assert.deepEqual(Object.keys(profile(10)!).sort(), ["about", "facts", "universityMiocId", "website"]);
  assert.equal(factText("Established:\t1967"), "Established: 1967");
  assert.equal(factText("Address\t1 Example Drive\r\nExampletown"), "Address: 1 Example Drive\nExampletown");
  assert.equal(factText("Location  - 1 Example Road"), "Location - 1 Example Road");
});

test("profiles come only for universities that come over, from rows switched on", () => {
  assert.equal(profile(14), undefined, "a switched-off university brings no profile");
  assert.equal(profile(99), undefined, "nor does one the app no longer has");
  assert.equal(profile(13), undefined, "a university with nothing to say has no profile");
  assert.ok(!profile(10)!.facts.some((f) => f.includes("Switched Off")));
  assert.deepEqual(built.content, { missingTables: [], profiles: 2, about: 2, websites: 1, facts: 2, guides: 3, faqs: 2, accommodation: 2 });
});

test("destination guides: the app's fields as written, FAQs in the app's order, switched-off places left out", () => {
  const gb = guide("GB")!;
  assert.equal(gb.capital, "Mioc Capital Town");
  assert.equal(gb.languages, "English, Mioc Welsh");
  assert.equal(gb.climate, "1°C to 23°C");
  assert.equal(gb.guide, "An invented overview of studying in the UK, for the suites only.\n\nA second paragraph, also made up.");
  assert.deepEqual(
    gb.faqs.map((f) => f.question),
    ["What does a Mioc year cost?", "How long is a Mioc master's?"],
    "by the app's order, not its ids, and a question with no answer is dropped",
  );
  assert.equal(gb.faqs[0].answer, "An invented answer,\nover two lines.");
  assert.equal(gb.accommodation, "Invented halls and made-up shared flats.", "a switched-off note is left out");
  assert.equal(guide("US")!.guide, null);
  assert.equal(guide("VN")!.accommodation, "Made-up homestays.");
  assert.equal(guide("SI"), undefined);
  assert.ok(!JSON.stringify(built.guides).includes("Hidden"));
});

test("an export without the profile and guide tables still builds, and says what it lacks", () => {
  const cut = sample
    .replace(/INSERT INTO `tb_university_info`[\s\S]*?;\n/, "")
    .replace(/INSERT INTO `tb_country_faq`[\s\S]*?;\n/, "")
    .replace(/INSERT INTO `tb_country_accomodation`[\s\S]*?;\n/, "");
  const b = buildMioc(parseDump(cut));
  assert.equal(b.programs.length, built.programs.length);
  assert.deepEqual(b.content.missingTables, [...MIOC_CONTENT_TABLES]);
  assert.equal(b.profiles.length, 0);
  assert.equal(guide("GB")!.capital, b.guides.find((g) => g.code === "GB")!.capital, "the guide's own fields come from tb_destinations");
  assert.deepEqual(b.guides.find((g) => g.code === "GB")!.faqs, []);
});

test("fill blanks only: a profile somebody wrote, or a field the import filled once before, is left alone", () => {
  const incoming = { about: "From the app.", website: "https://www.example.edu", facts: ["Type: Public"] };
  assert.deepEqual(profileFill({ about: null, website: null, facts: [] }, incoming), incoming);
  assert.deepEqual(profileFill({ about: "Written by the desk.", website: "https://www.example.edu/", facts: ["Kept"] }, incoming), {}, "nothing written over, and the same site is not repeated");
  assert.deepEqual(profileFill({ about: "  ", website: "", facts: [] }, incoming, new Set(["about", "website"])), { facts: ["Type: Public"] }, "cleared after an earlier run stays cleared");
  // A different website already here stays; the app's is kept among the facts.
  assert.deepEqual(profileFill({ about: null, website: "https://other.example.edu", facts: [] }, incoming), {
    about: "From the app.",
    facts: ["Type: Public", "Website in the MIOC app: https://www.example.edu"],
  });
  assert.deepEqual(profileFill({ about: null, website: null, facts: [] }, { about: null, website: null, facts: [] }), {});

  const empty = { guide: null, capital: null, languages: null, climate: null, accommodation: null, faqs: [] };
  const g = { guide: "Overview.", capital: "Capital", languages: null, climate: "1°C to 2°C", accommodation: null, faqs: [{ question: "Q", answer: "A" }] };
  assert.deepEqual(guideFill(empty, g), { guide: "Overview.", capital: "Capital", climate: "1°C to 2°C", faqs: [{ question: "Q", answer: "A" }] });
  assert.deepEqual(guideFill({ ...empty, guide: "Our own words.", faqs: [{ question: "Ours", answer: "Ours" }] }, g), { capital: "Capital", climate: "1°C to 2°C" });
  assert.deepEqual(guideFill(empty, g, new Set(["guide", "faqs"])), { capital: "Capital", climate: "1°C to 2°C" }, "fields filled on an earlier run are not filled again");
});
