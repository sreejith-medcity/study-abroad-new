import "server-only";
import { and, count, eq, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff, orgScope } from "@/lib/permissions";
import { can } from "@/server/capabilities";
import { ownApplicationsOnly, unassignedFile } from "@/server/scope";

/**
 * How many handed-over files have no officer, for whoever hands them out.
 *
 * Null for somebody without "See and hand out the files nobody is carrying",
 * so a screen can leave the tile or the tab out rather than show a nought
 * that is not theirs to act on. Counted under exactly the conditions the
 * applications list applies with its Unassigned view (the person's own scope,
 * their organisation, and one branch when the dashboard is narrowed to one),
 * so the figure and the list it opens are the same number.
 */
export async function unassignedFileCount(user: SessionUser, org?: string | null): Promise<number | null> {
  if (!(await can(user, "SEE_UNASSIGNED_FILES"))) return null;
  const [row] = await db.select({ n: count() }).from(schema.applications).where(await unassignedWhere(user, org));
  return row?.n ?? 0;
}

/** The condition itself, over the applications table, for a count that is part of a bigger query. */
export async function unassignedWhere(user: SessionUser, org?: string | null): Promise<SQL> {
  const a = schema.applications;
  return and(orgScope(user, a.orgId), await ownApplicationsOnly(user), unassignedFile(), org && isStaff(user) ? eq(a.orgId, org) : undefined)!;
}
