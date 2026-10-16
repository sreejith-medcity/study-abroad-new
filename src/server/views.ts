import "server-only";
import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { applicationWhere, readFilters, studentWhere } from "@/server/queries";
import type { ViewScope } from "@/db/schema";

export const SCOPE_PATH: Record<ViewScope, string> = {
  STUDENTS: "/students",
  APPLICATIONS: "/applications",
  DOCUMENTATION: "/documentation",
  ENQUIRIES: "/enquiries",
};

export type SavedView = {
  id: string;
  name: string;
  query: string;
  scope: ViewScope;
  shared: "PRIVATE" | "ORG" | "EVERYONE";
  mine: boolean;
  ownerName: string | null;
  count: number | null;
};

/**
 * Every view this person may see on one list: their own, their branch's, and
 * the ones put up for everybody.
 *
 * A view shared with a branch follows the branch, not the person who made it,
 * so a counsellor who leaves does not take the branch's own questions with
 * them.
 */
export async function viewsFor(user: SessionUser, scope: ViewScope): Promise<SavedView[]> {
  const v = schema.views;
  const rows = await db
    .select({
      id: v.id,
      name: v.name,
      query: v.query,
      scope: v.scope,
      shared: v.shared,
      ownerId: v.ownerId,
      position: v.position,
      ownerName: sql<string | null>`coalesce(owner.desk_label, owner.name)`,
    })
    .from(v)
    .leftJoin(sql`users as owner`, sql`owner.id = ${v.ownerId}`)
    .where(
      and(
        eq(v.scope, scope),
        or(
          eq(v.ownerId, user.id),
          and(eq(v.shared, "ORG"), eq(v.orgId, user.orgId)),
          // Everybody means everybody inside Medcity Overseas, not the
          // branches: a desk view of the whole queue is meaningless to a
          // branch that can only see its own files.
          and(eq(v.shared, "EVERYONE"), isStaff(user) ? undefined : sql`false`),
        ),
      ),
    )
    .orderBy(asc(v.position), asc(v.createdAt));

  const counted = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      query: r.query,
      scope: r.scope,
      shared: r.shared,
      mine: r.ownerId === user.id,
      ownerName: r.ownerId === user.id ? null : r.ownerName,
      count: await countFor(user, scope, r.query),
    })),
  );
  return counted;
}

/**
 * How many rows a view holds right now.
 *
 * Read with the same where the list itself builds, so a tab can never promise
 * a number the list then disagrees with. Lists whose filters do not live in a
 * shared builder yet get no number rather than a wrong one.
 */
export async function countFor(user: SessionUser, scope: ViewScope, query: string): Promise<number | null> {
  const f = readFilters(Object.fromEntries(new URLSearchParams(query)));
  try {
    if (scope === "STUDENTS") {
      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.students)
        .where(await studentWhere(user, f as Record<string, string>));
      return Number(n);
    }
    if (scope === "APPLICATIONS") {
      const [{ n }] = await db
        .select({ n: count() })
        .from(schema.applications)
        .innerJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, schema.applications.statusId))
        .where(applicationWhere(user, f));
      return Number(n);
    }
  } catch {
    // A view saved against a filter that has since been renamed should show no
    // number, not take the screen down with it.
    return null;
  }
  return null;
}

/** The ids of the views this person owns, for the screens that let them edit. */
export async function ownedViewIds(userId: string) {
  const rows = await db.select({ id: schema.views.id }).from(schema.views).where(eq(schema.views.ownerId, userId));
  return new Set(rows.map((r) => r.id));
}

export async function viewById(id: string) {
  return db.query.views.findFirst({ where: eq(schema.views.id, id) });
}

/** Views pinned by one person, used to keep the tab row in their order. */
export async function pinnedIds(userId: string) {
  const rows = await db.select({ viewId: schema.viewPins.viewId }).from(schema.viewPins).where(eq(schema.viewPins.userId, userId));
  return new Set(rows.map((r) => r.viewId));
}

export async function viewsWithPins(user: SessionUser, scope: ViewScope) {
  const [views, pins] = await Promise.all([viewsFor(user, scope), pinnedIds(user.id)]);
  return views.map((v) => ({ ...v, pinned: v.mine || pins.has(v.id) }));
}

export { inArray };
