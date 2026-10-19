"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, HQ_ROLES, PARTNER_ROLES, ROLE_LABEL, canManageSuperAdmins, canManageUsers, canResetPasswords, isFamilyRole } from "@/lib/permissions";
import { makeSlug } from "@/server/public-form";
import { orgIsUntouched } from "@/server/org-untouched";

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
  if (await db.query.users.findFirst({ where: eq(schema.users.email, d.ownerEmail) })) return { error: "A user with that email already exists.", fieldErrors: { ownerEmail: ["Already in use"] } };

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
  role: z.enum([...PARTNER_ROLES, "ADMIN", "MANAGEMENT", "SUPER_ADMIN", "OPS_MANAGER", "DOCUMENTATION"]),
});

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
  if (await db.query.users.findFirst({ where: eq(schema.users.email, d.email) })) return { error: "A user with that email already exists." };

  if (org.type !== "HQ") {
    const [{ n }] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.orgId, org.id), eq(schema.users.active, true), inArray(schema.users.role, [...PARTNER_ROLES])));
    if (n >= org.counsellorSeats) return { error: `${org.name} has used all ${org.counsellorSeats} seats for its tier.` };
  }

  const password = tempPassword();
  const [created] = await db.insert(schema.users).values({ name: d.name, email: d.email, deskLabel: d.deskLabel || null, role: d.role, orgId: org.id, passwordHash: await hashPassword(password) }).returning();
  await audit(user.id, "user.create", "user", created.id, { orgId: org.id, role: d.role });
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
  await db.update(schema.users).set({ active: !u.active }).where(eq(schema.users.id, userId));
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

  await db.update(schema.users).set({ role }).where(eq(schema.users.id, userId));
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

/** The free-text job title beside someone's name. */
export async function setTitleAction(_: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireUser([...ADMIN_ROLES]);
  if (!canManageUsers(actor)) return { error: "Only a super admin or an ops manager can change titles." };
  const userId = String(formData.get("userId"));
  const title = String(formData.get("deskLabel") ?? "").trim().slice(0, 60);

  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!target) return { error: "User not found." };

  await db.update(schema.users).set({ deskLabel: title || null }).where(eq(schema.users.id, userId));
  await audit(actor.id, "user.title", "user", userId, { email: target.email, title: title || null });
  revalidatePath("/admin/partners");
  return { ok: title ? `${target.name} is now "${title}".` : `Title cleared for ${target.name}.` };
}
