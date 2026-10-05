import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { BRANCH_COUNSELLOR_ROLES, isFamilyRole } from "@/lib/permissions";
import { can } from "@/server/capabilities";

/**
 * Whether this user sees commission figures, the commission pages and the
 * wallet.
 *
 * Staff and branch owners do; counsellors only when the owner leaves it on; the
 * documentation team never. The last of those is the rework's own rule: the
 * people checking a bank statement have no business knowing what the placement
 * pays, and keeping money off their screens keeps the two judgements apart.
 */
export const commissionVisible = cache(async (user: Pick<SessionUser, "role" | "orgId">) => {
  if (isFamilyRole(user.role)) return false;
  // The role-level answer is Medcity's to set; the branch owner's own switch
  // sits on top of it and can only take money away from their counsellors.
  if (!(await can(user, "SEE_MONEY"))) return false;
  if (!(BRANCH_COUNSELLOR_ROLES as readonly string[]).includes(user.role)) return true;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId), columns: { counsellorsSeeCommission: true } });
  return org?.counsellorsSeeCommission ?? true;
});
