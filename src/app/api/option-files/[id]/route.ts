import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { optionRequestForUser } from "@/server/option-access";
import { readUpload } from "@/server/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role === "STUDENT") return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const f = await db.query.optionRequestFiles.findFirst({ where: eq(schema.optionRequestFiles.id, id) });
  if (!f || !(await optionRequestForUser(user, f.requestId))) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readUpload(f.storageKey);
  } catch {
    return new Response("File missing from storage", { status: 410 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": f.mimeType, "Content-Disposition": `inline; filename="${encodeURIComponent(f.fileName)}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
