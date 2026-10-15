"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getStudentForUser } from "@/server/queries";
import { deleteUpload } from "@/server/storage";
import { PARTNER_ROLES, PROCESSING_ROLES, isAdmin, issuesTeamDocuments } from "@/lib/permissions";

import type { FormState } from "@/lib/form-state";
export type { FormState };

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
  if (!allowed) return;
  await db.delete(schema.documents).where(eq(schema.documents.id, documentId));
  await deleteUpload(doc.storageKey);
  await audit(user.id, "document.delete", "document", documentId, { fileName: doc.fileName, typeCode: doc.typeCode });
  revalidatePath(`/students/${doc.studentId}`, "layout");
}

/** Show or hide one document in the student's portal. */
export async function shareDocumentAction(formData: FormData) {
  const user = await requireUser([...PARTNER_ROLES, ...PROCESSING_ROLES]);
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, String(formData.get("documentId"))) });
  if (!doc) return;
  await getStudentForUser(user, doc.studentId);
  const shared = !doc.sharedWithStudent;
  await db.update(schema.documents).set({ sharedWithStudent: shared }).where(eq(schema.documents.id, doc.id));
  await audit(user.id, shared ? "document.share" : "document.unshare", "document", doc.id, { fileName: doc.fileName });
  revalidatePath(`/students/${doc.studentId}`, "layout");
}
