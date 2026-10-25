import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { compareMigrations, type JournalEntry } from "../src/lib/migrations";
import { agoText, buildSystemReport, everyText, fmtBytes, indiaTime, resultText, type SystemSnapshot } from "../src/lib/system-report";

/**
 * The pure parts of the System screen: whether the database's migration
 * history matches the build, and the text report the owner copies out. Neither
 * needs a database.
 */

const journal: JournalEntry[] = [
  { idx: 0, tag: "0000_init", when: 1000 },
  { idx: 1, tag: "0001_users", when: 2000 },
  { idx: 2, tag: "0002_journal", when: 3000 },
];

test("migrations: a database with every file recorded is in step", () => {
  const c = compareMigrations(journal, [1000, 2000, 3000]);
  assert.equal(c.status, "in-step");
  assert.equal(c.known, 3);
  assert.equal(c.recorded, 3);
  assert.deepEqual(c.notApplied, []);
  assert.deepEqual(c.unknown, []);
  assert.match(c.message, /3 migrations recorded, 3 in this build/);
});

test("migrations: a release whose migration was never run is behind, and the tag is named", () => {
  const c = compareMigrations(journal, [1000, 2000]);
  assert.equal(c.status, "behind");
  assert.deepEqual(c.notApplied, ["0002_journal"]);
  assert.match(c.message, /Not applied: 0002_journal/);
  assert.match(c.message, /migrate/);
});

test("migrations: a database ahead of the build says so rather than calling itself behind", () => {
  const c = compareMigrations(journal, [1000, 2000, 3000, 4000]);
  assert.equal(c.status, "ahead");
  assert.deepEqual(c.unknown, [4000]);
  assert.deepEqual(c.notApplied, []);
  assert.match(c.message, /older build/);
});

test("migrations: no history table is its own finding, with every tag listed as not applied", () => {
  const c = compareMigrations(journal, null);
  assert.equal(c.status, "no-history");
  assert.equal(c.recorded, null);
  assert.equal(c.notApplied.length, 3);
  assert.match(c.message, /no migration history table/);
});

test("migrations: Postgres hands created_at back as strings, and duplicates are counted once", () => {
  const c = compareMigrations(journal, ["1000", "2000", "3000", "3000"] as unknown as number[]);
  assert.equal(c.status, "in-step");
  assert.equal(c.recorded, 3);
});

test("migrations: more than three missing tags are summarised rather than listed in full", () => {
  const many: JournalEntry[] = Array.from({ length: 6 }, (_, i) => ({ idx: i, tag: `000${i}_m`, when: (i + 1) * 100 }));
  const c = compareMigrations(many, []);
  assert.match(c.message, /0000_m, 0001_m, 0002_m and 3 more/);
});

test("the journal the build imports lists one entry per migration file in the repository", () => {
  const root = new URL("../", import.meta.url).pathname;
  const entries = (JSON.parse(readFileSync(`${root}drizzle/meta/_journal.json`, "utf8")) as { entries: { tag: string; when: number }[] }).entries;
  const files = readdirSync(`${root}drizzle`).filter((f) => f.endsWith(".sql"));
  assert.equal(entries.length, files.length, "every migration file has a journal entry and vice versa");
  for (const e of entries) assert.ok(files.includes(`${e.tag}.sql`), `${e.tag}.sql exists`);
  // The comparison keys on "when", so two entries sharing one would make a missing migration invisible.
  assert.equal(new Set(entries.map((e) => e.when)).size, entries.length, "no two journal entries share a timestamp");
});

const well: SystemSnapshot = {
  takenAt: "2026-10-26T12:12:00.000Z",
  release: { version: "1.3.0", builtAt: "2026-10-26T10:00:00.000Z", commit: "c5b8a15" },
  database: {
    reachable: true,
    error: null,
    host: "db",
    serverVersion: "16.4",
    sizeBytes: 734003200,
    counts: { students: 1234, applications: 567, documents: 8901, programs: 27000, universities: 980, users: 140 },
    migrations: compareMigrations(journal, [1000, 2000, 3000]),
  },
  documents: {
    mode: "disk",
    folder: "/data/uploads",
    writable: true,
    writeError: null,
    disk: { freeBytes: 40 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 },
    sample: { checked: 200, present: 200 },
  },
  jobs: [
    { job: "crm", label: "The CRM queue", everyMinutes: 10, lastRanAt: "2026-10-26T12:05:00.000Z", minutesAgo: 7, healthy: true, lastResult: { tried: 2, sent: 2, retrying: 0, gaveUp: 0, via: "scheduled" }, lastManualAt: null, lastManualResult: null },
    { job: "journal", label: "The day end report", everyMinutes: 15, lastRanAt: null, minutesAgo: null, healthy: false, lastResult: null, lastManualAt: "2026-10-26T12:10:00.000Z", lastManualResult: { issued: true, via: "manual" } },
  ],
  failures: [],
  health: { ok: true, ms: 12, users: 140, storage: "local-disk", message: null },
  clock: { utc: "2026-10-26 12:12:00", india: "26 Oct 2026, 5:42:00 PM IST" },
};

test("the text report carries every section and shows times in India time", () => {
  const text = buildSystemReport(well);
  for (const heading of ["Release", "Database", "Documents", "Scheduled jobs", "Health"]) assert.ok(text.includes(`\n${heading}\n`), `has a ${heading} section`);
  assert.match(text, /Version: 1\.3\.0/);
  assert.match(text, /Commit: c5b8a15/);
  // 10:00 UTC is 3:30 PM in Kerala.
  assert.match(text, /Built: 26 Oct 2026, 3:30 PM IST/);
  assert.match(text, /Postgres: 16\.4/);
  assert.match(text, /Size: 700 MB/);
  assert.match(text, /Students: 1234/);
  assert.match(text, /Users: 140/);
  assert.match(text, /in step/);
  assert.match(text, /Folder: \/data\/uploads/);
  assert.match(text, /Disk: 40\.0 GB free of 100 GB \(60% used\)/);
  assert.match(text, /200 of the latest 200 documents/);
  assert.match(text, /a sample/);
  assert.match(text, /The CRM queue \(every 10 minutes\): last ran 7 minutes ago \(26 Oct 2026, 5:35 PM IST\), on time/);
  assert.match(text, /Outcome: tried 2, sent 2, retrying 0, gave up 0/);
  assert.match(text, /The day end report \(every 15 minutes\): has never run on the schedule, OVERDUE/);
  assert.match(text, /Run by hand 26 Oct 2026, 5:40 PM IST: issued true/);
  assert.match(text, /Failures: none recorded/);
  assert.match(text, /\/api\/health: ok in 12 ms/);
  assert.match(text, /Server clock: 2026-10-26 12:12:00 UTC, 26 Oct 2026, 5:42:00 PM IST/);
  assert.ok(!text.includes("WARNING"), "a well portal raises no warning");
  assert.ok(!text.includes(String.fromCodePoint(0x2014)), "no em dash");
});

test("the text report spells out each warning where it belongs", () => {
  const text = buildSystemReport({
    ...well,
    database: { ...well.database, migrations: compareMigrations(journal, [1000, 2000]) },
    documents: { ...well.documents, writable: false, writeError: "EACCES: permission denied", disk: { freeBytes: 2 * 1024 ** 3, totalBytes: 100 * 1024 ** 3 }, sample: { checked: 200, present: 197 } },
    failures: [{ action: "journal.run_failed", at: "2026-10-25T18:31:00.000Z", error: "relation journals does not exist" }],
    health: { ok: false, ms: 5003, users: null, storage: null, message: "connect ECONNREFUSED" },
  });
  assert.match(text, /WARNING: the database and this build are not in step/);
  assert.match(text, /Writable: no \(EACCES: permission denied\)/);
  assert.match(text, /WARNING: the disk is nearly full/);
  assert.match(text, /WARNING: 3 of the sampled documents are missing from the disk/);
  assert.match(text, /Last failures:/);
  assert.match(text, /journal\.run_failed: relation journals does not exist/);
  assert.match(text, /\/api\/health: NOT OK in 5003 ms \(connect ECONNREFUSED\)/);
});

test("the text report never carries a connection string, only the host", () => {
  const text = buildSystemReport({ ...well, database: { ...well.database, host: "portal-db" } });
  assert.match(text, /host portal-db/);
  assert.ok(!/postgres(ql)?:\/\//.test(text));
  assert.ok(!/password/i.test(text));
});

test("a database that is down still gives a report with the release and the clock in it", () => {
  const text = buildSystemReport({
    ...well,
    database: { reachable: false, error: "connect ECONNREFUSED 127.0.0.1:5432", host: "127.0.0.1", serverVersion: null, sizeBytes: null, counts: null, migrations: null },
  });
  assert.match(text, /Reachable: no \(connect ECONNREFUSED 127\.0\.0\.1:5432\)/);
  assert.match(text, /Version: 1\.3\.0/);
  assert.match(text, /Server clock/);
});

test("Supabase storage is reported without a folder, a disk figure or a sample", () => {
  const text = buildSystemReport({ ...well, documents: { mode: "supabase", folder: null, writable: true, writeError: null, disk: null, sample: null } });
  assert.match(text, /Stored in: Supabase Storage/);
  assert.ok(!text.includes("Folder:"));
  assert.ok(!text.includes("Disk:"));
  assert.ok(!text.includes("Files on disk"));
});

test("the small formatters", () => {
  assert.equal(fmtBytes(0), "0 bytes");
  assert.equal(fmtBytes(1536), "1.5 KB");
  assert.equal(fmtBytes(5 * 1024 ** 2), "5.0 MB");
  assert.equal(fmtBytes(250 * 1024 ** 3), "250 GB");
  assert.equal(fmtBytes(null), "Not recorded");
  assert.equal(agoText(null), "never");
  assert.equal(agoText(0), "just now");
  assert.equal(agoText(1), "1 minute ago");
  assert.equal(agoText(59), "59 minutes ago");
  assert.equal(agoText(60), "1 hour ago");
  assert.equal(agoText(47 * 60), "47 hours ago");
  assert.equal(agoText(72 * 60), "3 days ago");
  assert.equal(everyText(10), "every 10 minutes");
  assert.equal(everyText(120), "every 2 hours");
  assert.equal(everyText(60 * 24), "daily");
  assert.equal(everyText(60 * 24 * 31), "monthly");
  assert.equal(resultText(null), "");
  assert.equal(resultText({ nudged: 3, messagesSent: 2, closed: ["a"], via: "manual" }), "nudged 3, messages sent 2");
  assert.equal(indiaTime(null), "Not recorded");
  assert.equal(indiaTime("not a date"), "Not recorded");
  assert.equal(indiaTime("2026-01-01T00:00:00.000Z"), "1 Jan 2026, 5:30 AM IST");
});
