import type { MigrationComparison } from "./migrations";

/**
 * Everything the System screen shows, as plain data: strings, numbers and ISO
 * dates, nothing that cannot be handed to a client component or turned into
 * text. The server builds one of these; the page draws it and the Copy report
 * button writes it out. No secret and no connection string belongs in here,
 * only hostnames.
 */

export type SystemSnapshot = {
  takenAt: string;
  release: { version: string; builtAt: string | null; commit: string | null };
  database: {
    reachable: boolean;
    error: string | null;
    host: string | null;
    serverVersion: string | null;
    sizeBytes: number | null;
    counts: Record<string, number> | null;
    migrations: MigrationComparison | null;
  };
  documents: {
    mode: "supabase" | "disk";
    /** Only where documents are on disk. */
    folder: string | null;
    writable: boolean;
    writeError: string | null;
    /** Null where the figures could not be read (not on disk, or statfs refused). */
    disk: { freeBytes: number; totalBytes: number } | null;
    /** The bounded check: of the latest few hundred documents, how many files are where the database says. Null where not on disk. */
    sample: { checked: number; present: number } | null;
  };
  jobs: {
    job: string;
    label: string;
    everyMinutes: number;
    lastRanAt: string | null;
    minutesAgo: number | null;
    healthy: boolean;
    lastResult: Record<string, unknown> | null;
    lastManualAt: string | null;
    lastManualResult: Record<string, unknown> | null;
  }[];
  failures: { action: string; at: string; error: string }[];
  health: { ok: boolean; ms: number; users: number | null; storage: string | null; message: string | null };
  clock: { utc: string; india: string };
};

/** Bytes as the owner reads them: "1.4 GB", "312 MB", "0 bytes". */
export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "Not recorded";
  if (n < 1024) return `${n} bytes`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** An instant in India time, "26 Oct 2026, 5:42 PM IST". The server may be anywhere. */
export function indiaTime(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  const text = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  return `${text.replace(/\b(am|pm)\b/, (m) => m.toUpperCase())} IST`;
}

/** "3 minutes ago", "2 days ago", for a scheduled job's last run. */
export function agoText(minutes: number | null): string {
  if (minutes == null) return "never";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The interval a job is meant to run at, in words. */
export function everyText(minutes: number): string {
  if (minutes < 60) return `every ${minutes} minutes`;
  if (minutes < 60 * 24) return `every ${minutes / 60} hours`;
  const days = Math.round(minutes / (60 * 24));
  if (days === 1) return "daily";
  if (days >= 28 && days <= 31) return "monthly";
  return `every ${days} days`;
}

/** A job's result as "sent 3, retrying 1", leaving out the bookkeeping fields. */
export function resultText(result: Record<string, unknown> | null): string {
  if (!result) return "";
  const parts = Object.entries(result)
    .filter(([k, v]) => k !== "via" && (typeof v === "number" || typeof v === "boolean" || typeof v === "string"))
    .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()} ${String(v)}`);
  return parts.join(", ");
}

const COUNT_LABEL: Record<string, string> = {
  students: "Students",
  applications: "Applications",
  documents: "Documents",
  programs: "Programs",
  universities: "Universities",
  users: "Users",
};

export const countLabel = (key: string) => COUNT_LABEL[key] ?? key;

/**
 * The whole screen as text, for pasting into a message. Written as a checklist
 * a person reads top to bottom, with the warnings spelt out where they are,
 * so the report alone is enough to say what is wrong.
 */
export function buildSystemReport(s: SystemSnapshot): string {
  const lines: string[] = [];
  const add = (line = "") => lines.push(line);

  add("Medcity Overseas portal, system report");
  add(`Taken ${indiaTime(s.takenAt)} (${s.takenAt} UTC)`);
  add();

  add("Release");
  add(`  Version: ${s.release.version}`);
  add(`  Built: ${s.release.builtAt ? indiaTime(s.release.builtAt) : "Not recorded (a run without a build)"}`);
  add(`  Commit: ${s.release.commit ?? "Not recorded"}`);
  add();

  add("Database");
  if (!s.database.reachable) {
    add(`  Reachable: no${s.database.error ? ` (${s.database.error})` : ""}`);
  } else {
    add(`  Reachable: yes${s.database.host ? `, host ${s.database.host}` : ""}`);
    add(`  Postgres: ${s.database.serverVersion ?? "Not recorded"}`);
    add(`  Size: ${fmtBytes(s.database.sizeBytes)}`);
    for (const [key, n] of Object.entries(s.database.counts ?? {})) add(`  ${countLabel(key)}: ${n}`);
    if (s.database.migrations) {
      add(`  Migrations: ${s.database.migrations.message}`);
      if (s.database.migrations.status !== "in-step") add("  WARNING: the database and this build are not in step.");
    }
  }
  add();

  add("Documents");
  add(`  Stored in: ${s.documents.mode === "supabase" ? "Supabase Storage" : "a folder on the server's disk"}`);
  if (s.documents.folder) add(`  Folder: ${s.documents.folder}`);
  add(`  Writable: ${s.documents.writable ? "yes" : `no${s.documents.writeError ? ` (${s.documents.writeError})` : ""}`}`);
  if (s.documents.disk) {
    const used = s.documents.disk.totalBytes - s.documents.disk.freeBytes;
    const pct = s.documents.disk.totalBytes > 0 ? Math.round((used / s.documents.disk.totalBytes) * 100) : null;
    add(`  Disk: ${fmtBytes(s.documents.disk.freeBytes)} free of ${fmtBytes(s.documents.disk.totalBytes)}${pct != null ? ` (${pct}% used)` : ""}`);
    if (pct != null && pct >= 90) add("  WARNING: the disk is nearly full.");
  }
  if (s.documents.sample) {
    const missing = s.documents.sample.checked - s.documents.sample.present;
    add(`  Files on disk: ${s.documents.sample.present} of the latest ${s.documents.sample.checked} documents are where the database says (a sample, not the whole set)`);
    if (missing > 0) add(`  WARNING: ${missing} of the sampled documents are missing from the disk.`);
  }
  add();

  add("Scheduled jobs");
  for (const j of s.jobs) {
    const last = j.lastRanAt ? `last ran ${agoText(j.minutesAgo)} (${indiaTime(j.lastRanAt)})` : "has never run on the schedule";
    const state = j.lastRanAt ? (j.healthy ? "on time" : "OVERDUE") : "OVERDUE";
    add(`  ${j.label} (${everyText(j.everyMinutes)}): ${last}, ${state}`);
    const outcome = resultText(j.lastResult);
    if (outcome) add(`    Outcome: ${outcome}`);
    if (j.lastManualAt) add(`    Run by hand ${indiaTime(j.lastManualAt)}${resultText(j.lastManualResult) ? `: ${resultText(j.lastManualResult)}` : ""}`);
  }
  if (s.failures.length === 0) add("  Failures: none recorded");
  else {
    add("  Last failures:");
    for (const f of s.failures) add(`    ${indiaTime(f.at)} ${f.action}: ${f.error}`);
  }
  add();

  add("Health");
  add(`  /api/health: ${s.health.ok ? "ok" : "NOT OK"} in ${s.health.ms} ms${s.health.message ? ` (${s.health.message})` : ""}`);
  if (s.health.users != null) add(`  Users counted: ${s.health.users}`);
  if (s.health.storage) add(`  Storage backend: ${s.health.storage}`);
  add(`  Server clock: ${s.clock.utc} UTC, ${s.clock.india}`);

  return lines.join("\n");
}
