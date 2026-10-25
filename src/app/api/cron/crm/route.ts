import { cronAuthorised, runCronJob } from "@/server/cron-jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sending what is waiting for Medcity's CRM. Meant for a scheduler calling
 * POST /api/cron/crm with "Authorization: Bearer <CRON_SECRET>", every few
 * minutes.
 *
 * A counsellor moving a student to the next stage does not wait on somebody
 * else's server, so the event is queued and this drains the queue: what worked is
 * marked sent, a timeout or a 500 is tried again after a growing wait, and a
 * refusal the CRM meant is put in front of a person instead of being retried six
 * times to no purpose.
 */
export async function POST(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ ok: false }, { status: 401 });
  const run = await runCronJob("crm", { via: "scheduled" });
  return run.ok ? Response.json({ ok: true, ...run.result }) : Response.json({ ok: false, error: run.error }, { status: 500 });
}
