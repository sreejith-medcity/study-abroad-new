import "server-only";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { DEFAULT_LOST_REASONS } from "@/lib/lost-reasons";
import { isHeadOffice } from "@/lib/enquiry-routing";

const lr = schema.lostReasons;

/**
 * The list, starting it with the usual study-abroad reasons the first time it
 * is read. Only an empty table is filled: a reason somebody switched off stays
 * off, and one they renamed keeps its new name.
 */
export async function lostReasonList(opts: { activeOnly?: boolean } = {}) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(lr);
  if (Number(n) === 0) {
    await db
      .insert(lr)
      .values(DEFAULT_LOST_REASONS.map((label, i) => ({ label, sortOrder: (i + 1) * 10 })))
      .onConflictDoNothing();
  }
  return db
    .select()
    .from(lr)
    .where(opts.activeOnly ? eq(lr.active, true) : undefined)
    .orderBy(asc(lr.sortOrder), asc(lr.label));
}

/** How many enquiries carry each reason, so the list can say which are in use. */
export async function lostReasonUse() {
  const rows = await db
    .select({ id: schema.enquiries.lostReasonId, n: sql<number>`count(*)::int` })
    .from(schema.enquiries)
    .where(sql`${schema.enquiries.lostReasonId} is not null`)
    .groupBy(schema.enquiries.lostReasonId);
  return new Map(rows.map((r) => [r.id!, Number(r.n)]));
}

/** Who may read the lost reasons report: the head office, management, and a branch head for their branch. */
export const mayReadLostReport = (user: SessionUser) => isHeadOffice(user) || user.role === "MANAGEMENT" || (user.role === "PARTNER" && user.orgType === "BRANCH");

/**
 * When an enquiry was lost. Recorded from now on; for one closed before it
 * was, the moment its history says it was closed, and failing that its last
 * change, which is when the stage last moved.
 */
const lostOn = sql<string>`coalesce(${schema.enquiries.lostAt}, (select max(n.created_at) from enquiry_notes n where n.enquiry_id = ${sql.raw('"enquiries"."id"')} and n.stage_after = 'LOST'), ${schema.enquiries.updatedAt})`;

/** The enquiries lost in a period, India days inclusive, that this person may read. */
export async function lostInPeriod(user: SessionUser, period: { from: string; to: string }, orgId?: string | null) {
  const e = schema.enquiries;
  const conds: (SQL | undefined)[] = [
    eq(e.stage, "LOST"),
    sql`${lostOn} >= (${period.from}::date)::timestamp at time zone 'Asia/Kolkata'`,
    sql`${lostOn} < ((${period.to}::date + 1)::timestamp at time zone 'Asia/Kolkata')`,
    isHeadOffice(user) || user.role === "MANAGEMENT" ? (orgId ? eq(e.orgId, orgId) : undefined) : eq(e.orgId, user.orgId),
    isNull(e.mergedIntoId),
  ];
  return db
    .select({
      id: e.id,
      name: e.name,
      source: e.source,
      reason: lr.label,
      detail: e.lostReason,
      branch: schema.organizations.name,
      owner: schema.users.name,
      lostOn,
    })
    .from(e)
    .innerJoin(schema.organizations, eq(schema.organizations.id, e.orgId))
    .leftJoin(lr, eq(lr.id, e.lostReasonId))
    .leftJoin(schema.users, eq(schema.users.id, e.assignedToId))
    .where(and(...conds.filter(Boolean)))
    .orderBy(sql`${lostOn} desc`);
}
