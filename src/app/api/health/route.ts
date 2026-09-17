import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getSession } from "@/lib/auth";
import { storageBackend } from "@/server/storage";
import { isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Database and storage check. Detail is for admins, or for a monitor that knows
 * HEALTH_TOKEN; everyone else gets a bare ok/not-ok with no internals.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const expected = process.env.HEALTH_TOKEN;
  const session = await getSession();
  const detailed = !!session && isAdmin(session) || (!!expected && token === expected);

  const started = Date.now();
  try {
    const [row] = await db.execute<{ users: number }>(sql`select count(*)::int as users from users`);
    return Response.json(detailed ? { ok: true, users: row.users, storage: storageBackend(), ms: Date.now() - started } : { ok: true });
  } catch (error) {
    const err = error as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return Response.json(
      detailed
        ? { ok: false, ms: Date.now() - started, message: err.cause?.message ?? err.message ?? "unknown error", code: err.cause?.code ?? err.code ?? null }
        : { ok: false },
      { status: 500 },
    );
  }
}
