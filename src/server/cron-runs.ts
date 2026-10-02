import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";

/**
 * When each scheduled job last ran, so a scheduler nobody set up, or one that
 * has quietly stopped, is a thing the portal says rather than a thing somebody
 * eventually notices.
 *
 * Kept in the audit log rather than in a table of its own: there is one row per
 * run either way, the audit log is already backed up and already read, and a new
 * table for three timestamps is a table to migrate for nothing.
 */

export const CRON_JOBS = {
  crm: { label: "The CRM queue", path: "/api/cron/crm", everyMinutes: 10 },
  documents: { label: "Documentation chasing", path: "/api/cron/documents", everyMinutes: 60 * 24 },
  cricos: { label: "The CRICOS register", path: "/api/cron/cricos", everyMinutes: 60 * 24 * 31 },
} as const;

export type CronJob = keyof typeof CRON_JOBS;

/** Noted on every successful run. Failures already write their own entry. */
export const noteCronRun = (job: CronJob, result: Record<string, unknown>) => audit(null, "cron.ran", "cron", job, result);

export type CronStanding = {
  job: CronJob;
  label: string;
  path: string;
  lastRanAt: Date | null;
  /** Null where it has never run. */
  minutesAgo: number | null;
  /**
   * Whether it has run recently enough to believe the scheduler is working. A
   * job is given three times its own interval before being called late, because
   * a scheduler a few minutes behind is normal and not worth a warning.
   */
  healthy: boolean;
  lastResult: Record<string, unknown> | null;
};

export async function cronStandings(now: Date = new Date()): Promise<CronStanding[]> {
  const jobs = Object.keys(CRON_JOBS) as CronJob[];
  const rows = await db
    .select({ entityId: schema.auditLogs.entityId, createdAt: schema.auditLogs.createdAt, meta: schema.auditLogs.meta })
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.action, "cron.ran"))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(200);

  const newest = new Map<string, { createdAt: Date; meta: unknown }>();
  for (const r of rows) if (!newest.has(r.entityId)) newest.set(r.entityId, { createdAt: r.createdAt, meta: r.meta });

  return jobs.map((job) => {
    const last = newest.get(job);
    const minutesAgo = last ? Math.floor((now.getTime() - last.createdAt.getTime()) / 60_000) : null;
    return {
      job,
      label: CRON_JOBS[job].label,
      path: CRON_JOBS[job].path,
      lastRanAt: last?.createdAt ?? null,
      minutesAgo,
      healthy: minutesAgo != null && minutesAgo <= CRON_JOBS[job].everyMinutes * 3,
      lastResult: (last?.meta as Record<string, unknown>) ?? null,
    };
  });
}

/** Whether a scheduled job has ever failed, which is worth seeing beside the above. */
export async function cronFailures(limit = 5) {
  return db
    .select({ action: schema.auditLogs.action, createdAt: schema.auditLogs.createdAt, meta: schema.auditLogs.meta })
    .from(schema.auditLogs)
    .where(inArray(schema.auditLogs.action, ["checklist.reminders_failed", "crm.drain_failed", "programs.cricos_sync_failed"]))
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
}
