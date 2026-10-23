"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getStudentForUser } from "@/server/queries";
import { mayRestoreDocuments, removeDocument, restoreRemoved, restoreVersion, versionRows } from "@/server/document-versions";
import { PARTNER_ROLES, PROCESSING_ROLES, isAdmin, issuesTeamDocuments } from "@/lib/permissions";
import { familyOf, isCurrent } from "@/lib/document-versions";

import type { FormState } from "@/lib/form-state";
export type { FormState };

/**
 * Takes a document off the student's file.
 *
 * It used to delete the row and the stored file, so a passport removed by
 * mistake was gone for good. The row is marked removed now and the file is
 * kept, and the desk can put it back.
 */
export async function deleteDocumentAction(formData: FormData) {
  const user = await requireUser([...PARTNER_ROLES, ...PROCESSING_ROLES]);
  const documentId = String(formData.get("documentId"));
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId), with: { type: true } });
  if (!doc) return;
  await getStudentForUser(user, doc.studentId);
  const allowed =
    isAdmin(user) ||
    (doc.type?.uploadedBy === "team" && issuesTeamDocuments(user)) ||
    (doc.uploadedById === user.id && doc.type?.uploadedBy !== "team") ||
    (user.role === "PARTNER" && doc.type?.uploadedBy !== "team");
  // Only the current version is removed from the screen; an earlier version is
  // history and stays with the document it belongs to.
  if (!allowed || !isCurrent(doc)) return;
  await removeDocument(user, doc);
  revalidatePath(`/students/${doc.studentId}`, "layout");
}

/** Show or hide one document in the student's portal. */
export async function shareDocumentAction(formData: FormData) {
  const user = await requireUser([...PARTNER_ROLES, ...PROCESSING_ROLES]);
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, String(formData.get("documentId"))) });
  if (!doc) return;
  await getStudentForUser(user, doc.studentId);
  const shared = !doc.sharedWithStudent;
  // Every version of the document together, so an earlier version opens for
  // the student exactly when the current one does.
  const family = familyOf(await versionRows(doc.studentId), doc.id);
  const ids = family ? family.all.map((v) => v.id) : [doc.id];
  await db.update(schema.documents).set({ sharedWithStudent: shared }).where(inArray(schema.documents.id, ids));
  await audit(user.id, shared ? "document.share" : "document.unshare", "document", doc.id, { fileName: doc.fileName });
  revalidatePath(`/students/${doc.studentId}`, "layout");
}

/** Makes an earlier version the one in use again. Recorded in the audit log. */
export async function restoreVersionAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...PARTNER_ROLES, ...PROCESSING_ROLES]);
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, String(formData.get("documentId"))) });
  if (!doc) return { error: "That file is not on record." };
  await getStudentForUser(user, doc.studentId);
  if (!(await mayRestoreDocuments(user))) return { error: "Bringing back an earlier version is for the people who check documents." };
  const outcome = await restoreVersion(user, doc);
  revalidatePath(`/students/${doc.studentId}`, "layout");
  return outcome;
}

/** Puts a removed file back on the student's record. Recorded in the audit log. */
export async function restoreRemovedAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...PARTNER_ROLES, ...PROCESSING_ROLES]);
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, String(formData.get("documentId"))) });
  if (!doc) return { error: "That file is not on record." };
  await getStudentForUser(user, doc.studentId);
  if (!(await mayRestoreDocuments(user))) return { error: "Putting back a removed file is for the people who check documents." };
  const outcome = await restoreRemoved(user, doc);
  revalidatePath(`/students/${doc.studentId}`, "layout");
  return outcome;
}
