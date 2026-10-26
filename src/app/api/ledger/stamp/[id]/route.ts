import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { mayReadLedger } from "@/server/history-feed";

export const dynamic = "force-dynamic";

/** A stamped checkpoint, or its OpenTimestamps proof, to check on opentimestamps.org. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (user.mustChangePassword || !mayReadLedger(user)) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const stamp = await db.query.ledgerStamps.findFirst({ where: eq(schema.ledgerStamps.id, id) });
  if (!stamp) return new Response("Not found", { status: 404 });
  const name = `ledger-checkpoint-${stamp.uptoSeq}-${stamp.createdAt.toISOString().slice(0, 10)}.txt`;
  if (new URL(req.url).searchParams.get("file") === "ots") {
    if (!stamp.proof) return new Response("This attempt reached no calendar, so it has no proof.", { status: 404 });
    return new Response(new Uint8Array(Buffer.from(stamp.proof, "base64")), {
      headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}.ots"`, "Cache-Control": "no-store" },
    });
  }
  return new Response(stamp.statement, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
