import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { probeStorage, storageBackend } from "@/server/storage";

/**
 * What /api/health says, as data. The route, the compose health check, Caddy and
 * the System screen all read the same answer, so a portal that looks well on
 * the screen is one the monitors agree is well.
 */
export type HealthAnswer =
  | { ok: true; users?: number; storage?: string; probe?: Awaited<ReturnType<typeof probeStorage>>; ms: number }
  | { ok: false; ms: number; message?: string; code?: string | null };

export async function healthAnswer(opts: { detailed: boolean; probe?: boolean }): Promise<HealthAnswer> {
  const started = Date.now();
  try {
    const [row] = await db.execute<{ users: number }>(sql`select count(*)::int as users from users`);
    // The probe actually writes and deletes a file, so a wrong key or a
    // read-only volume shows up here instead of when a counsellor uploads a passport.
    const probe = opts.detailed && opts.probe ? await probeStorage() : null;
    return opts.detailed
      ? { ok: true, users: row.users, storage: storageBackend(), ...(probe ? { probe } : {}), ms: Date.now() - started }
      : { ok: true, ms: Date.now() - started };
  } catch (error) {
    const err = error as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return opts.detailed
      ? { ok: false, ms: Date.now() - started, message: err.cause?.message ?? err.message ?? "unknown error", code: err.cause?.code ?? err.code ?? null }
      : { ok: false, ms: Date.now() - started };
  }
}
