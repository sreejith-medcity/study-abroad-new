import { timingSafeEqual } from "node:crypto";
import { runDocumentReminders } from "@/server/documentation-reminders";
import { audit } from "@/lib/audit";

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
  const secret = process.env.CRON_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // No secret configured means the endpoint is off, not open.
  if (secret.length < 24 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    return Response.json({ ok: true, ...(await runDocumentReminders()) });
  } catch (e) {
    await audit(null, "checklist.reminders_failed", "student", "*", { error: (e as Error).message });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
