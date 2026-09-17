import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export async function notifyUsers(userIds: (string | null | undefined)[], title: string, body?: string, href?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.insert(schema.notifications).values(ids.map((userId) => ({ userId, title, body, href })));
}

/** All admins of Medcity Overseas (used when a partner acts on an application without an officer). */
export async function adminIds() {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.role, ["ADMIN", "SUPER_ADMIN"]), eq(schema.users.active, true)));
  return rows.map((r) => r.id);
}

/** Partner owner(s) and the assigned counsellor for a student. */
export async function partnerRecipients(orgId: string, assignedToId?: string | null) {
  const owners = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), inArray(schema.users.role, ["PARTNER"])));
  return [...owners.map((o) => o.id), assignedToId ?? null];
}
