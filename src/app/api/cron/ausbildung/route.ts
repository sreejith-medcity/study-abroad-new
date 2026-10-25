import { cronAuthorised, runCronJob } from "@/server/cron-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The Ausbildung turnaround follow-through, on a schedule. Meant for a daily
 * scheduler calling POST /api/cron/ausbildung with "Authorization: Bearer
 * <CRON_SECRET>" once in the morning, India time.
 *
 * Every open Ausbildung file that has sat at its step longer than the written
 * process allows gets one follow-up task on the desk that owns the step, and
 * the desk is told, once per stay. Calling it twice in a day raises nothing
 * twice.
 */
export async function POST(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ ok: false }, { status: 401 });
  const run = await runCronJob("ausbildung", { via: "scheduled" });
  return run.ok ? Response.json({ ok: true, ...run.result }) : Response.json({ ok: false, error: run.error }, { status: 500 });
}
