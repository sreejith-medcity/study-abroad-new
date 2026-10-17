"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { DESK_ASSIGNING_ROLES, DESK_OFFICER_ROLES } from "@/lib/permissions";
import { notifyUsers } from "@/server/notify";

/**
 * Putting an application on an officer's desk.
 *
 * The officer field used to fill itself in with whoever first moved the file,
 * which meant nobody was ever given one: an application sat in the shared
 * "unassigned" pile until somebody happened to pick it up, and the team leader,
 * whose whole job is deciding who carries what, had no control to do it with.
 */
export async function assignOfficerAction(fd: FormData) {
  const user = await requireUser([...DESK_ASSIGNING_ROLES]);
  const applicationId = String(fd.get("applicationId") ?? "");
  const officerId = String(fd.get("officerId") ?? "") || null;
  const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, applicationId) });
  if (!app) return;
  if (app.officerId === officerId) return;

  if (officerId) {
    // Only somebody who works the desk can be given a file on it. A branch
    // counsellor in the list would be a file nobody at the office is carrying.
    const officer = await db.query.users.findFirst({ where: eq(schema.users.id, officerId), columns: { id: true, active: true, role: true } });
    if (!officer?.active) return;
    if (!(DESK_OFFICER_ROLES as readonly string[]).includes(officer.role)) return;
  }

  await db.update(schema.applications).set({ officerId, updatedAt: new Date() }).where(eq(schema.applications.id, applicationId));
  await audit(user.id, "application.officer", "application", applicationId, { from: app.officerId, to: officerId });
  if (officerId && officerId !== user.id) {
    await notifyUsers([officerId], "An application is on your desk", app.ackNo, `/students/${app.studentId}/applications?app=${applicationId}`);
  }
  revalidatePath("/admin/queue");
  revalidatePath("/applications");
  revalidatePath(`/students/${app.studentId}/applications`);
}
