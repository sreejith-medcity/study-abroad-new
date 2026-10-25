import { cronAuthorised, runCronJob } from "@/server/cron-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The day end report, on a schedule. Meant for a scheduler calling POST
 * /api/cron/journal with "Authorization: Bearer <CRON_SECRET>" every fifteen
 * minutes, or at least just after the day ends and just after the cutoff.
 *
 * Calling it more often does no harm: the day is announced once and the
 * consolidated report sent once, whoever gets there first. Without it the day
 * end reports still work, and the notifications go out the next time anybody
 * opens a page.
 */
export async function POST(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ ok: false }, { status: 401 });
  const run = await runCronJob("journal", { via: "scheduled" });
  return run.ok ? Response.json({ ok: true, ...run.result }) : Response.json({ ok: false, error: run.error }, { status: 500 });
}
