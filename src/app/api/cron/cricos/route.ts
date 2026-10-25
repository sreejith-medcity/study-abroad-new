import { cronAuthorised, runCronJob } from "@/server/cron-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refreshes the Australian catalogue from the CRICOS register without anyone
 * clicking. Meant for a monthly scheduler (GitHub Actions, cron-job.org or
 * similar) calling POST /api/cron/cricos with the header
 * "Authorization: Bearer <CRON_SECRET>". New courses land as drafts, so nothing
 * reaches partners until someone publishes it; courses that left the register
 * are archived.
 */
export async function POST(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ ok: false }, { status: 401 });
  const run = await runCronJob("cricos", { via: "scheduled" });
  // 502 rather than 500: when this fails it is nearly always data.gov.au not answering.
  return run.ok ? Response.json({ ok: true, ...run.result }) : Response.json({ ok: false, error: run.error }, { status: 502 });
}
