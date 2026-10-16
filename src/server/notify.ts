import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export async function notifyUsers(userIds: (string | null | undefined)[], title: string, body?: string, href?: string) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  await db.insert(schema.notifications).values(ids.map((userId) => ({ userId, title, body, href })));
}

/**
 * The people at Medcity Overseas who act on something waiting: the admins,
 * operations, and the application team leader, whose desk most of it lands on.
 * The team leader was left out, so the person running the queue heard about
 * none of it until somebody told them.
 */
export async function adminIds() {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.role, ["ADMIN", "SUPER_ADMIN", "OPS_MANAGER", "APPLICATION_TEAM_LEADER"]), eq(schema.users.active, true)));
  return rows.map((r) => r.id);
}

/**
 * The same people, plus the relationship manager who looks after that branch.
 * Used for anything that is about one branch's student: the manager carrying
 * the branch should not learn about their own files last.
 */
export async function deskRecipients(orgId?: string | null) {
  const ids = await adminIds();
  if (!orgId) return ids;
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: { relationshipManagerId: true },
  });
  return org?.relationshipManagerId ? [...ids, org.relationshipManagerId] : ids;
}

/** Partner owner(s) and the assigned counsellor for a student. */
export async function partnerRecipients(orgId: string, assignedToId?: string | null) {
  const owners = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), inArray(schema.users.role, ["PARTNER"])));
  return [...owners.map((o) => o.id), assignedToId ?? null];
}

/**
 * The Overseas desk: the admins and the documentation team together. Everything
 * about an application between the branch handing it over and the vendor
 * answering is theirs, so they are told about it together.
 */
export async function deskIds() {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.role, ["ADMIN", "SUPER_ADMIN", "OPS_MANAGER", "DOCUMENTATION"]), eq(schema.users.active, true)));
  return rows.map((r) => r.id);
}
