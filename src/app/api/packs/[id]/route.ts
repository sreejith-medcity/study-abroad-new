import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isStaff } from "@/lib/permissions";
import { buildPackZip, packContents, packName } from "@/server/pack";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The folder for one application, as one download.
 *
 * Built from what is accepted at the moment it is asked for, never from a stored
 * copy, so the same link a week later gives the paperwork as it stands then. A
 * student never reaches this: the pack carries the internal wording of the file.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user || user.role === "STUDENT") return new Response("Not found", { status: 404 });
  const { id } = await params;
  const pack = await db.query.submissionPacks.findFirst({
    where: eq(schema.submissionPacks.id, id),
    with: { student: { columns: { orgId: true } }, builtBy: { columns: { name: true, deskLabel: true } } },
  });
  if (!pack) return new Response("Not found", { status: 404 });
  if (!isStaff(user) && pack.student.orgId !== user.orgId) return new Response("Not found", { status: 404 });

  const contents = await packContents(pack.applicationId);
  if (!contents) return new Response("Not found", { status: 404 });
  const bytes = await buildPackZip(contents, pack.builtBy ? (pack.builtBy.deskLabel ?? pack.builtBy.name) : "Medcity Overseas");
  await audit(user.id, "pack.download", "application", pack.applicationId, { files: contents.files.length });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(packName(contents))}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
