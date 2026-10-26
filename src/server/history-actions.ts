"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, APP_ROLES, PARTNER_ROLES, isAdmin, worksStudentFiles } from "@/lib/permissions";
import { columnValue, fieldLabel, planFieldRestore, restoreRule, showValue, type HistoryEntity } from "@/lib/record-history";
import { getEnquiryForUser } from "@/server/enquiries";
import { getApplicationForUser, getStudentForUser } from "@/server/queries";
import { updateTracked } from "@/server/record-history";

/** Where to send somebody back to: only a history page, never an address from outside. */
function safeBack(raw: string, fallback: string) {
  return /^\/(students|enquiries)\/[A-Za-z0-9_-]+(\/applications\/[A-Za-z0-9_-]+)?\/history$/.test(raw) ? raw : fallback;
}

const withNote = (back: string, key: "done" | "why", text: string) => `${back}?${key}=${encodeURIComponent(text)}`;

/**
 * Whether this person may put a field back on this record: the same people
 * who may change that field on its own screen, on a record they may open.
 * Throws notFound for a record they may not open, as every other action does.
 */
async function mayRestore(user: SessionUser, entity: HistoryEntity, id: string, field: string): Promise<string | null> {
  if (entity === "student") {
    if (!worksStudentFiles(user)) return "Your role reads student files without changing them.";
    const student = await getStudentForUser(user, id);
    if (student.profileLocked && !isAdmin(user)) return "This profile is locked because an application was submitted. Use Request edit.";
    return null;
  }
  if (entity === "enquiry") {
    if (!([...PARTNER_ROLES, ...ADMIN_ROLES] as readonly string[]).includes(user.role)) return "Your role does not work enquiries.";
    await getEnquiryForUser(user, id);
    return null;
  }
  if (entity === "application") {
    await getApplicationForUser(user, id);
    // The same people as the field's own control: the vendor reference and
    // the deadline are the desk's, the priority is anybody's who works the file.
    if (field === "priority") return worksStudentFiles(user) ? null : "Your role reads applications without changing them.";
    return isAdmin(user) ? null : "Only the Overseas team changes this on an application.";
  }
  return "A staff account is corrected on the People screen.";
}

/**
 * Puts one field of one record back to what it was before one change.
 *
 * Only a field the history may restore (never assignment, branch, stage,
 * status, route or money), only while it still holds what that change gave
 * it, and only for somebody who could change it on its own screen. The row is
 * locked while this is decided and written, and the restore is itself a new
 * version, so it can be undone the same way.
 */
export async function restoreFieldAction(fd: FormData) {
  const user = await requireUser([...APP_ROLES]);
  const versionId = String(fd.get("versionId") ?? "");
  const field = String(fd.get("field") ?? "");
  const v = versionId ? await db.query.recordVersions.findFirst({ where: eq(schema.recordVersions.id, versionId) }) : undefined;
  if (!v) redirect("/admin/history");
  const entity = v.entity as HistoryEntity;
  const fallback =
    entity === "student" ? `/students/${v.entityId}/history` : entity === "enquiry" ? `/enquiries/${v.entityId}/history` : entity === "application" && v.studentId ? `/students/${v.studentId}/applications/${v.entityId}/history` : "/admin/history";
  const back = safeBack(String(fd.get("back") ?? ""), fallback);

  const change = v.changes.find((c) => c.field === field);
  if (!change) redirect(withNote(back, "why", "That change is no longer on record."));
  const rule = restoreRule(entity, field);
  if (!rule.ok) redirect(withNote(back, "why", rule.reason));
  const refused = await mayRestore(user, entity, v.entityId, field);
  if (refused) redirect(withNote(back, "why", refused));

  const table = entity === "student" ? schema.students : entity === "enquiry" ? schema.enquiries : schema.applications;
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(table).where(eq(table.id, v.entityId)).for("update");
    if (!current) return { why: "That record no longer exists." };
    const plan = planFieldRestore(entity, current as Record<string, unknown>, change);
    if (!plan.ok) return { why: plan.reason };
    await updateTracked(entity as "student", v.entityId, { [field]: columnValue(entity, field, plan.value), updatedAt: new Date() }, { by: user.id, action: "history.restore", tx });
    return { done: `${fieldLabel(entity, field)} is back to ${showValue(entity, field, plan.value, undefined, { fullPassport: false })}. The restore is saved as a new version, so it can be undone the same way.` };
  });
  if (outcome.done) {
    await audit(user.id, "history.restore", entity, v.entityId, { field, versionId });
    revalidatePath(back);
    if (entity === "student" || entity === "application") revalidatePath(`/students/${v.studentId ?? v.entityId}`, "layout");
    if (entity === "enquiry") revalidatePath(`/enquiries/${v.entityId}`);
    redirect(withNote(back, "done", outcome.done));
  }
  redirect(withNote(back, "why", outcome.why ?? "Nothing was changed."));
}
