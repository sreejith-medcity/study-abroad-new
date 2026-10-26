import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * One line under a list's heading when the list is narrowed to one person's
 * own files, which is the "of" filter a dashboard's figures link through.
 *
 * The narrowing had no sign on the page: the list opened from a counsellor's
 * board held thirteen students where the plain list held forty, and nothing
 * said why, and clearing the filters silently dropped it. The filter bar now
 * keeps it as a where-you-are, and this says whose files are showing. The
 * person is read from the users table; an id that is nobody's says so, since
 * the list it heads is empty for the same reason.
 */
export async function OwnFilesNote({ of }: { of?: string }) {
  if (!of) return null;
  const person = await db.query.users.findFirst({ where: eq(schema.users.id, of), columns: { name: true, deskLabel: true } });
  const who = person ? (person.deskLabel ?? person.name) : null;
  return (
    <p data-own-files={of} className="-mt-4 mb-4 text-sm font-medium text-brand-700">
      {who ? `Showing ${who}'s own files` : "Showing one person's own files, but that person is not on the system"}
    </p>
  );
}
