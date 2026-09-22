import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { readUpload } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * A branch's portal logo. Public, like the platform logo: the branch's enquiry
 * form shows it before anyone signs in. Only ever an image the owner uploaded.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, id), columns: { portalLogoKey: true, portalLogoMimeType: true } });
  if (!org?.portalLogoKey || !org.portalLogoMimeType?.startsWith("image/")) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readUpload(org.portalLogoKey);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": org.portalLogoMimeType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
