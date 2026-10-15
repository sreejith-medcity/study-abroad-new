"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { isLocale, type Locale } from "@/lib/i18n";
import { notifyUsers } from "@/server/notify";
import { requireStudent, setPortalLocale } from "@/server/portal";

export type PortalState = { error?: string; ok?: string; redirectTo?: string };

export async function setLocaleAction(formData: FormData) {
  const { session } = await requireStudent();
  const locale = String(formData.get("locale"));
  if (!isLocale(locale)) return;
  await setPortalLocale(locale as Locale, session.id);
  revalidatePath("/portal", "layout");
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
