"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { departmentChoice } from "@/lib/departments";
import type { FormState } from "@/lib/form-state";
import { emailProblem, normalizeEmail } from "@/lib/people";
import { BRANCH_COUNSELLOR_ROLES, PARTNER_ROLES } from "@/lib/permissions";
import { seatFree } from "@/lib/seats";
import { notifyUsers } from "@/server/notify";
import { departments, getSettings } from "@/server/settings";

const tempPassword = () => `Mc-${randomBytes(6).toString("base64url")}`;

/** A counsellor of the owner's own branch, or null. Owners never manage other owners. */
async function ownCounsellor(orgId: string, userId: string) {
  const u = await db.query.users.findFirst({ where: and(eq(schema.users.id, userId), eq(schema.users.orgId, orgId)) });
  return u && (BRANCH_COUNSELLOR_ROLES as readonly string[]).includes(u.role) ? u : null;
}

const newCounsellor = z.object({
  name: z.string().trim().min(2, "Enter the counsellor's name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(20).optional().transform((v) => v || null).refine((v) => v === null || /^\+?[\d\s-]{8,16}$/.test(v), "Enter a valid phone number"),
  deskLabel: z.string().trim().max(60).optional().transform((v) => v || null),
  department: z.string().trim().max(60).optional(),
});

/** Somebody else already signing in with this address, in any case. */
async function emailTaken(email: string, exceptUserId?: string) {
  const row = await db.query.users.findFirst({
    where: and(sql`lower(${schema.users.email}) = ${email}`, exceptUserId ? ne(schema.users.id, exceptUserId) : undefined),
    columns: { id: true },
  });
  return !!row;
}

/** Adds a counsellor; a sub-agent within its seats, a branch without a limit. The one-time password is shown once and must be changed at first sign in. */
export async function addCounsellorAction(_: FormState, fd: FormData): Promise<FormState> {
  const owner = await requireUser(["PARTNER"]);
  const parsed = newCounsellor.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, owner.orgId) });
  if (!org) return { error: "This branch could not be loaded." };
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, org.id), eq(schema.users.active, true), inArray(schema.users.role, [...PARTNER_ROLES])));
  if (!seatFree(org, n)) return { error: `All ${org.counsellorSeats} seats for your tier are in use. Switch someone off, or ask the Overseas team about a higher tier.` };
  if (await emailTaken(d.email)) return { fieldErrors: { email: ["Someone already signs in with this email"] }, error: "Check the highlighted fields." };
  const dept = departmentChoice(d.department, departments(await getSettings()));
  if (!dept.ok) return { fieldErrors: { department: [dept.error] }, error: "Check the highlighted fields." };
  const password = tempPassword();
  const [created] = await db
    .insert(schema.users)
    .values({ name: d.name, email: d.email, phone: d.phone, deskLabel: d.deskLabel, department: dept.department, role: "COUNSELLOR", orgId: org.id, passwordHash: await hashPassword(password), mustChangePassword: true })
    .returning({ id: schema.users.id });
  await audit(owner.id, "team.add", "user", created.id, { email: d.email, department: dept.department });
  revalidatePath("/settings/team");
  return { keep: true, ok: `Added. One-time password for ${d.email}: ${password}. Share it privately; they choose their own at first sign in.` };
}

/** Switches a counsellor off or back on. Switching off moves their students to the owner and ends their sign-in at once. */
export async function setCounsellorActiveAction(fd: FormData) {
  const owner = await requireUser(["PARTNER"]);
  const target = await ownCounsellor(owner.orgId, String(fd.get("userId") ?? ""));
  if (!target) return;
  const on = !target.active;
  if (on) {
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, owner.orgId) });
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.users)
      .where(and(eq(schema.users.orgId, owner.orgId), eq(schema.users.active, true), inArray(schema.users.role, [...PARTNER_ROLES])));
    if (!org || !seatFree(org, n)) return;
  }
  let moved = 0;
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ active: on, sessionVersion: target.sessionVersion + 1 }).where(eq(schema.users.id, target.id));
    if (!on) {
      const r = await tx
        .update(schema.students)
        .set({ assignedToId: owner.id })
        .where(and(eq(schema.students.orgId, owner.orgId), eq(schema.students.assignedToId, target.id)))
        .returning({ id: schema.students.id });
      moved = r.length;
    }
  });
  await audit(owner.id, on ? "team.activate" : "team.deactivate", "user", target.id, { email: target.email, studentsMoved: moved });
  revalidatePath("/settings/team");
}

export async function resetCounsellorPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const owner = await requireUser(["PARTNER"]);
  const target = await ownCounsellor(owner.orgId, String(fd.get("userId") ?? ""));
  if (!target) return { error: "That person is not a counsellor in your branch." };
  const password = tempPassword();
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: true, passwordUpdatedAt: new Date(), sessionVersion: target.sessionVersion + 1 })
    .where(eq(schema.users.id, target.id));
  await audit(owner.id, "team.password_reset", "user", target.id, { email: target.email });
  return { keep: true, ok: `One-time password for ${target.email}: ${password}. They are signed out and choose a new one at sign in.` };
}

const editMember = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2, "Enter their name").max(100),
  email: z.string().trim().max(254),
  deskLabel: z.string().trim().max(60).optional().transform((v) => v || null),
  department: z.string().trim().max(60).optional(),
});

/**
 * A counsellor's name, sign-in email, desk and department, by the head of
 * their own branch. Nobody at another branch, and never the owner's own
 * details, which are on Settings. A new email signs them out, so they come
 * back in with the address that now works, and they are told in a notice.
 */
export async function editMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const owner = await requireUser(["PARTNER"]);
  const parsed = editMember.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const target = await ownCounsellor(owner.orgId, d.userId);
  if (!target) return { error: "That person is not a counsellor in your branch." };

  const email = normalizeEmail(d.email);
  const problem = emailProblem(email);
  if (problem) return { fieldErrors: { email: [problem] }, error: "Check the highlighted fields." };
  if (email !== target.email.toLowerCase() && (await emailTaken(email, target.id))) {
    return { fieldErrors: { email: ["Someone already signs in with this email"] }, error: "Someone already signs in with that email." };
  }
  const dept = departmentChoice(d.department, departments(await getSettings()));
  if (!dept.ok) return { fieldErrors: { department: [dept.error] }, error: "Check the highlighted fields." };

  const emailChanged = email !== target.email;
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  if (d.name !== target.name) changes.name = { from: target.name, to: d.name };
  if (emailChanged) changes.email = { from: target.email, to: email };
  if (d.deskLabel !== target.deskLabel) changes.deskLabel = { from: target.deskLabel, to: d.deskLabel };
  if (dept.department !== target.department) changes.department = { from: target.department, to: dept.department };
  if (Object.keys(changes).length === 0) return { ok: "Nothing changed." };

  await db
    .update(schema.users)
    .set({ name: d.name, email, deskLabel: d.deskLabel, department: dept.department, ...(emailChanged ? { sessionVersion: target.sessionVersion + 1 } : {}) })
    .where(eq(schema.users.id, target.id));
  await audit(owner.id, "team.edit", "user", target.id, { email: target.email, changes });
  if (emailChanged) {
    await notifyUsers([target.id], "Your sign-in email changed", `From now on, sign in with ${email}. The old address, ${target.email}, no longer signs in.`, "/settings");
  }
  revalidatePath("/settings/team");
  return { ok: emailChanged ? `Saved. ${d.name} now signs in with ${email}, and has been signed out to do so.` : "Saved." };
}
