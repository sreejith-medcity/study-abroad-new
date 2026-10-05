import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { roleCan, type Capability, type Override } from "@/lib/capabilities";
import type { SessionUser } from "@/lib/auth";

/**
 * What this person may do, read from what Medcity has set.
 *
 * Cached for the request, because a page asks this several times and the answer
 * cannot change while it renders. Only the differences from the portal's own
 * defaults are stored, so this table is usually empty and the query is cheap.
 */
export const overrides = cache(async (): Promise<Override[]> => {
  const rows = await db
    .select({ role: schema.rolePermissions.role, capability: schema.rolePermissions.capability, allowed: schema.rolePermissions.allowed })
    .from(schema.rolePermissions);
  return rows;
});

export async function can(user: Pick<SessionUser, "role">, capability: Capability): Promise<boolean> {
  return roleCan(user.role, capability, await overrides());
}

/** Every override with who set it and when, for the screen that sets them. */
export const overrideRows = () =>
  db
    .select({
      role: schema.rolePermissions.role,
      capability: schema.rolePermissions.capability,
      allowed: schema.rolePermissions.allowed,
      setAt: schema.rolePermissions.setAt,
      setBy: schema.users.name,
    })
    .from(schema.rolePermissions)
    .leftJoin(schema.users, eqUser())
    .orderBy(schema.rolePermissions.capability, schema.rolePermissions.role);

function eqUser() {
  return eq(schema.users.id, schema.rolePermissions.setById);
}
