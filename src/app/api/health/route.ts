import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Reports whether the app can reach its database. Returns no credentials. */
export async function GET() {
  const started = Date.now();
  try {
    const [row] = await db.execute<{ users: number }>(sql`select count(*)::int as users from users`);
    return Response.json({ ok: true, users: row.users, ms: Date.now() - started });
  } catch (error) {
    const err = error as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return Response.json(
      { ok: false, ms: Date.now() - started, message: err.cause?.message ?? err.message ?? "unknown error", code: err.cause?.code ?? err.code ?? null },
      { status: 500 },
    );
  }
}
