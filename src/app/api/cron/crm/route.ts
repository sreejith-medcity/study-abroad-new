import { timingSafeEqual } from "node:crypto";
import { drainOutbound } from "@/server/crm-out";
import { audit } from "@/lib/audit";

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
  const secret = process.env.CRON_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // No secret configured means the endpoint is off, not open.
  if (secret.length < 24 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await drainOutbound()) });
  } catch (e) {
    await audit(null, "crm.drain_failed", "integration", "*", { error: (e as Error).message });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
