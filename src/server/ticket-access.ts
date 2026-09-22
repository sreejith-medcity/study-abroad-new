import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";

/** A ticket this user may see: their branch's, or any for the Overseas team. */
export async function ticketForUser(user: SessionUser, id: string) {
  const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) });
  if (!t || (!isStaff(user) && t.orgId !== user.orgId)) return null;
  return t;
}
