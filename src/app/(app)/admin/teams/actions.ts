"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import type { FormState } from "@/lib/form-state";

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
