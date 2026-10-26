import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { mayMerge, planMerge, type MergeRecord } from "@/lib/enquiry-routing";
import { notifyUsers } from "@/server/notify";

const e = schema.enquiries;

export type MergeOutcome = { ok: true; keepId: string; moved: number; filled: string[] } | { ok: false; why: string };

/**
 * Folds one enquiry into another.
 *
 * The duplicate's history (every note, and with it every follow-up and stage
 * move logged on it) moves to the enquiry kept; details the kept one lacks are
 * filled in from it, the sooner follow-up date and the later last contact are
 * kept. The duplicate is not deleted: it is closed as Merged, points at the
 * enquiry that survived, keeps a line saying so, and the merge is in the audit
 * log with what the duplicate held. One transaction, so a merge half done is
 * never left behind.
 */
export async function mergeEnquiries(user: SessionUser, keepId: string, removeId: string): Promise<MergeOutcome> {
  const [keep, remove] = await Promise.all([
    db.query.enquiries.findFirst({ where: eq(e.id, keepId), with: { org: true } }),
    db.query.enquiries.findFirst({ where: eq(e.id, removeId), with: { org: true } }),
  ]);
  // Somebody who cannot open an enquiry is not told it exists.
  const opens = (row: typeof keep) => !!row && (isStaff(user) || row.orgId === user.orgId);
  if (!keep || !remove || !opens(keep) || !opens(remove)) return { ok: false, why: "That enquiry could not be found." };
  if (!mayMerge(user, keep.orgId, remove.orgId)) return { ok: false, why: "Only the head office, or the branch head for two enquiries of their own branch, may merge enquiries." };

  const removeOwnerActive = remove.assignedToId
    ? !!(await db.query.users.findFirst({ where: and(eq(schema.users.id, remove.assignedToId), eq(schema.users.active, true)), columns: { id: true } }))
    : false;
  const plan = planMerge(keep as MergeRecord, remove as MergeRecord, { removeOwnerActive });
  if (!plan.ok) return plan;

  const now = new Date();
  const { clearLost, ...set } = plan.set;
  const moved = await db.transaction(async (tx) => {
    const notes = await tx
      .update(schema.enquiryNotes)
      .set({ enquiryId: keep.id })
      .where(eq(schema.enquiryNotes.enquiryId, remove.id))
      .returning({ id: schema.enquiryNotes.id });
    // An enquiry merged into the duplicate earlier now points at the survivor.
    await tx.update(e).set({ mergedIntoId: keep.id }).where(eq(e.mergedIntoId, remove.id));
    // The CRM id is unique, so it leaves the duplicate before it lands on the survivor.
    await tx
      .update(e)
      .set({
        stage: "MERGED",
        mergedIntoId: keep.id,
        mergedAt: now,
        mergedById: user.id,
        nextFollowUpAt: null,
        ...(set.crmId ? { crmId: null } : {}),
        updatedAt: now,
      })
      .where(eq(e.id, remove.id));
    await tx
      .update(e)
      .set({
        ...set,
        ...(clearLost ? { lostReasonId: null, lostReason: null, lostAt: null } : {}),
        updatedAt: now,
      })
      .where(eq(e.id, keep.id));
    const where = remove.orgId === keep.orgId ? "" : `, ${remove.org.name}`;
    await tx.insert(schema.enquiryNotes).values([
      {
        enquiryId: keep.id,
        authorId: user.id,
        body: `Merged ${remove.name} (${remove.phone}${where}) into this enquiry. ${notes.length} history entr${notes.length === 1 ? "y" : "ies"} moved across.${plan.filled.length ? ` Filled in from it: ${plan.filled.join(", ")}.` : ""}`,
        stageAfter: set.stage ?? null,
      },
      {
        enquiryId: remove.id,
        authorId: user.id,
        body: `Merged into ${keep.name}'s enquiry. Its history is there now.`,
        stageAfter: "MERGED",
      },
    ]);
    await tx.insert(schema.auditLogs).values([
      {
        actorId: user.id,
        action: "enquiry.merge",
        entityType: "enquiry",
        entityId: keep.id,
        meta: {
          merged: remove.id,
          moved: notes.length,
          filled: plan.filled,
          removed: { name: remove.name, phone: remove.phone, email: remove.email, stage: remove.stage, orgId: remove.orgId, assignedToId: remove.assignedToId },
        },
      },
      { actorId: user.id, action: "enquiry.merged", entityType: "enquiry", entityId: remove.id, meta: { into: keep.id } },
    ]);
    return notes.length;
  });

  // Whoever held the duplicate is told where it went, unless they did it themselves.
  const owner = remove.assignedToId;
  if (owner && owner !== user.id && owner !== (set.assignedToId ?? keep.assignedToId)) {
    await notifyUsers([owner], "An enquiry of yours was merged", `${remove.name} is now one enquiry with ${keep.name}'s`, `/enquiries/${keep.id}`);
  }
  return { ok: true, keepId: keep.id, moved, filled: plan.filled };
}

/** How many enquiries were folded into this one, for its page. */
export async function mergedInto(enquiryId: string) {
  return db
    .select({ id: e.id, name: e.name, phone: e.phone, mergedAt: e.mergedAt })
    .from(e)
    .where(and(eq(e.mergedIntoId, enquiryId), sql`${e.stage} = 'MERGED'`));
}
