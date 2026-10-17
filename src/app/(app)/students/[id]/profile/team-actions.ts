"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { PARTNER_ROLES, STAFF_ROLES, STUDENT_WORK_ROLES, canAssignStudents, isStaff } from "@/lib/permissions";
import { orgUsers } from "@/server/queries";
import { getStudentForUser } from "@/server/queries";
import type { FormState } from "@/lib/form-state";

const clean = (v: FormDataEntryValue | null, max = 40) => String(v ?? "").trim().slice(0, max);

/** Which part of the business carries this file. */
export async function setStudentTeamAction(fd: FormData) {
  const user = await requireUser([...STAFF_ROLES]);
  if (!canAssignStudents(user)) return;
  const studentId = clean(fd.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  const teamId = clean(fd.get("teamId")) || null;
  if (teamId) {
    const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, teamId) });
    if (!team) return;
  }
  await db.update(schema.students).set({ teamId, updatedAt: new Date() }).where(eq(schema.students.id, studentId));
  await audit(user.id, "student.team", "student", studentId, { from: student.teamId, to: teamId });
  revalidatePath(`/students/${studentId}`, "layout");
}

/**
 * Somebody else with a part in this file. The counsellor it belongs to is the
 * assignment; this is everybody working on it beside them, each with what they
 * do written next to their name.
 */
export async function addPersonToFileAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STAFF_ROLES, ...PARTNER_ROLES]);
  if (!canAssignStudents(user)) return { error: "Your account cannot change who is on a file." };
  const studentId = clean(fd.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  const userId = clean(fd.get("userId"));
  const part = String(fd.get("part") ?? "").trim().slice(0, 40);
  if (!userId) return { error: "Pick somebody." };
  if (!part) return { error: "Say what they do on this file: documents, visa, ticketing." };

  const person = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!person?.active || !(STUDENT_WORK_ROLES as readonly string[]).includes(person.role)) {
    return { error: "That person cannot be put on a student's file." };
  }
  // A branch may put its own people on its own students and nobody else. The
  // head office reaches wider, which is the rule the assignment control on
  // the list has always followed.
  if (!isStaff(user) && person.orgId !== student.orgId) {
    return { error: "You can only put your own branch's people on a file." };
  }
  const already = await db.query.studentPeople.findFirst({
    where: and(
      eq(schema.studentPeople.studentId, studentId),
      eq(schema.studentPeople.userId, userId),
      eq(schema.studentPeople.part, part),
    ),
  });
  if (already) return { error: `${person.deskLabel ?? person.name} is already on this file for ${part}.` };

  await db.insert(schema.studentPeople).values({ studentId, userId, part, addedById: user.id });
  await audit(user.id, "student.person.add", "student", studentId, { userId, part });
  revalidatePath(`/students/${studentId}`, "layout");
  return { ok: `${person.deskLabel ?? person.name} added for ${part}.` };
}

export async function removePersonFromFileAction(fd: FormData) {
  const user = await requireUser([...STAFF_ROLES, ...PARTNER_ROLES]);
  if (!canAssignStudents(user)) return;
  const id = clean(fd.get("personId"));
  const row = await db.query.studentPeople.findFirst({ where: eq(schema.studentPeople.id, id) });
  if (!row) return;
  await getStudentForUser(user, row.studentId);
  await db.delete(schema.studentPeople).where(eq(schema.studentPeople.id, id));
  await audit(user.id, "student.person.remove", "student", row.studentId, { userId: row.userId, part: row.part });
  revalidatePath(`/students/${row.studentId}`, "layout");
}
