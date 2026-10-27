"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { DESK_ASSIGNING_ROLES, DOCUMENTATION_ROLES } from "@/lib/permissions";
import { notifyUsers } from "@/server/notify";
import { getApplicationForUser } from "@/server/queries";
import { updateTracked } from "@/server/record-history";

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
  // The file has to be one this person may open, as everywhere else: the same
  // answer the list they pressed it on gave.
  const app = await getApplicationForUser(user, applicationId);
  if (app.officerId === officerId) return;

  if (officerId) {
    // Only somebody who works the desk can be given a file on it. A branch
    // counsellor in the list would be a file nobody at the office is carrying.
    const officer = await db.query.users.findFirst({ where: eq(schema.users.id, officerId), columns: { id: true, active: true, role: true } });
    if (!officer?.active) return;
    if (!(DOCUMENTATION_ROLES as readonly string[]).includes(officer.role)) return;
  }

  await updateTracked("application", applicationId, { officerId, updatedAt: new Date() }, { by: user.id, action: "application.officer" });
  await audit(user.id, "application.officer", "application", applicationId, { from: app.officerId, to: officerId });
  // notifyUsers asks whoMayOpenStudent before it writes anything, so an
  // officer the file is closed to is never sent a link to it.
  if (officerId && officerId !== user.id) {
    await notifyUsers([officerId], "An application is on your desk", app.ackNo, `/students/${app.studentId}/applications?app=${applicationId}`);
  }
  revalidatePath("/admin/queue");
  revalidatePath("/applications");
  revalidatePath("/dashboard");
  revalidatePath(`/students/${app.studentId}/applications`);
}
