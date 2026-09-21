"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { isLocale, type Locale } from "@/lib/i18n";
import { notifyUsers } from "@/server/notify";
import { requireStudent, setPortalLocale } from "@/server/portal";
import { saveUpload, UploadError } from "@/server/storage";

export type PortalState = { error?: string; ok?: string; redirectTo?: string };

export async function setLocaleAction(formData: FormData) {
  const { session } = await requireStudent();
  const locale = String(formData.get("locale"));
  if (!isLocale(locale)) return;
  await setPortalLocale(locale as Locale, session.id);
  revalidatePath("/portal", "layout");
}

/** A student uploading one of their own documents. */
export async function portalUploadAction(_: PortalState, formData: FormData): Promise<PortalState> {
  const { session, student } = await requireStudent();
  const typeCode = String(formData.get("typeCode") || "");
  const file = formData.get("file");

  const type = await db.query.documentTypes.findFirst({ where: eq(schema.documentTypes.code, typeCode) });
  if (!type) return { error: "Pick what this document is." };
  if (type.uploadedBy === "team") return { error: "Medcity Overseas adds this one for you." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first." };

  try {
    const saved = await saveUpload(file, `students/${student.id}`);
    const [doc] = await db
      .insert(schema.documents)
      .values({ studentId: student.id, typeCode, fileName: file.name, uploadedById: session.id, ...saved })
      .returning();
    await audit(session.id, "document.upload", "document", doc.id, { typeCode, via: "portal" });
    await notifyUsers(
      [student.assignedToId, student.createdById],
      `${student.firstName} uploaded ${type.label}`,
      "Sent from the student portal",
      `/students/${student.id}/documents`,
    );
  } catch (e) {
    if (e instanceof UploadError) return { error: e.message };
    throw e;
  }
  // The row disappears from "still needed" once it is uploaded, and its inline
  // message would go with it, so confirm at the top of the page instead. The
  // form navigates there itself (see FormState.redirectTo), which also loads
  // the page fresh.
  return { redirectTo: `/portal/documents?uploaded=${encodeURIComponent(type.code)}` };
}

/** A message from the student, into the same thread the counsellor reads. */
export async function portalMessageAction(_: PortalState, formData: FormData): Promise<PortalState> {
  const { session, student } = await requireStudent();
  const applicationId = String(formData.get("applicationId") || "");
  const body = String(formData.get("body") || "").trim();
  if (body.length < 2) return { error: "Write your message first." };
  if (body.length > 2000) return { error: "That is too long. Please shorten it." };

  const application = await db.query.applications.findFirst({ where: eq(schema.applications.id, applicationId) });
  if (!application || application.studentId !== student.id) return { error: "That application is not yours." };

  await db.insert(schema.comments).values({
    applicationId: application.id,
    channel: "STUDENT",
    body,
    authorId: session.id,
    authorLabel: `${student.firstName} (portal)`,
  });
  await audit(session.id, "portal.message", "application", application.id, {});
  await notifyUsers(
    [student.assignedToId, student.createdById, application.officerId],
    `${student.firstName} sent a message`,
    body.slice(0, 120),
    `/students/${student.id}/applications?app=${application.id}`,
  );
  revalidatePath("/portal/messages");
  return { ok: "Sent." };
}
