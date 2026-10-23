import { timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { noteCronRun } from "@/server/cron-runs";
import { catchUp } from "@/server/journal";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The daily journal, on a schedule. Meant for a scheduler calling POST
 * /api/cron/journal with "Authorization: Bearer <CRON_SECRET>" every fifteen
 * minutes, or at least just after the day ends and just after the cutoff.
 *
 * Calling it more often does no harm: the day is announced once and the report
 * sent once, whoever gets there first. Without it the journals still work, and
 * the notifications go out the next time anybody opens a page.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // No secret configured means the endpoint is off, not open.
  if (secret.length < 24 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await catchUp();
    await noteCronRun("journal", result);
    return Response.json({ ok: true, ...result });
  } catch (e) {
    await audit(null, "journal.run_failed", "cron", "journal", { error: (e as Error).message });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
