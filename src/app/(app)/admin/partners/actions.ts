"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, canManageUsers, canResetPasswords, ROLE_LABEL } from "@/lib/permissions";

export type FormState = { error?: string; ok?: string; fieldErrors?: Record<string, string[] | undefined> };

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
  return { ok: `${d.orgName} created. Share these sign-in details securely: ${d.ownerEmail} / ${password} (shown once).` };
}

const addUser = z.object({
  orgId: z.string().min(1),
  name: z.string().trim().min(2, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  deskLabel: z.string().trim().max(60).optional(),
  role: z.enum(["PARTNER", "COUNSELLOR", "ADMIN", "MANAGEMENT", "SUPER_ADMIN"]),
});

export async function addUserAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = addUser.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, d.orgId) });
  if (!org) return { error: "Organisation not found." };
  if (org.type === "HQ" && !["SUPER_ADMIN", "ADMIN", "MANAGEMENT"].includes(d.role)) return { error: "Medcity Overseas users must be Super admin, Admin or Management." };
  if ((d.role === "SUPER_ADMIN" || d.role === "ADMIN") && !canManageUsers(user)) {
    return { error: "Only a super admin can create Medcity Overseas staff accounts." };
  }
  if (org.type !== "HQ" && !["PARTNER", "COUNSELLOR"].includes(d.role)) return { error: "Partner users must be Partner or Counsellor." };
  if (await db.query.users.findFirst({ where: eq(schema.users.email, d.email) })) return { error: "A user with that email already exists." };

  if (org.type !== "HQ") {
    const [{ n }] = await db.select({ n: count() }).from(schema.users).where(and(eq(schema.users.orgId, org.id), eq(schema.users.active, true), inArray(schema.users.role, ["PARTNER", "COUNSELLOR"])));
    if (n >= org.counsellorSeats) return { error: `${org.name} has used all ${org.counsellorSeats} seats for its tier.` };
  }

  const password = tempPassword();
  const [created] = await db.insert(schema.users).values({ name: d.name, email: d.email, deskLabel: d.deskLabel || null, role: d.role, orgId: org.id, passwordHash: await hashPassword(password) }).returning();
  await audit(user.id, "user.create", "user", created.id, { orgId: org.id, role: d.role });
  revalidatePath("/admin/partners");
  return { ok: `User added. Temporary password for ${d.email}: ${password} (shown once).` };
}

export async function updateOrgAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const orgId = String(formData.get("orgId"));
  const tier = String(formData.get("tier")) as (typeof schema.tier.enumValues)[number];
  const seats = Number(formData.get("counsellorSeats"));
  const rm = String(formData.get("relationshipManagerId") || "") || null;
  if (!schema.tier.enumValues.includes(tier) || !Number.isInteger(seats) || seats < 1 || seats > 500) return;
  await db.update(schema.organizations).set({ tier, counsellorSeats: seats, relationshipManagerId: rm }).where(eq(schema.organizations.id, orgId));
  await audit(user.id, "organization.update", "organization", orgId, { tier, seats, rm });
  revalidatePath("/admin/partners");
}

export async function toggleUserAction(formData: FormData) {
  const actor = await requireUser([...ADMIN_ROLES]);
  const userId = String(formData.get("userId"));
  if (userId === actor.id) return;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!u) return;
  // Only a super admin may switch off another Medcity Overseas account.
  if (["SUPER_ADMIN", "ADMIN", "MANAGEMENT"].includes(u.role) && !canManageUsers(actor)) return;
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
  if (!schema.role.enumValues.includes(role) || role === "STUDENT") return { error: "Pick a valid role." };

  const target = await db.query.users.findFirst({ where: eq(schema.users.id, userId), with: { org: true } });
  if (!target) return { error: "User not found." };
  if (target.id === actor.id) return { error: "Ask another super admin to change your own role." };

  const hq = target.org.type === "HQ";
  if (hq && !["SUPER_ADMIN", "ADMIN", "MANAGEMENT"].includes(role)) return { error: "Medcity Overseas staff can only be Super admin, Admin or Management." };
  if (!hq && !["PARTNER", "COUNSELLOR"].includes(role)) return { error: "Partner staff can only be Partner owner or Counsellor." };

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
  return { ok: `Temporary password for ${target.email}: ${password}. Shown once, and they must change it at sign in.` };
}
