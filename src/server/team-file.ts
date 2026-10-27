import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { notifyUsers } from "@/server/notify";
import { updateTracked } from "@/server/record-history";

/**
 * The two changes that give a student to a team, written once.
 *
 * The profile's "Team carrying this file", the team lead's "give to a team
 * member" and the student list's dropdown all do these, and three copies
 * would drift: one forgetting the audit line or the notice is how a file
 * changes hands with nobody told. Who may do it is checked by the caller.
 */

/** What a team member given a file is on it for. Every list and notice reads it. */
export const TEAM_PART = "Team";

/** Which team carries the file, or none. */
export async function setTeamOnStudent(actorId: string, student: { id: string; teamId: string | null }, teamId: string | null) {
  await updateTracked("student", student.id, { teamId, updatedAt: new Date() }, { by: actorId, action: "student.team" });
  await audit(actorId, "student.team", "student", student.id, { from: student.teamId, to: teamId });
}

/**
 * Puts one team member on the file as its "Team" person, taking off whoever
 * had that part before: one member at a time. Not the counsellor field,
 * which is the student's own branch's person; the member usually sits
 * somewhere else, and the student keeps their branch and counsellor.
 */
export async function giveFileToTeamMember(
  actorId: string,
  student: { id: string; firstName: string; lastName: string },
  team: { id: string; name: string },
  member: { id: string; name: string; deskLabel: string | null },
): Promise<{ ok: string } | { error: string }> {
  const name = member.deskLabel ?? member.name;
  const current = await db.query.studentPeople.findMany({
    where: and(eq(schema.studentPeople.studentId, student.id), eq(schema.studentPeople.part, TEAM_PART)),
  });
  if (current.some((c) => c.userId === member.id) && current.length === 1) return { error: `${name} already has this file for the team.` };
  await db.transaction(async (tx) => {
    await tx.delete(schema.studentPeople).where(and(eq(schema.studentPeople.studentId, student.id), eq(schema.studentPeople.part, TEAM_PART)));
    await tx.insert(schema.studentPeople).values({ studentId: student.id, userId: member.id, part: TEAM_PART, addedById: actorId });
  });
  await audit(actorId, "student.team_member", "student", student.id, { teamId: team.id, from: current.map((c) => c.userId), to: member.id });
  if (member.id !== actorId) {
    await notifyUsers([member.id], "A team student for you", `${student.firstName} ${student.lastName}, from ${team.name}`, `/students/${student.id}/profile`);
  }
  return { ok: `${name} now has this file for the team.` };
}
