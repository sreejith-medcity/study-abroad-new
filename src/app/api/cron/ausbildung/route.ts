import { timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { runAusbildungTurnaround } from "@/server/ausbildung-turnaround";
import { noteCronRun } from "@/server/cron-runs";

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
  const secret = process.env.CRON_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // No secret configured means the endpoint is off, not open.
  if (secret.length < 24 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runAusbildungTurnaround();
    await noteCronRun("ausbildung", result);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    await audit(null, "ausbildung.turnaround_failed", "cron", "ausbildung", { error: (e as Error).message });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
