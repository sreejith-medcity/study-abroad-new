import "server-only";
import { statfs } from "node:fs/promises";
import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION } from "@/lib/version";
import { compareMigrations, type JournalEntry } from "@/lib/migrations";
import type { SystemSnapshot } from "@/lib/system-report";
import { cronFailures, cronStandings } from "@/server/cron-runs";
import { healthAnswer } from "@/server/health";
import { probeStorage, storageBackend, uploadExists, uploadRoot } from "@/server/storage";
import journal from "../../drizzle/meta/_journal.json";

/**
 * How the portal is doing, in one object, for the System screen.
 *
 * Each part is gathered on its own and a part that fails says so in its own
 * fields rather than taking the page down with it: a database that cannot be
 * reached is the very thing the owner opened the page to find out, so the
 * release and the clock still have to show.
 */

/** How many of the newest documents are checked against the disk. A sample, so a 20,000-file portal does not stat 20,000 files per page view. */
export const DOCUMENT_SAMPLE = 200;

/** The journal as the build knows it. Imported, so the running image needs no drizzle folder. */
export const KNOWN_MIGRATIONS: JournalEntry[] = (journal as { entries: { idx: number; tag: string; when: number }[] }).entries.map((e) => ({ idx: e.idx, tag: e.tag, when: e.when }));

/** Only the host of the database URL. The rest is a password and stays where it is. */
export function databaseHost(url: string | undefined = process.env.DATABASE_URL): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

async function databasePart(): Promise<SystemSnapshot["database"]> {
  const host = databaseHost();
  try {
    const [[facts], [counts], history] = await Promise.all([
      db.execute<{ version: string; bytes: string | number }>(sql`select current_setting('server_version') as version, pg_database_size(current_database()) as bytes`),
      db.execute<Record<string, number>>(sql`
        select
          (select count(*) from students)::int as students,
          (select count(*) from applications)::int as applications,
          (select count(*) from documents)::int as documents,
          (select count(*) from programs)::int as programs,
          (select count(*) from universities)::int as universities,
          (select count(*) from users)::int as users
      `),
      // A database restored without its drizzle schema has no history table at
      // all, which is a finding, not an error.
      db
        .execute<{ created_at: string | number }>(sql`select created_at from drizzle.__drizzle_migrations order by created_at`)
        .then((rows) => rows.map((r) => Number(r.created_at)))
        .catch(() => null),
    ]);
    return {
      reachable: true,
      error: null,
      host,
      serverVersion: facts?.version ?? null,
      sizeBytes: facts ? Number(facts.bytes) : null,
      counts: counts ? { students: counts.students, applications: counts.applications, documents: counts.documents, programs: counts.programs, universities: counts.universities, users: counts.users } : null,
      migrations: compareMigrations(KNOWN_MIGRATIONS, history),
    };
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return { reachable: false, error: err.cause?.message ?? err.message ?? "unknown error", host, serverVersion: null, sizeBytes: null, counts: null, migrations: null };
  }
}

async function documentsPart(): Promise<SystemSnapshot["documents"]> {
  const onDisk = storageBackend() === "local-disk";
  const probe = await probeStorage();
  const out: SystemSnapshot["documents"] = {
    mode: onDisk ? "disk" : "supabase",
    folder: onDisk ? uploadRoot() : null,
    writable: probe.write === "ok",
    writeError: probe.write === "failed" ? probe.detail : null,
    disk: null,
    sample: null,
  };
  if (!onDisk) return out;

  // Node 22 has fs.promises.statfs; an older runtime, or a folder that does not
  // exist yet, leaves the figure out rather than failing the page.
  out.disk = await statfs(uploadRoot())
    .then((s) => ({ freeBytes: Number(s.bavail) * Number(s.bsize), totalBytes: Number(s.blocks) * Number(s.bsize) }))
    .catch(() => null);

  try {
    const latest = await db.select({ storageKey: schema.documents.storageKey }).from(schema.documents).orderBy(desc(schema.documents.createdAt)).limit(DOCUMENT_SAMPLE);
    let present = 0;
    for (const row of latest) if (await uploadExists(row.storageKey)) present++;
    out.sample = { checked: latest.length, present };
  } catch {
    // The database part of the page already reports the database being down.
  }
  return out;
}

async function jobsPart(): Promise<Pick<SystemSnapshot, "jobs" | "failures">> {
  const [standings, failures] = await Promise.all([cronStandings().catch(() => []), cronFailures(5).catch(() => [])]);
  return {
    jobs: standings.map((s) => ({
      job: s.job,
      label: s.label,
      everyMinutes: s.everyMinutes,
      lastRanAt: s.lastRanAt?.toISOString() ?? null,
      minutesAgo: s.minutesAgo,
      healthy: s.healthy,
      lastResult: s.lastResult,
      lastManualAt: s.lastManualAt?.toISOString() ?? null,
      lastManualResult: s.lastManualResult,
    })),
    failures: failures.map((f) => ({ action: f.action, at: f.createdAt.toISOString(), error: String((f.meta as { error?: unknown } | null)?.error ?? "") })),
  };
}

async function healthPart(): Promise<SystemSnapshot["health"]> {
  const answer = await healthAnswer({ detailed: true });
  return answer.ok
    ? { ok: true, ms: answer.ms, users: answer.users ?? null, storage: answer.storage ?? null, message: null }
    : { ok: false, ms: answer.ms, users: null, storage: null, message: answer.message ?? null };
}

export async function systemSnapshot(now: Date = new Date()): Promise<SystemSnapshot> {
  const [database, documents, jobs, health] = await Promise.all([databasePart(), documentsPart(), jobsPart(), healthPart()]);
  return {
    takenAt: now.toISOString(),
    release: { version: APP_VERSION, builtAt: APP_BUILT_AT, commit: APP_COMMIT },
    database,
    documents,
    ...jobs,
    health,
    clock: {
      utc: now.toISOString().replace("T", " ").slice(0, 19),
      india: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(now).replace(/\b(am|pm)\b/, (m) => m.toUpperCase()) + " IST",
    },
  };
}
