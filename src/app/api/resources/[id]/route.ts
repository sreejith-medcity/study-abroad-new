import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isStaff } from "@/lib/permissions";
import { readUpload } from "@/server/storage";

/** Serves a library file to anyone whose role is in its audience. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;

  const row = await db.query.resources.findFirst({ where: eq(schema.resources.id, id) });
  if (!row || !row.storageKey) return new Response("Not found", { status: 404 });
  if (!row.published && !isStaff(user)) return new Response("Not found", { status: 404 });
  if (!isStaff(user) && !row.audience.includes(user.role)) return new Response("Not found", { status: 404 });

  const file = await readUpload(row.storageKey).catch(() => null);
  if (!file) return new Response("The file is missing from storage", { status: 404 });

  await db
    .update(schema.resources)
    .set({ downloads: sql`${schema.resources.downloads} + 1` })
    .where(eq(schema.resources.id, row.id));
  await audit(user.id, "resource.download", "resource", row.id, { title: row.title });

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": row.mimeType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${(row.fileName ?? "resource").replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
