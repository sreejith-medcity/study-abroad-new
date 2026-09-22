"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import { deleteUpload, saveUpload, UploadError } from "@/server/storage";
import type { FormState } from "@/lib/form-state";

/** Guidance and a sample file for one document type. */
export async function saveDocumentTypeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const code = String(fd.get("code") ?? "");
  const t = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, code) });
  if (!t) return { error: "That document type no longer exists." };
  const guidance = String(fd.get("guidance") ?? "").trim().slice(0, 1500) || null;
  const file = fd.get("sample");
  const removeSample = fd.get("removeSample") === "on";
  const set: Partial<typeof schema.documentTypes.$inferInsert> = { guidance };
  let oldKey: string | null = null;
  if (file instanceof File && file.size > 0) {
    try {
      const saved = await saveUpload(file, "document-samples");
      Object.assign(set, { sampleFileName: file.name, sampleStorageKey: saved.storageKey, sampleMimeType: saved.mimeType });
      oldKey = t.sampleStorageKey;
    } catch (e) {
      if (e instanceof UploadError) return { fieldErrors: { sample: [e.message] }, error: e.message };
      throw e;
    }
  } else if (removeSample && t.sampleStorageKey) {
    Object.assign(set, { sampleFileName: null, sampleStorageKey: null, sampleMimeType: null });
    oldKey = t.sampleStorageKey;
  }
  await db.update(schema.documentTypes).set(set).where(eq(schema.documentTypes.code, code));
  if (oldKey) await deleteUpload(oldKey).catch(() => {});
  await audit(user.id, "document_type.update", "document_type", code, { guidance: !!guidance, sample: set.sampleStorageKey !== undefined ? (set.sampleStorageKey ? "replaced" : "removed") : "unchanged" });
  revalidatePath("/admin/documents");
  return { ok: `${t.label} saved.` };
}
