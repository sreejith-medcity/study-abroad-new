import "server-only";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { isCurrent, planPutBack, planRemoval, planRestore } from "@/lib/document-versions";
import { attachUploadToChecklist, type Tx } from "@/server/documentation";
import { can } from "@/server/capabilities";
import { deleteUpload, saveUpload } from "@/server/storage";
import type { SessionUser } from "@/lib/auth";

const { documents: dc, checklistItems: ci, checklistFiles: cf, nclexSteps: ns } = schema;

type Doc = typeof dc.$inferSelect;

/** What the screen is told when two people change the same file at once. */
export const VERSION_CONFLICT = "Somebody else changed this file a moment ago. Reload the page and look again before replacing it.";

export class VersionConflict extends Error {
  constructor() {
    super(VERSION_CONFLICT);
  }
}

/** Still the file the team works from. */
export const currentWhere = and(isNull(dc.supersededAt), isNull(dc.removedAt));

/**
 * Who may bring back an earlier version or a removed file, and open a removed
 * one to decide. The people who decide documents, because choosing which file
 * is the right one is the same judgement as accepting it.
 */
export async function mayRestoreDocuments(user: Pick<SessionUser, "role">) {
  return can(user, "DECIDE_DOCUMENTS");
}

/**
 * Whether the documentation team has accepted this kind of document for the
 * student. A student may not replace or re-send it then: the upload would put
 * the item back to "to be checked" and take the accepted file out of any pack.
 */
export async function acceptedOnChecklist(studentId: string, typeCode: string) {
  const item = await db.query.checklistItems.findFirst({
    where: and(eq(ci.studentId, studentId), eq(ci.typeCode, typeCode), eq(ci.state, "ACCEPTED")),
    columns: { id: true },
  });
  return !!item;
}

/** Every row on one student's file, enough to work out each document's versions. */
export function versionRows(studentId: string) {
  return db
    .select({
      id: dc.id,
      typeCode: dc.typeCode,
      replacesId: dc.replacesId,
      createdAt: dc.createdAt,
      supersededAt: dc.supersededAt,
      supersededById: dc.supersededById,
      removedAt: dc.removedAt,
    })
    .from(dc)
    .where(eq(dc.studentId, studentId));
}

/**
 * Puts a new file up in place of an old one, keeping the old one.
 *
 * The replacement is a new row that points at the old; the old row is marked
 * superseded and its stored file is left exactly where it is. Both happen in
 * one transaction, and only while the old row is still current, so two people
 * replacing the same passport at once cannot leave two current copies.
 *
 * The caller has already decided this person may replace the file and has
 * checked the file itself only as far as the size limit; saveUpload applies the
 * same type and size rules as every other upload.
 */
export async function putUpReplacement(input: { old: Doc; file: File; actorId: string; label?: string | null; via?: "portal" }) {
  const { old, file, actorId } = input;
  const saved = await saveUpload(file, `students/${old.studentId}`);
  // The replacement is stamped with the same moment the old file is set aside,
  // which is how a plain replacement is told apart from a restore later on.
  const now = new Date();
  let doc: Doc;
  try {
    doc = await db.transaction(async (tx) => {
      const [setAside] = await tx
        .update(dc)
        .set({ supersededAt: now, supersededById: actorId })
        .where(and(eq(dc.id, old.id), currentWhere))
        .returning({ id: dc.id });
      if (!setAside) throw new VersionConflict();
      const [row] = await tx
        .insert(dc)
        .values({
          studentId: old.studentId,
          applicationId: old.applicationId,
          typeCode: old.typeCode,
          label: input.label ?? old.label,
          fileName: file.name,
          uploadedById: actorId,
          // A replaced offer letter the student could see is replaced for the
          // student too, rather than vanishing from their portal.
          sharedWithStudent: old.sharedWithStudent,
          replacesId: old.id,
          createdAt: now,
          ...saved,
        })
        .returning();
      return row;
    });
  } catch (e) {
    // Nothing points at the file just stored, so it is not a version of
    // anything and can go.
    await deleteUpload(saved.storageKey).catch(() => {});
    throw e;
  }
  await audit(actorId, "document.replace", "document", doc.id, { replaces: old.id, typeCode: old.typeCode, fileName: file.name, ...(input.via ? { via: input.via } : {}) });
  // A new file is a new thing to check, whoever sent it.
  if (old.typeCode) await attachUploadToChecklist(old.studentId, old.typeCode, doc.id, actorId);
  return doc;
}

/** The rows the version rules read, from inside a transaction. */
function versionRowsIn(tx: Tx, studentId: string) {
  return tx
    .select({
      id: dc.id,
      typeCode: dc.typeCode,
      replacesId: dc.replacesId,
      createdAt: dc.createdAt,
      supersededAt: dc.supersededAt,
      supersededById: dc.supersededById,
      removedAt: dc.removedAt,
    })
    .from(dc)
    .where(eq(dc.studentId, studentId));
}

/**
 * Holds every file on one student's record for the rest of the transaction,
 * then reads them afresh.
 *
 * Two people restoring, removing or putting back files of one document at the
 * same moment would otherwise each work out the plan from what they saw before
 * the other acted, and both could leave a file current. Holding the rows makes
 * the second wait for the first and then plan from what the first left. A
 * replacement waits too, because it has to change the row it replaces. The
 * second read is a separate statement so it sees anything the first finished
 * while this one waited, including a replacement's new row.
 */
async function lockedRows(tx: Tx, studentId: string) {
  // In id order, so two of these never take the same rows in different orders.
  await tx.select({ id: dc.id }).from(dc).where(eq(dc.studentId, studentId)).orderBy(dc.id).for("update");
  return versionRowsIn(tx, studentId);
}

/**
 * Makes one version current again with the conditional update every path uses,
 * so a row that changed underneath is a conflict rather than a second current file.
 */
async function makeCurrent(tx: Tx, id: string, alsoUnremove = false) {
  const [row] = await tx
    .update(dc)
    .set({ supersededAt: null, supersededById: null, ...(alsoUnremove ? { removedAt: null, removedById: null } : {}) })
    .where(and(eq(dc.id, id), alsoUnremove ? isNotNull(dc.removedAt) : and(isNotNull(dc.supersededAt), isNull(dc.removedAt))))
    .returning({ id: dc.id });
  if (!row) throw new VersionConflict();
}

/**
 * Points the documentation list at a file that has become current without being
 * uploaded just now: an earlier version restored, or one taking over from a
 * removed file. It goes in as a new upload to check, because a file that comes
 * back has not been checked for this round.
 */
async function relinkChecklist(tx: Tx, studentId: string, typeCode: string, from: (documentId: string | null) => boolean, to: string, actorId: string) {
  const item = await tx.query.checklistItems.findFirst({ where: and(eq(ci.studentId, studentId), eq(ci.typeCode, typeCode)) });
  if (!item || !from(item.documentId)) return false;
  await attachUploadToChecklist(studentId, typeCode, to, actorId, tx);
  return true;
}

/**
 * Makes an earlier version the current one again.
 *
 * The version in use is set aside rather than deleted, so this can be undone
 * the same way. Where the documentation list was working from the file being
 * set aside, or had no file because the document had none current, it moves to
 * the restored one as a new upload to check.
 */
export async function restoreVersion(user: SessionUser, doc: Doc): Promise<{ ok: string } | { error: string }> {
  if (doc.removedAt) return { error: "That file was removed. Put it back from the removed files first." };
  if (isCurrent(doc)) return { ok: "That version is already the current one." };
  const now = new Date();
  let setAsideIds: string[] = [];
  let already = false;
  try {
    await db.transaction(async (tx) => {
      const plan = planRestore(await lockedRows(tx, doc.studentId), doc.id);
      if ("error" in plan) throw new VersionConflict();
      if ("already" in plan) {
        already = true;
        return;
      }
      setAsideIds = plan.setAside.map((v) => v.id);
      for (const id of setAsideIds) {
        const [aside] = await tx
          .update(dc)
          .set({ supersededAt: now, supersededById: user.id })
          .where(and(eq(dc.id, id), currentWhere))
          .returning({ id: dc.id });
        if (!aside) throw new VersionConflict();
      }
      await makeCurrent(tx, doc.id);
      if (doc.typeCode) {
        const wasOn = setAsideIds.length ? (id: string | null) => !!id && setAsideIds.includes(id) : (id: string | null) => id == null;
        await relinkChecklist(tx, doc.studentId, doc.typeCode, wasOn, doc.id, user.id);
      }
    });
  } catch (e) {
    if (e instanceof VersionConflict) return { error: e.message };
    throw e;
  }
  if (already) return { ok: "That version is already the current one." };
  await audit(user.id, "document.restore", "document", doc.id, { setAside: setAsideIds[0] ?? null, fileName: doc.fileName, typeCode: doc.typeCode });
  return { ok: `${doc.fileName} is the current version again.` };
}

/**
 * Takes a file off the student's record without destroying it.
 *
 * The documentation list and an NCLEX-RN step stop pointing at it, as they did
 * when removing deleted the row, so a removed file never goes into a pack. The
 * stored file stays, so the desk can put it back.
 *
 * Removing the file in use hands the document to the newest earlier version
 * still on record, and the documentation list follows it as a new upload to
 * check; with nothing earlier, the list shows the document as missing. Without
 * this the document vanished from the list with its whole history behind it.
 * The stored files themselves are never deleted here.
 */
export async function removeDocument(user: SessionUser, doc: Doc) {
  const now = new Date();
  let next: string | null = null;
  const removed = await db.transaction(async (tx) => {
    const plan = planRemoval(await lockedRows(tx, doc.studentId), doc.id);
    if (!plan) return false;
    const [row] = await tx
      .update(dc)
      .set({ removedAt: now, removedById: user.id })
      .where(and(eq(dc.id, doc.id), isNull(dc.removedAt)))
      .returning({ id: dc.id });
    if (!row) return false;
    if (plan.next && plan.promote) await makeCurrent(tx, plan.next.id);
    next = plan.next?.id ?? null;
    const relinked = next && doc.typeCode ? await relinkChecklist(tx, doc.studentId, doc.typeCode, (id) => id === doc.id, next, user.id) : false;
    if (!relinked) await tx.update(ci).set({ documentId: null, updatedAt: now }).where(eq(ci.documentId, doc.id));
    await tx.update(ns).set({ documentId: null }).where(eq(ns.documentId, doc.id));
    return true;
  });
  if (removed) await audit(user.id, "document.remove", "document", doc.id, { fileName: doc.fileName, typeCode: doc.typeCode, nowCurrent: next });
  return removed;
}

/**
 * Puts a removed file back.
 *
 * If another version of the same document is current, the one coming back
 * joins it as an earlier version, so there is still only one current file.
 * If none is, it comes back as the current file, and the documentation list,
 * where it has no file, gets this one: as it was if this was the last file the
 * list had, since nothing has been sent since, and as a new upload to check if
 * the list was last working from some other file.
 */
export async function restoreRemoved(user: SessionUser, doc: Doc): Promise<{ ok: string } | { error: string }> {
  if (!doc.removedAt) return { ok: "That file is already on the record." };
  const now = new Date();
  let asCurrent = false;
  let already = false;
  try {
    await db.transaction(async (tx) => {
      const plan = planPutBack(await lockedRows(tx, doc.studentId), doc.id, user.id);
      if (!plan) {
        already = true;
        return;
      }
      asCurrent = plan.asCurrent;
      if (plan.asCurrent) {
        await makeCurrent(tx, doc.id, true);
      } else {
        const [back] = await tx
          .update(dc)
          .set({ removedAt: null, removedById: null, ...(plan.setAside ? { supersededAt: plan.setAside.at, supersededById: plan.setAside.byId } : {}) })
          .where(and(eq(dc.id, doc.id), isNotNull(dc.removedAt)))
          .returning({ id: dc.id });
        if (!back) throw new VersionConflict();
      }
      if (plan.asCurrent && doc.typeCode) {
        const item = await tx.query.checklistItems.findFirst({ where: and(eq(ci.studentId, doc.studentId), eq(ci.typeCode, doc.typeCode)) });
        if (item && item.documentId == null) {
          const [last] = await tx.select({ documentId: cf.documentId }).from(cf).where(eq(cf.itemId, item.id)).orderBy(desc(cf.version)).limit(1);
          if (last?.documentId === doc.id) await tx.update(ci).set({ documentId: doc.id, updatedAt: now }).where(and(eq(ci.id, item.id), isNull(ci.documentId)));
          else await attachUploadToChecklist(doc.studentId, doc.typeCode, doc.id, user.id, tx);
        }
      }
    });
  } catch (e) {
    if (e instanceof VersionConflict) return { error: e.message };
    throw e;
  }
  if (already) return { ok: "That file is already on the record." };
  await audit(user.id, "document.unremove", "document", doc.id, { fileName: doc.fileName, typeCode: doc.typeCode, asEarlierVersion: !asCurrent });
  return { ok: asCurrent ? `${doc.fileName} is back on the file.` : `${doc.fileName} is back, as an earlier version.` };
}
