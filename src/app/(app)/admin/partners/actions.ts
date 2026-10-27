"use server";

import { seatFree } from "@/lib/seats";
import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser, type SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { departmentChoice } from "@/lib/departments";
import { emailProblem, emailTakenMessage, mayMovePerson, moveSummary, normalizeEmail, planMove, roleFitRefusal, roleFitsOrg, taskTaker, type EmailHolder, type OrgType } from "@/lib/people";
import { ADMIN_ROLES, HQ_ROLES, PARTNER_ROLES, ROLE_LABEL, canManageSuperAdmins, canManageUsers, canResetPasswords, isFamilyRole } from "@/lib/permissions";
import { emailHolder, moveLink } from "@/server/email-holder";
import { notifyUsers } from "@/server/notify";
import { makeSlug } from "@/server/public-form";
import { orgIsUntouched } from "@/server/org-untouched";
import { departments, getSettings } from "@/server/settings";
import { updateTracked, updateTrackedMany } from "@/server/record-history";
import { moveStudents } from "@/server/student-move";

import type { FormState } from "@/lib/form-state";
export type { FormState };

function tempPassword() {
  return `Mc-${randomBytes(6).toString("base64url")}`;
}

const invite = z.object({
  orgName: z.string().trim().min(2, "Organisation name is required").max(120),
  type: z.enum(["BRANCH", "SUB_AGENT"]),
  city: z.string().trim().max(60).optional(),
  tier: z.enum(schema.tier.enumValues),
  ownerName: z.string().trim().min(2, "Owner name is required").max(100),
  ownerEmail: z.string().trim().toLowerCase().email("Enter a valid email"),
  ownerPhone: z.string().trim().max(20).optional(),
});

const SEATS = { SILVER: 3, GOLD: 5, ELITE: 8, PLATINUM: 15 } as const;

export async function invitePartnerAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = invite.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const holder = await emailHolder(d.ownerEmail);
  if (holder) return takenAnswer(user, holder, "ownerEmail");

  const password = tempPassword();
  const passwordHash = await hashPassword(password);
  const org = await db.transaction(async (tx) => {
    const [org] = await tx.insert(schema.organizations).values({ name: d.orgName, type: d.type, city: d.city || null, tier: d.tier, counsellorSeats: SEATS[d.tier], relationshipManagerId: user.id }).returning();
    await tx.insert(schema.users).values({ name: d.ownerName, email: d.ownerEmail, phone: d.ownerPhone || null, role: "PARTNER", orgId: org.id, passwordHash });
    return org;
  });
  await audit(user.id, "partner.invite", "organization", org.id, { ownerEmail: d.ownerEmail });
  revalidatePath("/admin/partners");
  return { keep: true, ok: `${d.orgName} created. Sign-in details for ${d.ownerEmail}: ${password}` };
}

const addUser = z.object({
  orgId: z.string().min(1),
  name: z.string().trim().min(2, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  deskLabel: z.string().trim().max(60).optional(),
  department: z.string().trim().max(60).optional(),
  // Every role the screen offers, built from the lists rather than typed out:
  // the typed list had fallen behind and refused the desk counsellor, the
  // application team leader and finance with a schema error.
  role: z.enum([...PARTNER_ROLES, ...HQ_ROLES]),
});

/** Postgres refusing a row because another already holds the same unique value. */
const uniqueViolation = (e: unknown) => (e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505";

/**
 * The refusal for an address that is already somebody's sign-in, said the way
 * emailTakenMessage decides: who has it and where, and, when this person may
 * move them to where the new account was meant to be, a link to do that
 * instead. `to` is the organisation and role the desk was adding somebody as;
 * left out (an edit), the link opens their move form with nothing chosen.
 */
function takenAnswer(actor: SessionUser, holder: EmailHolder, field: string, to?: { orgId: string; type: OrgType; role: string }): FormState {
  const allowed =
    holder.org.id !== to?.orgId &&
    mayMovePerson({
      actor: { id: actor.id, role: actor.role, managesUsers: canManageUsers(actor), managesSuperAdmins: canManageSuperAdmins(actor) },
      person: { id: holder.id, role: holder.role, orgType: holder.org.type },
      toType: to?.type ?? holder.org.type,
      role: to && roleFitsOrg(to.role, to.type) ? to.role : undefined,
    }).ok;
  const said = emailTakenMessage(holder, { orgId: actor.orgId, seesEveryOrg: true }, { mayMove: allowed });
  return {
    error: said.text,
    fieldErrors: { [field]: ["Already in use"] },
    ...(allowed ? { link: { href: moveLink(holder.id, to ? { orgId: to.orgId, role: to.role } : undefined), label: `Move ${holder.name}${to ? " here" : ""}` } } : {}),
  };
}

export async function addUserAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = addUser.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, d.orgId) });
  if (!org) return { error: "Organisation not found." };
  if (org.type === "HQ" && !(HQ_ROLES as readonly string[]).includes(d.role)) {
    // Built from the list rather than typed out, so it cannot say something
    // different from what is actually allowed, which is what it used to do.
    return { error: `A Medcity Overseas user is one of: ${HQ_ROLES.map((r) => ROLE_LABEL[r] ?? r).join(", ")}.` };
  }
  if (d.role === "SUPER_ADMIN" && !canManageSuperAdmins(user)) {
    return { error: "Only a super admin can create another super admin." };
  }
  if (org.type === "HQ" && !canManageUsers(user)) {
    return { error: "Only a super admin can create Medcity Overseas staff accounts." };
  }
  if (org.type !== "HQ" && !(PARTNER_ROLES as readonly string[]).includes(d.role)) return { error: "A partner's people are a branch head or one of the counsellor roles." };
  if (!roleFitsOrg(d.role, org.type)) return { error: roleFitRefusal(d.role, org.type) };
  const holder = await emailHolder(d.email);
  if (holder) return takenAnswer(user, holder, "email", { orgId: org.id, type: org.type, role: d.role });
  const dept = departmentChoice(d.department, departments(await getSettings()));
  if (!dept.ok) return { error: dept.error, fieldErrors: { department: [dept.error] } };

  if (org.type !== "HQ") {
    const [{ n }] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.orgId, org.id), eq(schema.users.active, true), inArray(schema.users.role, [...PARTNER_ROLES])));
    if (!seatFree(org, n)) return { error: `${org.name} has used all ${org.counsellorSeats} seats for its tier.` };
  }

  const password = tempPassword();
  const [created] = await db
    .insert(schema.users)
    .values({ name: d.name, email: d.email, deskLabel: d.deskLabel || null, department: dept.department, role: d.role, orgId: org.id, passwordHash: await hashPassword(password) })
    .returning();
  await audit(user.id, "user.create", "user", created.id, { orgId: org.id, role: d.role, department: dept.department });
  revalidatePath("/admin/partners");
  return { keep: true, ok: `User added. Temporary password for ${d.email}: ${password}` };
}

export async function updateOrgAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const orgId = String(formData.get("orgId"));
  const tier = String(formData.get("tier")) as (typeof schema.tier.enumValues)[number];
  const seats = Number(formData.get("counsellorSeats"));
  const rm = String(formData.get("relationshipManagerId") || "") || null;
  // Whether this branch does its own first pass on documents. Medcity's call,
  // not the branch's, so it is set here rather than on the branch's own screen.
  const checksOwn = String(formData.get("checksOwnDocuments") || "") === "1";
  if (!schema.tier.enumValues.includes(tier) || !Number.isInteger(seats) || seats < 1 || seats > 500) return;

  // The branch's letters can be set until the first student carries them. After
  // that the code is on IDs the family already has written down, so it stays.
  const typed = String(formData.get("idCode") || "").trim().toUpperCase();
  const code = /^[A-Z]{2}[A-Z0-9]{0,2}$/.test(typed) ? typed : null;
  let idCode: string | null | undefined;
  if (code) {
    const [{ issued }] = await db
      .select({ issued: count() })
      .from(schema.students)
      .where(and(eq(schema.students.orgId, orgId), isNotNull(schema.students.medcityId)));
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
    if (issued === 0 && org?.idCode !== code) idCode = code;
  }

  try {
    await db
      .update(schema.organizations)
      .set({ tier, counsellorSeats: seats, relationshipManagerId: rm, checksOwnDocuments: checksOwn, ...(idCode ? { idCode } : {}) })
      .where(eq(schema.organizations.id, orgId));
  } catch {
    // Another branch already holds those letters. Everything else is still saved.
    await db
      .update(schema.organizations)
      .set({ tier, counsellorSeats: seats, relationshipManagerId: rm, checksOwnDocuments: checksOwn })
      .where(eq(schema.organizations.id, orgId));
  }
  await audit(user.id, "organization.update", "organization", orgId, { tier, seats, rm, ...(idCode ? { idCode } : {}) });
  revalidatePath("/admin/partners");
}

/**
 * Closing a branch, and opening one again.
 *
 * A branch that has stopped is not a branch that never was: its students,
 * its applications and its commission all stay exactly where they are, and
 * every screen that reads them keeps reading them. What changes is that it
 * is no longer offered on a new student, its public enquiry form and test
 * preparation page stop answering, and it is out of the lists people pick
 * from. The database has understood this since the branch table was written
 * and nothing in the portal could ever say it, so a branch that closed was
 * in every dropdown forever.
 */
export async function toggleOrgActiveAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const orgId = String(formData.get("orgId"));
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org || org.type === "HQ") return;
  await db.update(schema.organizations).set({ active: !org.active }).where(eq(schema.organizations.id, orgId));
  await audit(user.id, org.active ? "organization.close" : "organization.reopen", "organization", orgId, { name: org.name });
  revalidatePath("/admin/partners");
}

/**
 * A branch nothing has touched is a mistake, and a mistake should be
 * removable. The same rule as a team: added by somebody setting the portal
 * up, never used, and otherwise in every list for good.
 *
 * Untouched means no students, no enquiries and nobody who has ever signed
 * in. Its accounts go with it, because an account nobody has ever used is
 * part of the same mistake. Anything beyond that and the delete is refused
 * and the branch is closed instead, which keeps everything.
 *
 * The last word is the database's rather than this list's: all but four of
 * the tables that point at a branch refuse to let it go, and those four are
 * the branch's own working notes, which mean nothing without it. So the
 * delete runs inside a transaction and a refusal rolls the whole thing back.
 */
export async function deleteOrgAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const orgId = String(formData.get("orgId"));
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org || org.type === "HQ") return;
  if (!(await orgIsUntouched(orgId))) return;
  try {
    await db.transaction(async (tx) => {
      await tx.delete(schema.users).where(eq(schema.users.orgId, orgId));
      await tx.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    });
  } catch {
    // Something still points at it that this did not think to look for. The
    // branch is untouched, so nothing is lost by leaving it alone and saying
    // nothing: the screen will still offer to close it.
    return;
  }
  await audit(user.id, "organization.delete", "organization", orgId, { name: org.name, type: org.type });
  revalidatePath("/admin/partners");
}

export async function toggleUserAction(formData: FormData) {
  const actor = await requireUser([...ADMIN_ROLES]);
  const userId = String(formData.get("userId"));
  if (userId === actor.id) return;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) return;
  // Only a super admin may switch off another Medcity Overseas account.
  if ((HQ_ROLES as readonly string[]).includes(u.role) && !canManageUsers(actor)) return;
  await updateTracked("user", userId, { active: !u.active }, { by: actor.id, action: u.active ? "user.deactivate" : "user.activate" });
  await audit(actor.id, u.active ? "user.deactivate" : "user.activate", "user", userId, { email: u.email, role: u.role });
  revalidatePath("/admin/partners");
}

/** Super admin only: move a user between roles, inside the rules for their organisation. */
export async function changeRoleAction(_: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser([...ADMIN_ROLES]);
  if (!canManageUsers(actor)) return { error: "Only a super admin can change roles." };
  const userId = String(formData.get("userId"));
  const role = String(formData.get("role")) as (typeof schema.role.enumValues)[number];
  // A family sign-in is not a role somebody is promoted into: both are created
  // from the student's own file, against one student, and nowhere else.
  if (!schema.role.enumValues.includes(role) || isFamilyRole(role)) return { error: "Pick a valid role." };

  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId), with: { org: true } });
  if (!target) return { error: "User not found." };
  if (target.id === actor.id) return { error: "Ask another super admin to change your own role." };

  const hq = target.org.type === "HQ";
  if (hq && !(HQ_ROLES as readonly string[]).includes(role)) {
    return { error: "Medcity Overseas staff can be Super admin, Ops manager, Overseas admin, Documentation team or Management." };
  }
  if (!hq && !(PARTNER_ROLES as readonly string[]).includes(role)) return { error: "A partner's people are a branch head or one of the counsellor roles." };
  if ((role === "SUPER_ADMIN" || target.role === "SUPER_ADMIN") && !canManageSuperAdmins(actor)) {
    return { error: "Only a super admin can add or remove another super admin." };
  }

  if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN") {
    const [{ n }] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.role, "SUPER_ADMIN"), eq(schema.users.active, true)));
    if (n <= 1) return { error: "Keep at least one active super admin." };
  }

  await updateTracked("user", userId, { role }, { by: actor.id, action: "user.role_change" });
  await audit(actor.id, "user.role_change", "user", userId, { email: target.email, from: target.role, to: role });
  revalidatePath("/admin/partners");
  return { ok: `${target.name} is now ${ROLE_LABEL[role]}.` };
}

/** Super admin only: issue a one-time password that the user must change at sign in. */
export async function resetPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser([...ADMIN_ROLES]);
  if (!canResetPasswords(actor)) return { error: "Only a super admin can reset passwords." };
  const userId = String(formData.get("userId"));
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!target) return { error: "User not found." };

  const password = tempPassword();
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, passwordUpdatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  await audit(actor.id, "user.password_reset", "user", userId, { email: target.email });
  revalidatePath("/admin/partners");
  return { keep: true, ok: `Temporary password for ${target.email}: ${password}. They must change it at sign in.` };
}

/**
 * Opens or closes a branch's public enquiry form. The slug is generated once
 * and then kept, so a printed QR code never stops working.
 */
export async function togglePublicFormAction(formData: FormData) {
  const actor = await requireUser([...ADMIN_ROLES]);
  const orgId = String(formData.get("orgId"));
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org || org.type === "HQ") return;

  const slug = org.publicSlug ?? makeSlug(org.name);
  await db
    .update(schema.organizations)
    .set({ publicSlug: slug, publicFormEnabled: !org.publicFormEnabled })
    .where(eq(schema.organizations.id, orgId));
  await audit(actor.id, org.publicFormEnabled ? "org.public_form_off" : "org.public_form_on", "organization", orgId, { slug });
  revalidatePath("/admin/partners");
}

/** A fresh slug when a printed code has to be retired, for example after a leak. */
export async function resetPublicSlugAction(formData: FormData) {
  const actor = await requireUser([...ADMIN_ROLES]);
  const orgId = String(formData.get("orgId"));
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId) });
  if (!org || org.type === "HQ") return;
  const slug = makeSlug(org.name);
  await db.update(schema.organizations).set({ publicSlug: slug }).where(eq(schema.organizations.id, orgId));
  await audit(actor.id, "org.public_slug_reset", "organization", orgId, { from: org.publicSlug, to: slug });
  revalidatePath("/admin/partners");
}

/**
 * Who the head office may edit: anybody but themselves (their own details are
 * on Settings), and Medcity Overseas staff only when they manage users, the
 * same line toggleUserAction draws.
 */
async function editableByDesk(actor: SessionUser, userId: string) {
  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId), with: { org: true } });
  if (!target) return { error: "User not found." as const };
  if (isFamilyRole(target.role)) return { error: "A student or parent sign-in is managed from the student's file." as const };
  if ((HQ_ROLES as readonly string[]).includes(target.role) && !canManageUsers(actor)) {
    return { error: "Only a super admin or an ops manager can edit Medcity Overseas staff." as const };
  }
  return { target };
}

const editUser = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2, "Name is required").max(100),
  email: z.string().trim().max(254),
  deskLabel: z.string().trim().max(60).optional(),
  department: z.string().trim().max(60).optional(),
});

/**
 * A person's name, sign-in email, job title and department.
 *
 * The account keeps its id, so everything it has done stays its own. A new
 * email ends their sessions, so they sign in again with the address that now
 * works, and they are told so in a notice they read when they do.
 */
export async function editUserAction(_: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser([...ADMIN_ROLES]);
  const parsed = editUser.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (d.userId === actor.id) return { error: "Your own name and email are on Settings." };
  const found = await editableByDesk(actor, d.userId);
  if ("error" in found) return { error: found.error };
  const target = found.target;

  const email = normalizeEmail(d.email);
  const problem = emailProblem(email);
  if (problem) return { error: "Check the highlighted fields.", fieldErrors: { email: [problem] } };
  const holder = email !== target.email.toLowerCase() ? await emailHolder(email, target.id) : null;
  if (holder) return takenAnswer(actor, holder, "email");
  const dept = departmentChoice(d.department, departments(await getSettings()), target.department);
  if (!dept.ok) return { error: dept.error, fieldErrors: { department: [dept.error] } };

  const deskLabel = d.deskLabel || null;
  const emailChanged = email !== target.email;
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  if (d.name !== target.name) changes.name = { from: target.name, to: d.name };
  if (emailChanged) changes.email = { from: target.email, to: email };
  if (deskLabel !== target.deskLabel) changes.deskLabel = { from: target.deskLabel, to: deskLabel };
  if (dept.department !== target.department) changes.department = { from: target.department, to: dept.department };
  if (Object.keys(changes).length === 0) return { ok: "Nothing changed." };

  try {
    await updateTracked(
      "user",
      target.id,
      {
        name: d.name,
        email,
        deskLabel,
        department: dept.department,
        // Bumped in the database rather than from the row read earlier, so two
        // bumps landing at once cannot write the same number and keep a
        // session alive that both meant to end.
        ...(emailChanged ? { sessionVersion: sql`${schema.users.sessionVersion} + 1` } : {}),
      },
      { by: actor.id, action: "user.edit" },
    );
  } catch (e) {
    // Somebody took the address between the check above and this write. The
    // same answer as the check gives, rather than a dead screen.
    if (uniqueViolation(e)) {
      const late = await emailHolder(email, target.id);
      return late ? takenAnswer(actor, late, "email") : { error: "Somebody else already signs in with that email.", fieldErrors: { email: ["Already in use"] } };
    }
    throw e;
  }
  await audit(actor.id, "user.edit", "user", target.id, { email: target.email, changes });
  if (emailChanged) {
    await notifyUsers([target.id], "Your sign-in email changed", `From now on, sign in with ${email}. The old address, ${target.email}, no longer signs in.`, "/settings");
  }
  revalidatePath("/admin/partners");
  return { ok: emailChanged ? `Saved. ${d.name} now signs in with ${email}, and has been signed out to do so.` : `Saved ${d.name}'s details.` };
}

const moveUser = z.object({
  userId: z.string().min(1),
  toOrgId: z.string().min(1),
  role: z.string().optional(),
  // Sent by the move form; left out, the title is kept unless the role changes.
  deskLabel: z.string().trim().max(60).optional(),
  studentsChoice: z.string().optional(),
  handToId: z.string().optional(),
});

/**
 * Moves a person to another organisation, in a new role when asked: a branch,
 * a sub-agent firm, or the head office and back.
 *
 * Their students do not go with them: a student belongs to the branch that
 * registered them, and a counsellor who leaves it could not open those files
 * from the new one. So the students are handed to a named colleague where
 * they are leaving, or left with nobody there, and the person is taken off
 * every file there they were named on. All of it in one transaction, so a
 * refusal part way leaves nothing half moved.
 *
 * Somebody leaving the head office worked files at every branch, so what they
 * hand over is everything on their name, wherever it is, and their open tasks
 * go with the students, there being no branch head at the head office to fall
 * back on. The desk-only things go too, because they mean nothing at a branch:
 * their teams, the request types that land on them, and their name as officer
 * on applications still open. Their department stays: it is a line of the
 * business (Ausbildung, NCLEX-RN), as true at a branch as at the desk. Their
 * job title is what the form says, and when the role changes and nothing is
 * said, the old one is cleared rather than left describing a job they no
 * longer do.
 */
export async function moveUserAction(_: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser([...ADMIN_ROLES]);
  const parsed = moveUser.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (d.userId === actor.id) return { error: "Ask another admin to move you." };
  const found = await editableByDesk(actor, d.userId);
  if ("error" in found) return { error: found.error };
  const target = found.target;

  const to = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, d.toOrgId) });
  if (!to) return { error: "Organisation not found." };
  const role = (d.role || target.role) as (typeof schema.role.enumValues)[number];
  if (!schema.role.enumValues.includes(role)) return { error: "Pick a valid role." };
  const allowed = mayMovePerson({
    actor: { id: actor.id, role: actor.role, managesUsers: canManageUsers(actor), managesSuperAdmins: canManageSuperAdmins(actor) },
    person: { id: target.id, role: target.role, orgType: target.org.type },
    toType: to.type,
    role,
  });
  if (!allowed.ok) return { error: allowed.error };
  if (target.role === "SUPER_ADMIN" && role !== "SUPER_ADMIN" && target.active) {
    const [{ n }] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.role, "SUPER_ADMIN"), eq(schema.users.active, true)));
    if (n <= 1) return { error: "Keep at least one active super admin." };
  }

  const fromOrg = target.org;
  const leavesHq = fromOrg.type === "HQ";
  // What is theirs to hand over: at the old branch, or anywhere for somebody
  // leaving the head office.
  const theirStudents = leavesHq
    ? eq(schema.students.assignedToId, target.id)
    : and(eq(schema.students.assignedToId, target.id), eq(schema.students.orgId, fromOrg.id))!;
  const openTasks = leavesHq
    ? and(eq(schema.tasks.assignedToId, target.id), isNull(schema.tasks.doneAt))!
    : and(eq(schema.tasks.assignedToId, target.id), eq(schema.tasks.orgId, fromOrg.id), isNull(schema.tasks.doneAt))!;
  const [{ n: students }] = await db.select({ n: count() }).from(schema.students).where(theirStudents);
  const [{ n: openTaskCount }] = leavesHq ? await db.select({ n: count() }).from(schema.tasks).where(openTasks) : [{ n: 0 }];
  const colleague = d.handToId
    ? ((await db.query.users.findFirst({ where: eq(schema.users.id, d.handToId), columns: { id: true, orgId: true, role: true, active: true, name: true } })) ?? null)
    : null;
  // The active branch heads at either end, the person moving not counted,
  // for the rule that a branch has exactly one.
  const activeHead = (orgId: string) => and(eq(schema.users.orgId, orgId), eq(schema.users.role, "PARTNER"), eq(schema.users.active, true), ne(schema.users.id, target.id));
  const [{ n: othersAtFrom }] = await db.select({ n: count() }).from(schema.users).where(activeHead(target.orgId));
  const [{ n: atTarget }] = await db.select({ n: count() }).from(schema.users).where(activeHead(to.id));

  const planned = planMove({
    person: { id: target.id, role: target.role, orgId: target.orgId, active: target.active },
    from: { id: fromOrg.id, type: fromOrg.type, name: fromOrg.name },
    to: { id: to.id, type: to.type, active: to.active, name: to.name },
    role,
    students,
    tasks: openTaskCount,
    choice: d.studentsChoice ?? "",
    colleague,
    heads: { othersAtFrom, atTarget },
  });
  if (!planned.ok) return { error: planned.error };
  const plan = planned.plan;

  // A sub-agent firm has its tier's seats, and a person moving in takes one.
  if (to.type === "SUB_AGENT" && target.active) {
    const [{ n }] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.orgId, to.id), eq(schema.users.active, true), inArray(schema.users.role, [...PARTNER_ROLES])));
    if (!seatFree(to, n)) return { error: `${to.name} has used all ${to.counsellorSeats} seats for its tier.` };
  }

  const deskLabel = d.deskLabel !== undefined ? d.deskLabel || null : plan.roleChanged ? null : target.deskLabel;
  const handed: { id: string; firstName: string; lastName: string }[] = [];
  let takenOff = 0;
  const cleared = { teams: 0, services: [] as string[], officerOn: 0 };
  // The open tasks on their name they leave behind: how many there were, and
  // who they went to. Null when nobody could take them.
  const { tasks, tasksTo } = await db.transaction(async (tx): Promise<{ tasks: number; tasksTo: { id: string; name: string } | null }> => {
    // Bumped in the database rather than from the row read earlier, so two
    // bumps landing at once cannot write the same number.
    await updateTracked("user", target.id, { orgId: to.id, role, deskLabel, sessionVersion: sql`${schema.users.sessionVersion} + 1` }, { by: actor.id, action: "user.move", tx });
    if (plan.students > 0) {
      // Each student's history and ledger line say who they went to and why,
      // in the same transaction as the move, so a refusal part way leaves
      // neither the files nor their record half moved.
      const moved = await updateTrackedMany(
        "student",
        theirStudents,
        { assignedToId: plan.handTo, updatedAt: new Date() },
        { by: actor.id, action: "student.reassign", tx, ledgerDetail: `${target.name} moved to ${to.name}` },
      );
      const rows = moved.map((m) => ({ id: m.after.id, firstName: m.after.firstName, lastName: m.after.lastName }));
      handed.push(...rows);
      // The hand-over is written the way a reassign from the student's file
      // is, one row per student, so the file's own history reads the same.
      if (rows.length) {
        await tx.insert(schema.auditLogs).values(
          rows.map((r) => ({ actorId: actor.id, action: "student.reassign", entityType: "student", entityId: r.id, meta: { from: target.id, to: plan.handTo, via: "user.move" } })),
        );
      }
    }
    // Their part on files they can no longer open: at the old branch, or, for
    // somebody leaving the head office, everywhere but where they are going.
    const filesLeft = leavesHq
      ? tx.select({ id: schema.students.id }).from(schema.students).where(ne(schema.students.orgId, to.id))
      : tx.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.orgId, fromOrg.id));
    const off = await tx
      .delete(schema.studentPeople)
      .where(and(eq(schema.studentPeople.userId, target.id), inArray(schema.studentPeople.studentId, filesLeft)))
      .returning({ id: schema.studentPeople.id });
    takenOff = off.length;

    if (leavesHq) {
      const teams = await tx.delete(schema.teamMembers).where(eq(schema.teamMembers.userId, target.id)).returning({ id: schema.teamMembers.id });
      cleared.teams = teams.length;
      // A request type that landed on them goes back to the whole desk, as
      // taking the name off on the services screen does.
      const services = await tx.delete(schema.serviceOwners).where(eq(schema.serviceOwners.userId, target.id)).returning({ type: schema.serviceOwners.type });
      cleared.services = services.map((x) => x.type);
      // An application still being worked goes back to the desk's queue
      // without an officer. A finished one keeps the name of who did it.
      const stillOpen = tx
        .select({ id: schema.statusDefinitions.id })
        .from(schema.statusDefinitions)
        .where(sql`${schema.statusDefinitions.group} not in ('SUCCESS', 'CLOSED')`);
      const apps = await updateTrackedMany(
        "application",
        and(eq(schema.applications.officerId, target.id), inArray(schema.applications.statusId, stillOpen))!,
        { officerId: null },
        { by: actor.id, action: "application.officer", tx, ledgerDetail: `${target.name} moved to ${to.name}` },
      );
      cleared.officerOn = apps.length;
    }

    // Their open tasks would otherwise sit on the name of somebody who is no
    // longer there, where nobody looks.
    const [{ n: tasks }] = await tx.select({ n: count() }).from(schema.tasks).where(openTasks);
    let tasksTo: { id: string; name: string } | null = null;
    if (tasks > 0) {
      const head =
        plan.handTo || leavesHq
          ? null
          : ((await tx.query.users.findFirst({ where: activeHead(fromOrg.id), columns: { id: true, name: true }, orderBy: asc(schema.users.name) })) ?? null);
      const takerId = taskTaker(plan, head);
      if (takerId) {
        await tx.update(schema.tasks).set({ assignedToId: takerId }).where(openTasks);
        tasksTo = plan.handTo && colleague ? { id: colleague.id, name: colleague.name } : head;
      }
    }
    await tx.insert(schema.auditLogs).values({
      actorId: actor.id,
      action: "user.move",
      entityType: "user",
      entityId: target.id,
      meta: {
        email: target.email,
        from: fromOrg.id,
        fromName: fromOrg.name,
        fromType: fromOrg.type,
        to: to.id,
        toName: to.name,
        toType: to.type,
        fromRole: target.role,
        toRole: role,
        ...(deskLabel !== target.deskLabel ? { deskLabel: { from: target.deskLabel, to: deskLabel } } : {}),
        students: plan.students,
        handTo: plan.handTo,
        takenOffFiles: takenOff,
        tasks,
        tasksTo: tasksTo?.id ?? null,
        tasksLeft: tasksTo ? 0 : tasks,
        ...(leavesHq ? { teamsLeft: cleared.teams, servicesCleared: cleared.services, officerClearedOn: cleared.officerOn } : {}),
      },
    });
    return { tasks, tasksTo };
  });

  if (plan.handTo) {
    for (const s of handed) await notifyUsers([plan.handTo], "Student assigned to you", `${s.firstName} ${s.lastName}`, `/students/${s.id}/profile`);
  }
  if (tasksTo && tasks > 0) {
    await notifyUsers([tasksTo.id], "Tasks handed to you", `${tasks} open ${tasks === 1 ? "task" : "tasks"} from ${target.name}, who has moved to ${to.name}.`, "/my-day");
  }
  const said = moveSummary({
    name: target.name,
    fromName: fromOrg.name,
    toName: to.name,
    students: plan.students,
    colleagueName: plan.handTo ? (colleague?.name ?? "a colleague") : null,
    tasks,
    tasksTo: tasksTo?.name ?? null,
    newRole: plan.roleChanged ? (ROLE_LABEL[role] ?? role) : null,
    fromHq: leavesHq,
  });
  await notifyUsers([target.id], `You have been moved to ${to.name}`, said.forPerson, "/dashboard");
  revalidatePath("/admin/partners");
  revalidatePath("/students");
  return { ok: said.forDesk };
}

/**
 * Moves every active student of a branch to another one, with one choice of
 * counsellor for all of them: a named person there, or nobody, for its
 * branch head to hand out. Made for clearing a branch that should never have
 * been one (a department set up as a branch by mistake) before it is closed.
 * The rules and what moves are the same as moving one student from the file;
 * archived students stay where they are and are counted in the answer.
 */
export async function moveBranchStudentsAction(_: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser([...ADMIN_ROLES]);
  const clean = (k: string) => String(formData.get(k) ?? "").trim().slice(0, 40);
  const said = await moveStudents(actor, {
    fromOrgId: clean("fromOrgId"),
    toOrgId: clean("toOrgId"),
    choice: clean("choice"),
    counsellorId: clean("counsellorId") || null,
  });
  if ("error" in said) return { error: said.error };
  revalidatePath("/admin/partners");
  revalidatePath("/students");
  // A toast rather than a panel: with every active student gone, the fold
  // holding this form is no longer drawn, and a panel would go with it.
  return { ok: said.ok };
}
