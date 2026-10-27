import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  LEADERBOARD_HEADER,
  NOT_RECORDED,
  compareLeaders,
  csvCell,
  doneOnTime,
  leaderboardCsvRow,
  leaderboardFigures,
  readPeriod,
  shown,
} from "../src/lib/leaderboard";

const counts = (c: Partial<Parameters<typeof leaderboardFigures>[0]> = {}) =>
  leaderboardFigures({ calls: 0, connected: 0, onTime: 0, late: 0, converted: 0, enquiriesHeld: 0, ...c });

test("nothing logged is not recorded, never a 0", () => {
  const f = counts();
  assert.equal(f.calls, null);
  assert.equal(f.connected, null);
  assert.equal(f.connectedPct, null);
  assert.equal(f.onTime, null);
  assert.equal(f.late, null);
  assert.equal(f.converted, null);
  assert.equal(shown(f.calls), NOT_RECORDED);
});

test("calls logged with none connected is a recorded 0 connected", () => {
  const f = counts({ calls: 5, connected: 0 });
  assert.equal(f.calls, 5);
  assert.equal(f.connected, 0);
  assert.equal(f.connectedPct, 0);
  assert.equal(shown(f.connected), "0");
});

test("connected is a share of calls made, rounded", () => {
  assert.equal(counts({ calls: 3, connected: 2 }).connectedPct, 67);
  assert.equal(counts({ calls: 4, connected: 4 }).connectedPct, 100);
});

test("follow-ups are recorded once any was finished, late or on time", () => {
  assert.deepEqual([counts({ onTime: 0, late: 2 }).onTime, counts({ onTime: 0, late: 2 }).late], [0, 2]);
  assert.deepEqual([counts({ onTime: 3 }).onTime, counts({ onTime: 3 }).late], [3, 0]);
});

test("conversions are recorded where the person holds enquiries, and not otherwise", () => {
  assert.equal(counts({ enquiriesHeld: 4 }).converted, 0);
  assert.equal(counts({ enquiriesHeld: 4, converted: 2 }).converted, 2);
  assert.equal(counts({ enquiriesHeld: 0 }).converted, null);
});

test("a follow-up is on time when finished on or before its day", () => {
  assert.ok(doneOnTime("2026-10-26", "2026-10-25"));
  assert.ok(doneOnTime("2026-10-26", "2026-10-26"));
  assert.equal(doneOnTime("2026-10-26", "2026-10-27"), false);
});

test("follow-ups are counted to whoever finished them, against the day they were first due", () => {
  const src = readFileSync(new URL("../src/server/leaderboard.ts", import.meta.url), "utf8");
  assert.match(src, /t\.done_by_id = u\.id/);
  assert.doesNotMatch(src, /t\.assigned_to_id = u\.id/);
  assert.match(src, /<= coalesce\(t\.first_due_on, t\.due_on\)/);
  assert.match(src, /> coalesce\(t\.first_due_on, t\.due_on\)/);
});

test("the day a task was first due is set as it is made and never moved", () => {
  const sqlText = readFileSync(new URL("../drizzle/0085_task_first_due.sql", import.meta.url), "utf8");
  assert.match(sqlText, /ADD COLUMN "first_due_on" date/);
  assert.match(sqlText, /SET "first_due_on" = "due_on" WHERE "first_due_on" IS NULL/);
  assert.match(sqlText, /NEW\.first_due_on := COALESCE\(NEW\.first_due_on, NEW\.due_on\)/);
  assert.match(sqlText, /NEW\.first_due_on := OLD\.first_due_on/);
  assert.match(sqlText, /BEFORE INSERT OR UPDATE OF first_due_on ON "tasks"/);
  assert.match(sqlText, /"enquiries_student_idx" ON "enquiries" USING btree \("student_id"\)/);
  assert.match(sqlText, /"enquiries_assigned_idx" ON "enquiries" USING btree \("assigned_to_id"\)/);
});

test("most converted first, then most connected, and a recorded 0 above not recorded", () => {
  const p = (name: string, c: Partial<Parameters<typeof leaderboardFigures>[0]>) => ({ name, f: counts(c) });
  const rows = [
    p("Quiet", {}),
    p("Tried", { calls: 4, connected: 0, enquiriesHeld: 2 }),
    p("Closer", { calls: 2, connected: 1, converted: 2, enquiriesHeld: 3 }),
    p("Talker", { calls: 9, connected: 6, enquiriesHeld: 3 }),
  ];
  assert.deepEqual([...rows].sort(compareLeaders).map((r) => r.name), ["Closer", "Talker", "Tried", "Quiet"]);
});

test("the period defaults to the month so far, swaps a backwards range, and is held to a year", () => {
  assert.deepEqual(readPeriod({}, "2026-10-26"), { from: "2026-10-01", to: "2026-10-26" });
  assert.deepEqual(readPeriod({ from: "2026-10-20", to: "2026-10-10" }, "2026-10-26"), { from: "2026-10-10", to: "2026-10-20" });
  assert.deepEqual(readPeriod({ from: "2020-01-01", to: "2026-10-26" }, "2026-10-26"), { from: "2025-10-26", to: "2026-10-26" });
  assert.deepEqual(readPeriod({ from: "nonsense", to: "2026-13-45" }, "2026-10-26"), { from: "2026-10-01", to: "2026-10-26" });
});

test("the CSV writes not recorded out and defuses anything a spreadsheet would run", () => {
  assert.equal(LEADERBOARD_HEADER.length, 8);
  const line = leaderboardCsvRow({ name: "=HYPERLINK(1)", branch: "Medcity Kottayam", f: counts({ calls: 2, connected: 1, enquiriesHeld: 1 }) });
  assert.equal(line, `"'=HYPERLINK(1)","Medcity Kottayam","2","1","50%","${NOT_RECORDED}","${NOT_RECORDED}","0"`);
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(null), '""');
});
