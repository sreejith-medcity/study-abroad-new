import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { readUpload } from "@/server/storage";

/** A document type's sample file. Samples are generic, so any signed-in user may open one. */
export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { code } = await params;
  const t = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, code) });
  if (!t?.sampleStorageKey || !t.sampleMimeType) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readUpload(t.sampleStorageKey);
  } catch {
    return new Response("File missing from storage", { status: 410 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": t.sampleMimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(t.sampleFileName ?? `${code}-sample`)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
