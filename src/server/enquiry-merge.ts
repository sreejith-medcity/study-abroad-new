import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { isHeadOffice, mayMerge, planMerge, type MergeRecord } from "@/lib/enquiry-routing";
import { notifyUsers } from "@/server/notify";
import { appendLedger } from "@/server/ledger";
import { updateTracked, updateTrackedMany } from "@/server/record-history";

const e = schema.enquiries;

/** A merge the fresh rows refuse, raised inside the transaction so it rolls back. */
class MergeRefused extends Error {}

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
  const headOffice = isHeadOffice(user);
  const first = planMerge(keep as MergeRecord, remove as MergeRecord, { removeOwnerActive, headOffice });
  if (!first.ok) return first;

  const now = new Date();
  let done: { moved: number; filled: string[]; newOwner: string | null | undefined; removeOwner: string | null };
  try {
    done = await db.transaction(async (tx) => {
      // Both rows locked, in id order so two merges of the same pair cannot
      // deadlock, and the plan made again from them: a merge, a conversion or
      // a move that landed since they were read is not merged over.
      const fresh = await tx.select().from(e).where(inArray(e.id, [keep.id, remove.id])).orderBy(asc(e.id)).for("update");
      const k = fresh.find((x) => x.id === keep.id);
      const r = fresh.find((x) => x.id === remove.id);
      if (!k || !r) throw new MergeRefused("That enquiry could not be found.");
      if (!mayMerge(user, k.orgId, r.orgId)) throw new MergeRefused("Only the head office, or the branch head for two enquiries of their own branch, may merge enquiries.");
      const plan = planMerge(k as MergeRecord, r as MergeRecord, { removeOwnerActive: r.assignedToId === remove.assignedToId ? removeOwnerActive : false, headOffice });
      if (!plan.ok) throw new MergeRefused(plan.why);
      const { clearLost, ...set } = plan.set;

      const notes = await tx
        .update(schema.enquiryNotes)
        .set({ enquiryId: keep.id })
        .where(eq(schema.enquiryNotes.enquiryId, remove.id))
        .returning({ id: schema.enquiryNotes.id });
      // An enquiry merged into the duplicate earlier now points at the survivor.
      await updateTrackedMany("enquiry", eq(e.mergedIntoId, remove.id), { mergedIntoId: keep.id }, { by: user.id, action: "enquiry.merge", tx });
      // The CRM id is unique, so it leaves the duplicate before it lands on the survivor.
      await updateTracked(
        "enquiry",
        remove.id,
        {
          stage: "MERGED",
          mergedIntoId: keep.id,
          mergedAt: now,
          mergedById: user.id,
          nextFollowUpAt: null,
          ...(set.crmId ? { crmId: null } : {}),
          updatedAt: now,
        },
        { by: user.id, action: "enquiry.merged", tx },
      );
      // The survivor's filled-in details are a version of their own; an owner
      // taken over from the duplicate is an assignment on the ledger.
      await updateTracked(
        "enquiry",
        keep.id,
        {
          ...set,
          ...(clearLost ? { lostReasonId: null, lostReason: null, lostAt: null } : {}),
          updatedAt: now,
        },
        { by: user.id, action: "enquiry.merge", tx, ledgerDetail: `Taken over from ${r.name}'s enquiry, merged into this one` },
      );
      // The duplicate's line on the ownership ledger ends here, pointing at the
      // enquiry that carries it on, as a conversion's does at the student.
      await appendLedger(tx, [
        {
          kind: "MERGED",
          entity: "enquiry",
          entityId: remove.id,
          orgId: r.orgId,
          ownerId: r.assignedToId,
          detail: `Merged into ${k.name}'s enquiry${r.orgId === k.orgId ? "" : ` at ${keep.org.name}`}`,
          actorId: user.id,
        },
      ]);
      const where = r.orgId === k.orgId ? "" : `, ${remove.org.name}`;
      await tx.insert(schema.enquiryNotes).values([
        {
          enquiryId: keep.id,
          authorId: user.id,
          body: `Merged ${r.name} (${r.phone}${where}) into this enquiry. ${notes.length} history entr${notes.length === 1 ? "y" : "ies"} moved across.${plan.filled.length ? ` Filled in from it: ${plan.filled.join(", ")}.` : ""}`,
          stageAfter: set.stage ?? null,
        },
        {
          enquiryId: remove.id,
          authorId: user.id,
          body: `Merged into ${k.name}'s enquiry. Its history is there now.`,
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
            removed: { name: r.name, phone: r.phone, email: r.email, stage: r.stage, orgId: r.orgId, assignedToId: r.assignedToId },
          },
        },
        { actorId: user.id, action: "enquiry.merged", entityType: "enquiry", entityId: remove.id, meta: { into: keep.id } },
      ]);
      return { moved: notes.length, filled: plan.filled, newOwner: set.assignedToId ?? k.assignedToId, removeOwner: r.assignedToId };
    });
  } catch (err) {
    if (err instanceof MergeRefused) return { ok: false, why: err.message };
    throw err;
  }

  // Whoever held the duplicate is told where it went, unless they did it themselves.
  const owner = done.removeOwner;
  if (owner && owner !== user.id && owner !== done.newOwner) {
    await notifyUsers([owner], "An enquiry of yours was merged", `${remove.name} is now one enquiry with ${keep.name}'s`, `/enquiries/${keep.id}`);
  }
  return { ok: true, keepId: keep.id, moved: done.moved, filled: done.filled };
}

/** How many enquiries were folded into this one, for its page. */
export async function mergedInto(enquiryId: string) {
  return db
    .select({ id: e.id, name: e.name, phone: e.phone, mergedAt: e.mergedAt })
    .from(e)
    .where(and(eq(e.mergedIntoId, enquiryId), sql`${e.stage} = 'MERGED'`));
}
