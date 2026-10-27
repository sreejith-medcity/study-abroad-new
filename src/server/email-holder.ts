import "server-only";
import { and, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EmailHolder } from "@/lib/people";

/**
 * Who already signs in with this address, in any case, with their
 * organisation, or null when nobody does. What the refusal says about them is
 * decided by emailTakenMessage in people.ts; this only reads.
 */
export async function emailHolder(email: string, exceptUserId?: string): Promise<EmailHolder | null> {
  const row = await db.query.users.findFirst({
    where: and(sql`lower(${schema.users.email}) = ${email.trim().toLowerCase()}`, exceptUserId ? ne(schema.users.id, exceptUserId) : undefined),
    columns: { id: true, name: true, role: true, active: true },
    with: { org: { columns: { id: true, name: true, type: true } } },
  });
  return row ? { id: row.id, name: row.name, role: row.role, active: row.active, org: row.org } : null;
}

/**
 * The partners screen opened on one person's move form, pre-filled with
 * where to and in what role when those are known.
 */
export function moveLink(userId: string, to?: { orgId: string; role?: string }) {
  const q = new URLSearchParams({ move: userId });
  if (to?.orgId) q.set("to", to.orgId);
  if (to?.role) q.set("role", to.role);
  return `/admin/partners?${q.toString()}#person-${userId}`;
}
