import { cronAuthorised, runCronJob } from "@/server/cron-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The documentation chasing, on a schedule. Meant for a daily scheduler calling
 * POST /api/cron/documents with "Authorization: Bearer <CRON_SECRET>".
 *
 * A student who has gone quiet for three days gets one reminder with the same
 * list, shorter. At a week the counsellor is told instead, because a fourth
 * message is not what moves that file. A document that runs out before the course
 * starts is flagged once, and a gate that comes clear is announced once.
 */
export async function POST(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ ok: false }, { status: 401 });
  const run = await runCronJob("documents", { via: "scheduled" });
  return run.ok ? Response.json({ ok: true, ...run.result }) : Response.json({ ok: false, error: run.error }, { status: 500 });
}
