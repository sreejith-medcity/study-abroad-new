"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getStudentForUser } from "@/server/queries";
import { deleteUpload, saveUpload, UploadError } from "@/server/storage";
import { PARTNER_ROLES, PROCESSING_ROLES, isAdmin, issuesTeamDocuments } from "@/lib/permissions";
import { attachUploadToChecklist } from "@/server/documentation";

import type { FormState } from "@/lib/form-state";
export type { FormState };

export async function uploadDocumentAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...PARTNER_ROLES, ...PROCESSING_ROLES]);
  const studentId = String(formData.get("studentId"));
  const typeCode = String(formData.get("typeCode") || "");
  const file = formData.get("file");
  await getStudentForUser(user, studentId);

  const type = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, typeCode) });
  if (!type) return { error: "Choose a document type." };
  if (type.uploadedBy === "team" && !issuesTeamDocuments(user)) return { error: `${type.label} is put up by the Medcity Overseas desk.` };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  // "Something else" with no name is a file nobody can identify later.
  const label = String(formData.get("label") ?? "").trim().slice(0, 120) || null;
  if (typeCode === "OTHER" && !label) return { error: "Say what this document is, so the next person knows what they are looking at." };

  try {
    const saved = await saveUpload(file, `students/${studentId}`);
    const [doc] = await db.insert(schema.documents).values({ studentId, typeCode, label, fileName: file.name, uploadedById: user.id, ...saved }).returning();
    await audit(user.id, "document.upload", "document", doc.id, { typeCode });
    // A file that answers something on the documentation list joins the team's
    // queue. Nobody, least of all the student, marks their own document good.
    await attachUploadToChecklist(studentId, typeCode, doc.id, user.id);
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    // Anything else used to be rethrown, which killed the screen and told the
    // counsellor nothing. An upload that fails is worth an answer they can act
    // on; the cause goes to the server log for whoever reads it.
    console.error("document upload failed", { studentId, typeCode, fileName: file.name, size: file.size }, e);
    return { error: "The upload did not go through and nothing was saved. Try again, and if it keeps happening tell the Overseas desk which file and how big it is." };
  }
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: `${label ?? type.label} uploaded.` };
}

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
