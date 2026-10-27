"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, STUDENT_WORK_ROLES } from "@/lib/permissions";
import type { FormState } from "@/lib/form-state";
import { PATHWAY_LABEL } from "@/lib/catalogue";
import { applyTeamToExisting } from "@/server/team-pathways";

const clean = (v: FormDataEntryValue | null, max = 60) => String(v ?? "").trim().slice(0, max);

export async function createTeamAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const name = clean(fd.get("name"));
  if (!name) return { error: "Give the team a name." };
  const already = await db.query.teams.findFirst({ where: eq(schema.teams.name, name) });
  if (already) return { error: `There is already a team called ${already.name}.` };
  const [team] = await db
    .insert(schema.teams)
    .values({ name, note: clean(fd.get("note"), 200) || null })
    .returning();
  await audit(user.id, "team.create", "team", team.id, { name });
  revalidatePath("/admin/teams");
  return { ok: `${name} added.` };
}

export async function renameTeamAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const teamId = clean(fd.get("teamId"), 40);
  const name = clean(fd.get("name"));
  if (!teamId || !name) return;
  await db.update(schema.teams).set({ name, note: clean(fd.get("note"), 200) || null }).where(eq(schema.teams.id, teamId));
  await audit(user.id, "team.rename", "team", teamId, { name });
  revalidatePath("/admin/teams");
}

/**
 * A team is retired rather than deleted: files that were carried by it keep
 * saying so, and a name that meant something last year still reads.
 */
export async function toggleTeamAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const teamId = clean(fd.get("teamId"), 40);
  const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, teamId) });
  if (!team) return;
  await db.update(schema.teams).set({ active: !team.active }).where(eq(schema.teams.id, teamId));
  await audit(user.id, team.active ? "team.retire" : "team.restore", "team", teamId, { name: team.name });
  revalidatePath("/admin/teams");
}

/**
 * A team nothing has used yet is a mistake, and a mistake should be removable.
 *
 * Retiring is right for a team that carried work: the files it carried still
 * say so, and a name that meant something last year still reads. It is no use
 * at all for "NCLEX RN processesing", typed twice by somebody setting the
 * portal up, with nobody in it and nothing on it. Those cluttered the screen
 * with no way to clear them.
 *
 * So: empty and unused can go for good, anything else can only be retired.
 * The screen offers whichever applies, and this checks again rather than
 * trusting it, because a form can be posted by hand.
 */
export async function deleteTeamAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const teamId = clean(fd.get("teamId"), 40);
  const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, teamId) });
  if (!team) return;
  const [{ carried }] = await db.select({ carried: count() }).from(schema.students).where(eq(schema.students.teamId, teamId));
  const [{ members }] = await db.select({ members: count() }).from(schema.teamMembers).where(eq(schema.teamMembers.teamId, teamId));
  if (carried > 0 || members > 0) return;
  await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  await audit(user.id, "team.delete", "team", teamId, { name: team.name });
  revalidatePath("/admin/teams");
}

export async function addTeamMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const teamId = clean(fd.get("teamId"), 40);
  const userId = clean(fd.get("userId"), 40);
  if (!teamId || !userId) return { error: "Pick somebody to add." };
  const already = await db.query.teamMembers.findFirst({
    where: and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)),
  });
  if (already) return { error: "They are already in this team." };
  // A member opens every file the team carries, so only somebody who works
  // students' files, at the head office or a branch, can be one.
  const person = await db.query.users.findFirst({ where: eq(schema.users.id, userId), with: { org: { columns: { type: true } } } });
  if (!person?.active || !(STUDENT_WORK_ROLES as readonly string[]).includes(person.role) || person.org?.type === "SUB_AGENT") {
    return { error: "That person cannot be put in a team." };
  }
  await db.insert(schema.teamMembers).values({ teamId, userId, lead: fd.get("lead") === "1" });
  await audit(user.id, "team.member.add", "team", teamId, { userId });
  revalidatePath("/admin/teams");
  return { ok: "Added to the team." };
}

export async function removeTeamMemberAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = clean(fd.get("memberId"), 40);
  const row = await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, id) });
  if (!row) return;
  await db.delete(schema.teamMembers).where(eq(schema.teamMembers.id, id));
  await audit(user.id, "team.member.remove", "team", row.teamId, { userId: row.userId });
  revalidatePath("/admin/teams");
}

export async function setTeamLeadAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = clean(fd.get("memberId"), 40);
  const row = await db.query.teamMembers.findFirst({ where: eq(schema.teamMembers.id, id) });
  if (!row) return;
  await db.update(schema.teamMembers).set({ lead: !row.lead }).where(eq(schema.teamMembers.id, id));
  await audit(user.id, "team.member.lead", "team", row.teamId, { userId: row.userId, lead: !row.lead });
  revalidatePath("/admin/teams");
}

/**
 * The pathways a team carries. A student who gets one of them, at
 * registration or with an application, and is not on a team yet, goes on this
 * team whichever branch registered them. The form sends the whole set each
 * time, so what is ticked is what is kept.
 */
export async function setTeamPathwaysAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const teamId = clean(fd.get("teamId"), 40);
  const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, teamId), with: { pathways: true } });
  if (!team) return;
  const known = schema.pathway.enumValues as readonly string[];
  const wanted = [...new Set(fd.getAll("pathway").map(String))].filter((p) => known.includes(p)) as schema.Pathway[];
  const had = team.pathways.map((p) => p.pathway);
  await db.transaction(async (tx) => {
    await tx.delete(schema.teamPathways).where(eq(schema.teamPathways.teamId, teamId));
    if (wanted.length) await tx.insert(schema.teamPathways).values(wanted.map((pathway) => ({ teamId, pathway })));
  });
  await audit(user.id, "team.pathways", "team", teamId, { from: had, to: wanted });
  revalidatePath("/admin/teams");
}

/**
 * Puts the files already in the portal on this team, by the same rule a new
 * registration follows: no team yet, never one chosen by hand, and this team
 * the only live one carrying their pathway. Run once when a team starts
 * carrying a pathway; running it again only finds what has arrived since.
 */
export async function applyTeamToExistingAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const teamId = clean(fd.get("teamId"), 40);
  const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, teamId), with: { pathways: true } });
  if (!team) return { error: "That team is not there any more." };
  if (!team.active) return { error: "A retired team does not take on files. Put it back first." };
  if (!team.pathways.length) return { error: "Tick the pathways this team carries and save them first." };
  const placed = await applyTeamToExisting(teamId, user.id);
  await audit(user.id, "team.apply_existing", "team", teamId, { placed, pathways: team.pathways.map((p) => p.pathway) });
  revalidatePath("/admin/teams");
  revalidatePath("/students");
  const what = team.pathways.map((p) => PATHWAY_LABEL[p.pathway] ?? p.pathway).join(", ");
  return placed === 0
    ? { ok: `No files to add: every ${what} student either has a team already, had one chosen by hand, or another team carries the same pathway.` }
    : { ok: `${placed} ${placed === 1 ? "student" : "students"} put on ${team.name}.` };
}
