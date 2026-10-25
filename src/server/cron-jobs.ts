import "server-only";
import { timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { drainOutbound } from "@/server/crm-out";
import { runDocumentReminders } from "@/server/documentation-reminders";
import { fetchCricosFiles, syncCricos } from "@/server/cricos-sync";
import { catchUp } from "@/server/journal";
import { runAusbildungTurnaround } from "@/server/ausbildung-turnaround";
import { CRON_JOBS, noteCronRun, type CronJob } from "@/server/cron-runs";

/**
 * The one place a scheduled job is run from.
 *
 * The five /api/cron routes used to each hold the same three steps: run the
 * job, note the run, or write the failure. The System screen's Run now button
 * needs exactly those steps without the HTTP in front of them, and a second
 * copy of each job's bookkeeping is how the two drift apart. So the steps live
 * here, the routes call them with "scheduled", and the button calls them with
 * "manual" and the person who pressed it.
 */

export type CronRunBy = { via: "scheduled" } | { via: "manual"; actorId: string };

export type CronRunOutcome =
  | { ok: true; job: CronJob; result: Record<string, unknown>; ms: number }
  | { ok: false; job: CronJob; error: string; ms: number };

type JobSpec = {
  /** The job itself. What it returns is what the route answers with. */
  run: (by: CronRunBy) => Promise<Record<string, unknown>>;
  /** What of the result is worth keeping as the run's record, where the whole of it is too much. */
  summarise?: (result: Record<string, unknown>) => Record<string, unknown>;
  /** The audit entry written when the job throws, as cronFailures() looks for it. */
  failure: { action: string; entityType: string; entityId: string };
};

const JOBS: Record<CronJob, JobSpec> = {
  crm: {
    run: () => drainOutbound(),
    failure: { action: "crm.drain_failed", entityType: "integration", entityId: "*" },
  },
  documents: {
    run: () => runDocumentReminders(),
    failure: { action: "checklist.reminders_failed", entityType: "student", entityId: "*" },
  },
  cricos: {
    run: async (by) => {
      const result = await syncCricos(await fetchCricosFiles(), { publish: false });
      // The catalogue keeps its own record of every sync, scheduled or not, so
      // the change history can say where a batch of drafts came from.
      await audit(by.via === "manual" ? by.actorId : null, "programs.cricos_sync", "program", "*", { ...result, publish: false, via: by.via });
      return result;
    },
    summarise: (r) => ({ created: r.created, updated: r.updated, archived: r.archived }),
    failure: { action: "programs.cricos_sync_failed", entityType: "program", entityId: "*" },
  },
  journal: {
    run: () => catchUp(),
    failure: { action: "journal.run_failed", entityType: "cron", entityId: "journal" },
  },
  ausbildung: {
    run: () => runAusbildungTurnaround(),
    failure: { action: "ausbildung.turnaround_failed", entityType: "cron", entityId: "ausbildung" },
  },
};

export const isCronJob = (value: string): value is CronJob => value in CRON_JOBS;

/** Runs one job and records how it went, whoever asked for it. Never throws. */
export async function runCronJob(job: CronJob, by: CronRunBy): Promise<CronRunOutcome> {
  const spec = JOBS[job];
  const started = Date.now();
  try {
    const result = await spec.run(by);
    await noteCronRun(job, spec.summarise ? spec.summarise(result) : result, by);
    return { ok: true, job, result, ms: Date.now() - started };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const actorId = by.via === "manual" ? by.actorId : null;
    await audit(actorId, spec.failure.action, spec.failure.entityType, spec.failure.entityId, { error, via: by.via }).catch(() => {
      // The failure is already in the answer; a second failure writing it down must not hide the first.
    });
    return { ok: false, job, error, ms: Date.now() - started };
  }
}

/**
 * Whether a request to /api/cron/* carries the scheduler's secret. No secret
 * configured means the endpoints are off, not open, and the comparison takes
 * the same time whatever was sent.
 */
export function cronAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 24 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}
