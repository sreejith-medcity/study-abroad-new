import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isStaff } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";

/**
 * One line under a list's heading when the list is narrowed to one person's
 * own files, which is the "of" filter a dashboard's figures link through.
 *
 * The narrowing had no sign on the page: the list opened from a counsellor's
 * board held thirteen students where the plain list held forty, and nothing
 * said why, and clearing the filters silently dropped it. The filter bar now
 * keeps it as a where-you-are, and this says whose files are showing.
 *
 * The name is only given when the person is somebody the viewer could see
 * anyway: themselves, somebody in their own organisation, or anybody for the
 * desk. "of" comes from the address, so a branch typing in another branch's
 * user id must not be told who that is, or whether the id exists at all; the
 * list under it is empty for them either way, because "of" only narrows.
 */
export async function OwnFilesNote({ of, viewer }: { of?: string | string[]; viewer: Pick<SessionUser, "id" | "role" | "orgId"> }) {
  const id = Array.isArray(of) ? of[0] : of;
  if (!id) return null;
  const person = await db.query.users.findFirst({ where: eq(schema.users.id, id), columns: { name: true, deskLabel: true, orgId: true } });
  const staff = isStaff(viewer);
  const who = person && (staff || person.orgId === viewer.orgId) ? (person.deskLabel ?? person.name) : null;
  // Only the desk, who may see everybody, is told an id is nobody's.
  const text = who ? `Showing ${who}'s own files` : staff && !person ? "Showing one person's own files, but that person is not on the system" : "Showing one person's own files";
  return (
    <p data-own-files={id} className="-mt-4 mb-4 text-sm font-medium text-brand-700">
      {text}
    </p>
  );
}
