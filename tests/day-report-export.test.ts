import { strict as assert } from "node:assert";
import test from "node:test";
import { FIGURE_KEYS, figuresByBranch } from "../src/lib/journal";
import { FIGURES_HEAD, PEOPLE_HEAD, REASON_TEXT, coverRows, dayStateText, dayWorkbookFileName, figuresRows, peopleRows, type DayReport, type DayReportPerson } from "../src/lib/journal-day-export";

/* ---------------- A day's report, as consolidated() would hand it over ---------------- */

const person = (over: Partial<DayReportPerson> & Pick<DayReportPerson, "id" | "name" | "role" | "orgId" | "branch">): DayReportPerson => ({
  figures: null,
  standing: "VERIFIED",
  decidedAt: null,
  note: null,
  lateSignIns: [],
  ...over,
});

const uk = person({
  id: "u1",
  name: "UK Documentation",
  role: "COUNSELLOR",
  orgId: "ktm",
  branch: "Medcity Kottayam",
  standing: "VERIFIED",
  decidedAt: new Date("2026-10-23T11:42:00Z"),
  figures: { leadsReceived: 4, callsMade: 10, connectedCalls: 3, followUpsDone: 2, registrationsDone: 1 },
});
const germany = person({
  id: "u2",
  name: "Germany Counsellor",
  role: "COUNSELLOR",
  orgId: "ktm",
  branch: "Medcity Kottayam",
  standing: "FLAGGED",
  decidedAt: new Date("2026-10-23T12:05:00Z"),
  note: "One call was logged twice.",
  figures: { leadsReceived: 2, callsMade: 8, connectedCalls: null, followUpsDone: 0, registrationsDone: 0 },
});
const trainee = person({ id: "u3", name: "Rohit Das", role: "TRAINEE_COUNSELLOR", orgId: "ktm", branch: "Medcity Kottayam", standing: "MISSED" });
const docs = person({
  id: "u4",
  name: "Nithin Jose",
  role: "DOCUMENTATION",
  orgId: "hq",
  branch: "Medcity Overseas",
  standing: "VERIFIED_LATE",
  decidedAt: new Date("2026-10-23T13:20:00Z"),
  lateSignIns: ["2026-10-23T12:50:00Z", new Date("2026-10-23T13:15:00Z")],
});
const kochiHead = person({
  id: "u5",
  name: "Kochi Branch Head",
  role: "PARTNER",
  orgId: "kochi",
  branch: "Medcity Kochi",
  standing: "PENDING",
});

const report: DayReport = {
  day: "2026-10-23",
  phase: "CLOSED",
  sentAt: new Date("2026-10-23T14:00:00Z"),
  reason: "CUTOFF",
  people: [trainee, germany, kochiHead, docs, uk],
  figures: figuresByBranch([uk, germany, trainee, docs, kochiHead]),
};

/* ---------------- The cover ---------------- */

test("the cover says which day, where it stands, when and why the report went, and who downloaded it", () => {
  const now = new Date("2026-10-24T03:00:00Z");
  const rows = coverRows(report, "Medcity International Overseas Corporation", "Anita Menon", now);
  const by = Object.fromEntries(rows.map((r) => [r[0], r[1]]));
  assert.equal(by["Day end reports"], "Friday 23 October");
  assert.equal(by.Organisation, "Medcity International Overseas Corporation");
  assert.equal(by.Day, "2026-10-23");
  assert.equal(by["Where it stands"], "Closed. Sent at 7:30 PM");
  assert.deepEqual(by["Report sent at"], new Date("2026-10-23T14:00:00Z"));
  assert.equal(by["Report sent because"], REASON_TEXT.CUTOFF);
  assert.equal(by["People issued a report"], 5);
  assert.equal(by["Downloaded by"], "Anita Menon");
  assert.equal(by["Downloaded at"], now);
});

test("a report that went when the last person answered says so; one not sent has no reason", () => {
  assert.equal(coverRows({ ...report, reason: "ALL_DONE" }, "x", "y").find((r) => r[0] === "Report sent because")![1], REASON_TEXT.ALL_DONE);
  const open = coverRows({ ...report, phase: "OPEN", sentAt: null, reason: null }, "x", "y");
  assert.equal(open.find((r) => r[0] === "Report sent at")![1], null);
  assert.equal(open.find((r) => r[0] === "Report sent because")![1], null);
  assert.equal(dayStateText({ phase: "OPEN", sentAt: null, reason: null }), "Open: day end reports can still be verified");
  assert.equal(dayStateText({ phase: "BEFORE", sentAt: null, reason: null }), "The day is not over yet");
  assert.equal(dayStateText({ phase: "NONE", sentAt: null, reason: null }), "Sunday: no day end reports are issued");
  assert.equal(dayStateText({ phase: "CLOSED", sentAt: null, reason: null }), "Closed");
});

test("a reason the portal never wrote is shown as it is rather than dropped", () => {
  assert.equal(coverRows({ ...report, reason: "MANUAL" }, "x", "y").find((r) => r[0] === "Report sent because")![1], "MANUAL");
});

/* ---------------- The people ---------------- */

test("one row per person in the order given, with the standing, the India time answered, after-hours sign-ins and the flag note", () => {
  const rows = peopleRows(report.people);
  assert.equal(rows.length, 5);
  assert.equal(PEOPLE_HEAD.length, rows[0].length, "every row fills the heading");
  assert.deepEqual(rows[0], ["Medcity Kottayam", "Rohit Das", "Trainee counsellor", "Missed", null, null, null]);
  assert.deepEqual(rows[1], ["Medcity Kottayam", "Germany Counsellor", "Counsellor", "Flagged a problem", "5:35 PM", null, "One call was logged twice."]);
  assert.deepEqual(rows[2], ["Medcity Kochi", "Kochi Branch Head", "Branch head", "Not yet verified", null, null, null]);
  assert.deepEqual(rows[3], ["Medcity Overseas", "Nithin Jose", "Documentation team", "Verified after hours", "6:50 PM", "6:20 PM, 6:45 PM", null]);
  assert.deepEqual(rows[4], ["Medcity Kottayam", "UK Documentation", "Counsellor", "Verified", "5:12 PM", null, null]);
});

/* ---------------- The figures ---------------- */

test("the figures sheet has a row per counsellor under their branch, a branch total, and the overall total, with nothing given left empty", () => {
  const { rows, totalRows } = figuresRows(report.figures);
  assert.equal(FIGURES_HEAD.length, 3 + FIGURE_KEYS.length);
  for (const r of rows) assert.equal(r.length, FIGURES_HEAD.length);
  // Kottayam's three counsellors sorted by name, then the branch total; Kochi's head, then its total; then everything.
  assert.deepEqual(
    rows.map((r) => r[1]),
    ["Germany Counsellor", "Rohit Das", "UK Documentation", "Medcity Kottayam total", "Kochi Branch Head", "Medcity Kochi total", "Total"],
  );
  assert.equal(rows.some((r) => r[1] === "Nithin Jose"), false, "a documentation officer gives no figures and has no row");
  const ukRow = rows.find((r) => r[1] === "UK Documentation")!;
  assert.deepEqual(ukRow.slice(3), [4, 10, 3, 2, 1]);
  const deRow = rows.find((r) => r[1] === "Germany Counsellor")!;
  assert.deepEqual(deRow.slice(3), [2, 8, null, 0, 0], "a figure not given is empty; a typed 0 stays 0");
  const missed = rows.find((r) => r[1] === "Rohit Das")!;
  assert.deepEqual(missed.slice(3), [null, null, null, null, null], "a missed report has no figures, not noughts");
  const ktm = rows.find((r) => r[1] === "Medcity Kottayam total")!;
  assert.deepEqual(ktm.slice(2), ["2 of 3 gave figures", 6, 18, 3, 2, 1]);
  const kochi = rows.find((r) => r[1] === "Medcity Kochi total")!;
  assert.deepEqual(kochi.slice(2), ["0 of 1 gave figures", 0, 0, 0, 0, 0], "a branch total is a sum, so a branch with nothing given adds up to 0");
  const all = rows[rows.length - 1];
  assert.deepEqual(all, ["All branches", "Total", "2 of 4 gave figures", 6, 18, 3, 2, 1]);
  assert.deepEqual(totalRows, [3, 5, 6], "the total rows are pointed out so the sheet can set them bold");
});

test("a day with nobody giving figures has no rows and no total", () => {
  assert.deepEqual(figuresRows(figuresByBranch([docs])), { rows: [], totalRows: [] });
});

test("the file is named for the day", () => {
  assert.equal(dayWorkbookFileName("2026-10-23"), "day-end-report-2026-10-23.xlsx");
});
