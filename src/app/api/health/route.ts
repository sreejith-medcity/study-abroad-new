import { getSession } from "@/lib/auth";
import { healthAnswer } from "@/server/health";
import { isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Database and storage check. Detail is for admins, or for a monitor that knows
 * HEALTH_TOKEN; everyone else gets a bare ok/not-ok with no internals.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token");
  const expected = process.env.HEALTH_TOKEN;
  const session = await getSession();
  const detailed = (!!session && isAdmin(session)) || (!!expected && token === expected);

  const answer = await healthAnswer({ detailed, probe: params.get("probe") === "storage" });
  if (!answer.ok) return Response.json(detailed ? answer : { ok: false }, { status: 500 });
  // The bare answer stays exactly {"ok":true}: the runbook and the monitors look for that string.
  if (!detailed) return Response.json({ ok: true });
  return Response.json(answer);
}
