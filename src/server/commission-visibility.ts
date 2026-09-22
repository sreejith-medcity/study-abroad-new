import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";

/**
 * Whether this user sees commission figures, the commission pages and the
 * wallet. Staff and branch owners always do; counsellors only when the owner
 * leaves it on.
 */
export const commissionVisible = cache(async (user: Pick<SessionUser, "role" | "orgId">) => {
  if (user.role === "STUDENT") return false;
  if (user.role !== "COUNSELLOR") return true;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId), columns: { counsellorsSeeCommission: true } });
  return org?.counsellorsSeeCommission ?? true;
});
