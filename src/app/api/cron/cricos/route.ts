import { timingSafeEqual } from "node:crypto";
import { audit } from "@/lib/audit";
import { fetchCricosFiles, syncCricos } from "@/server/cricos-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refreshes the Australian catalogue from the CRICOS register without anyone
 * clicking. Meant for a monthly scheduler (Hostinger cron, cron-job.org or
 * similar) calling POST /api/cron/cricos with the header
 * "Authorization: Bearer <CRON_SECRET>". New courses land as drafts, so nothing
 * reaches partners until someone publishes it; courses that left the register
 * are archived.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  // No secret configured means the endpoint is off, not open.
  if (secret.length < 24 || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return Response.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await syncCricos(await fetchCricosFiles(), { publish: false });
    await audit(null, "programs.cricos_sync", "program", "*", { ...result, publish: false, via: "scheduled" });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    await audit(null, "programs.cricos_sync_failed", "program", "*", { error: (e as Error).message });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
