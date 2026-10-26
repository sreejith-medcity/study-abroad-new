import "server-only";
import { asc, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { canManageUsers, isAdmin, isStaff } from "@/lib/permissions";
import { can } from "@/server/capabilities";
import { studentWhere } from "@/server/scope";
import type { FeedViewer } from "@/server/record-history";

/**
 * Who is reading the change feed, in the terms the feed's scope asks: the
 * head office reads every record, a branch head their branch, and a
 * counsellor their own students and enquiries and their own account.
 */
export async function feedViewer(user: SessionUser): Promise<FeedViewer> {
  const seesEvery = await can(user, "SEE_EVERY_STUDENT");
  return {
    id: user.id,
    orgId: user.orgId,
    headOffice: isStaff(user),
    seesBranch: seesEvery,
    studentScope: await studentWhere(user),
    seesPeople: isAdmin(user) || canManageUsers(user) || user.role === "MANAGEMENT",
    seesBranchPeople: user.role === "PARTNER",
  };
}

/** The branches the head office can narrow the feed to. */
export const feedBranches = () =>
  db
    .select({ id: schema.organizations.id, name: schema.organizations.name })
    .from(schema.organizations)
    .where(inArray(schema.organizations.type, ["BRANCH", "SUB_AGENT", "HQ"]))
    .orderBy(asc(schema.organizations.name));

/**
 * Who reads the ownership ledger and its verify screen: the people who run
 * the head office, and management, who read everything and change nothing.
 */
export const mayReadLedger = (user: SessionUser) => isAdmin(user) || user.role === "MANAGEMENT";
