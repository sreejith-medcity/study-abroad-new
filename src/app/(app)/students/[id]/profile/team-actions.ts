"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { PARTNER_ROLES, STAFF_ROLES, STUDENT_WORK_ROLES, canAssignStudents, isStaff } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { teamToLead } from "@/server/teams";
import { notifyUsers } from "@/server/notify";
import { updateTracked } from "@/server/record-history";
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
  await updateTracked("student", studentId, { teamId, updatedAt: new Date() }, { by: user.id, action: "student.team" });
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
  // A branch may put its own people on its own students and nobody else.
  if (!isStaff(user) && person.orgId !== student.orgId) {
    return { error: "You can only put your own branch's people on a file." };
  }
  // The head office reaches wider, but only as far as a file opens: the
  // student's own branch and the head office itself. Somebody from another
  // branch cannot open the student (the scope rules check the organisation
  // first), so putting them on the file names a person who would then be left
  // out of every notice about it and see "page not found" from the one link
  // they were sent.
  if (!isStaff(person) && person.orgId !== student.orgId) {
    return { error: "Only people from the student's own branch or the head office can be put on this file." };
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
  // The list shows who shares each file now, so it has to be redrawn as well
  // as the file itself: this can be done from either.
  revalidatePath("/students");
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
  revalidatePath("/students");
}

/** What a team member given a file by their lead is on it for. */
const TEAM_PART = "Team";

/**
 * The team lead gives a team student to one of the team's members.
 *
 * Not the counsellor field: that is the branch's own person, and a team
 * member usually sits at another branch or the head office. So the member is
 * put on the file as its "Team" person, which every list and notice already
 * reads, and the student keeps their branch and counsellor. One member at a
 * time: giving it to somebody else takes the previous one off, though as a
 * member of the team they can still open it.
 */
export async function giveToTeamMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = clean(fd.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  const members = await teamToLead(user.id, student.teamId);
  if (!members.length) return { error: "Only the lead of the team carrying this file can give it to a team member." };
  const userId = clean(fd.get("userId"));
  const member = members.find((m) => m.id === userId);
  if (!member) return { error: "Pick somebody in the team." };
  const name = member.deskLabel ?? member.name;

  const current = await db.query.studentPeople.findMany({
    where: and(eq(schema.studentPeople.studentId, studentId), eq(schema.studentPeople.part, TEAM_PART)),
  });
  if (current.some((c) => c.userId === userId) && current.length === 1) return { error: `${name} already has this file for the team.` };
  await db.transaction(async (tx) => {
    await tx.delete(schema.studentPeople).where(and(eq(schema.studentPeople.studentId, studentId), eq(schema.studentPeople.part, TEAM_PART)));
    await tx.insert(schema.studentPeople).values({ studentId, userId, part: TEAM_PART, addedById: user.id });
  });
  await audit(user.id, "student.team_member", "student", studentId, { teamId: student.teamId, from: current.map((c) => c.userId), to: userId });
  if (userId !== user.id) {
    await notifyUsers([userId], "A team student for you", `${student.firstName} ${student.lastName}, from ${student.team?.name ?? "your team"}`, `/students/${studentId}/profile`);
  }
  revalidatePath(`/students/${studentId}`, "layout");
  revalidatePath("/students");
  return { ok: `${name} now has this file for the team.` };
}
