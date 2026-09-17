"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getStudentForUser } from "@/server/queries";
import { deleteUpload, saveUpload, UploadError } from "@/server/storage";
import { ADMIN_ROLES, isAdmin } from "@/lib/permissions";

export type FormState = { error?: string; ok?: string };

export async function uploadDocumentAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  const typeCode = String(formData.get("typeCode") || "");
  const file = formData.get("file");
  await getStudentForUser(user, studentId);

  const type = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, typeCode) });
  if (!type) return { error: "Choose a document type." };
  if (type.uploadedBy === "team" && !isAdmin(user)) return { error: `${type.label} is uploaded by the Medcity Overseas team.` };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };

  try {
    const saved = await saveUpload(file, `students/${studentId}`);
    const [doc] = await db.insert(schema.documents).values({ studentId, typeCode, fileName: file.name, uploadedById: user.id, ...saved }).returning();
    await audit(user.id, "document.upload", "document", doc.id, { typeCode });
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: `${type.label} uploaded.` };
}

export async function deleteDocumentAction(formData: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const documentId = String(formData.get("documentId"));
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId), with: { type: true } });
  if (!doc) return;
  await getStudentForUser(user, doc.studentId);
  const allowed = isAdmin(user) || (doc.uploadedById === user.id && doc.type?.uploadedBy !== "team") || (user.role === "PARTNER" && doc.type?.uploadedBy !== "team");
  if (!allowed) return;
  await db.delete(schema.documents).where(eq(schema.documents.id, documentId));
  await deleteUpload(doc.storageKey);
  await audit(user.id, "document.delete", "document", documentId, { fileName: doc.fileName, typeCode: doc.typeCode });
  revalidatePath(`/students/${doc.studentId}`, "layout");
}
