"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { DEADLINE_EDIT_ROLES, PROCESSING_ROLES } from "@/lib/permissions";
import { DEADLINE_LABEL } from "@/lib/deadline-types";
import { dayText } from "@/lib/catalogue";
import { getApplicationForUser } from "@/server/queries";
import { notifyUsers, partnerRecipients } from "@/server/notify";

const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Moving an institution's deadline from the list it is read on.
 *
 * Until now the only way to change one was to open the program in the admin
 * catalogue, which the application team leader cannot reach, and then re-enter
 * the whole row. A university moving a date by a week is an ordinary Tuesday.
 */
export async function moveProgramDeadlineAction(fd: FormData) {
  const user = await requireUser([...DEADLINE_EDIT_ROLES]);
  const id = String(fd.get("id") ?? "");
  const deadline = String(fd.get("deadline") ?? "");
  if (!isDate(deadline)) return;
  const d = schema.programDeadlines;
  const row = await db.query.programDeadlines.findFirst({ where: eq(d.id, id) });
  if (!row) return;
  if (row.deadline === deadline) return;
  // A deadline after the intake month has been and gone is a typo in the year,
  // the same check the catalogue form makes.
  const [dy, dm] = deadline.split("-").map(Number);
  if (dy * 12 + dm > row.intakeYear * 12 + row.intakeMonth) return;
  await db.update(d).set({ deadline, createdById: user.id }).where(eq(d.id, id));
  await audit(user.id, "program.deadline", "program", row.programId, { intake: `${row.intakeMonth}/${row.intakeYear}`, from: row.deadline, to: deadline });
  revalidatePath("/deadlines");
  revalidatePath(`/admin/programs/${row.programId}`);
}

/**
 * Moving a milestone on one application: pay by, CAS by, accept by. The branch
 * is told, because the date they were working to has changed under them.
 */
export async function moveApplicationDeadlineAction(fd: FormData) {
  const user = await requireUser([...PROCESSING_ROLES]);
  const id = String(fd.get("id") ?? "");
  const dueOn = String(fd.get("dueOn") ?? "");
  if (!isDate(dueOn)) return;
  const d = schema.applicationDeadlines;
  const row = await db.query.applicationDeadlines.findFirst({ where: eq(d.id, id) });
  if (!row) return;
  if (row.dueOn === dueOn) return;
  const app = await getApplicationForUser(user, row.applicationId);
  await db.update(d).set({ dueOn }).where(eq(d.id, id));
  await audit(user.id, "application.deadline_move", "application", app.id, { type: row.type, from: row.dueOn, to: dueOn });
  const student = await db.query.students.findFirst({ where: eq(schema.students.id, app.studentId), columns: { assignedToId: true } });
  await notifyUsers(
    await partnerRecipients(app.orgId, student?.assignedToId),
    `${app.ackNo}: ${DEADLINE_LABEL[row.type]} moved to ${dayText(dueOn)}`,
    `It was ${dayText(row.dueOn)}.`,
    `/students/${app.studentId}/applications?app=${app.id}`,
  );
  revalidatePath("/deadlines");
  revalidatePath(`/students/${app.studentId}/applications`);
}
