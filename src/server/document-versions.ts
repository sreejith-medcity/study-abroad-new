import "server-only";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { familyOf, isCurrent } from "@/lib/document-versions";
import { attachUploadToChecklist } from "@/server/documentation";
import { can } from "@/server/capabilities";
import { deleteUpload, saveUpload } from "@/server/storage";
import type { SessionUser } from "@/lib/auth";

const { documents: dc, checklistItems: ci, nclexSteps: ns } = schema;

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

/**
 * Makes an earlier version the current one again.
 *
 * The version in use is set aside rather than deleted, so this can be undone
 * the same way. Where the documentation list was working from the file being
 * set aside, it moves to the restored one as a new upload to check, because a
 * file that comes back has not been checked for this round.
 */
export async function restoreVersion(user: SessionUser, doc: Doc): Promise<{ ok: string } | { error: string }> {
  if (doc.removedAt) return { error: "That file was removed. Put it back from the removed files first." };
  if (isCurrent(doc)) return { ok: "That version is already the current one." };
  const family = familyOf(await versionRows(doc.studentId), doc.id);
  const current = family?.current ?? null;
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      if (current) {
        const [setAside] = await tx
          .update(dc)
          .set({ supersededAt: now, supersededById: user.id })
          .where(and(eq(dc.id, current.id), currentWhere))
          .returning({ id: dc.id });
        if (!setAside) throw new VersionConflict();
      }
      const [back] = await tx
        .update(dc)
        .set({ supersededAt: null, supersededById: null })
        .where(and(eq(dc.id, doc.id), isNotNull(dc.supersededAt), isNull(dc.removedAt)))
        .returning({ id: dc.id });
      if (!back) throw new VersionConflict();
    });
  } catch (e) {
    if (e instanceof VersionConflict) return { error: e.message };
    throw e;
  }
  if (current && doc.typeCode) {
    const item = await db.query.checklistItems.findFirst({ where: and(eq(ci.studentId, doc.studentId), eq(ci.typeCode, doc.typeCode)) });
    if (item && item.documentId === current.id) await attachUploadToChecklist(doc.studentId, doc.typeCode, doc.id, user.id);
  }
  await audit(user.id, "document.restore", "document", doc.id, { setAside: current?.id ?? null, fileName: doc.fileName, typeCode: doc.typeCode });
  return { ok: `${doc.fileName} is the current version again.` };
}

/**
 * Takes a file off the student's record without destroying it.
 *
 * The documentation list and an NCLEX-RN step stop pointing at it, as they did
 * when removing deleted the row, so a removed file never goes into a pack. The
 * stored file stays, so the desk can put it back.
 */
export async function removeDocument(user: SessionUser, doc: Doc) {
  const now = new Date();
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(dc)
      .set({ removedAt: now, removedById: user.id })
      .where(and(eq(dc.id, doc.id), isNull(dc.removedAt)))
      .returning({ id: dc.id });
    if (!row) return false;
    await tx.update(ci).set({ documentId: null, updatedAt: now }).where(eq(ci.documentId, doc.id));
    await tx.update(ns).set({ documentId: null }).where(eq(ns.documentId, doc.id));
    return true;
  });
  if (removed) await audit(user.id, "document.remove", "document", doc.id, { fileName: doc.fileName, typeCode: doc.typeCode });
  return removed;
}

/**
 * Puts a removed file back.
 *
 * If another version of the same document has become current since, the one
 * coming back joins it as an earlier version instead, so there is still only
 * one current file. Where the documentation list lost its file when this one
 * was removed and nothing has replaced it, it gets this one back.
 */
export async function restoreRemoved(user: SessionUser, doc: Doc): Promise<{ ok: string } | { error: string }> {
  if (!doc.removedAt) return { ok: "That file is already on the record." };
  const family = familyOf(await versionRows(doc.studentId), doc.id);
  const other = family?.current && family.current.id !== doc.id ? family.current : null;
  const now = new Date();
  // Coming back as an earlier version, it is dated as set aside when the
  // current file took over, not now, so the current file is not mistaken for
  // one somebody restored a moment ago.
  const setAside = doc.supersededAt
    ? {}
    : other
      ? { supersededAt: family?.restored?.at ?? other.createdAt, supersededById: family?.restored?.byId ?? user.id }
      : {};
  await db
    .update(dc)
    .set({ removedAt: null, removedById: null, ...setAside })
    .where(eq(dc.id, doc.id));
  if (!other && !doc.supersededAt && doc.typeCode) {
    await db
      .update(ci)
      .set({ documentId: doc.id, updatedAt: now })
      .where(and(eq(ci.studentId, doc.studentId), eq(ci.typeCode, doc.typeCode), isNull(ci.documentId)));
  }
  await audit(user.id, "document.unremove", "document", doc.id, { fileName: doc.fileName, typeCode: doc.typeCode, asEarlierVersion: !!other });
  return { ok: other ? `${doc.fileName} is back, as an earlier version.` : `${doc.fileName} is back on the file.` };
}
