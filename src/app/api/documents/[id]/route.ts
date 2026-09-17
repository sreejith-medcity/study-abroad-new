import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isStaff } from "@/lib/permissions";
import { readUpload } from "@/server/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, id), with: { student: { columns: { orgId: true } } } });
  if (!doc || (!isStaff(user) && doc.student.orgId !== user.orgId)) return new Response("Not found", { status: 404 });

  let bytes: Buffer;
  try {
    bytes = await readUpload(doc.storageKey);
  } catch {
    return new Response("File missing from storage", { status: 410 });
  }
  await audit(user.id, "document.download", "document", doc.id, { fileName: doc.fileName });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.fileName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
