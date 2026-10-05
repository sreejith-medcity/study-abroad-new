import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isFamilyRole } from "@/lib/permissions";

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
  if (user.role === "DOCUMENTATION") return false;
  if (user.role !== "COUNSELLOR") return true;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId), columns: { counsellorsSeeCommission: true } });
  return org?.counsellorsSeeCommission ?? true;
});
