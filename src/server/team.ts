"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";

const tempPassword = () => `Mc-${randomBytes(6).toString("base64url")}`;

/** A counsellor of the owner's own branch, or null. Owners never manage other owners. */
async function ownCounsellor(orgId: string, userId: string) {
  const u = await db.query.users.findFirst({ where: and(eq(schema.users.id, userId), eq(schema.users.orgId, orgId)) });
  return u && u.role === "COUNSELLOR" ? u : null;
}

const newCounsellor = z.object({
  name: z.string().trim().min(2, "Enter the counsellor's name").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(20).optional().transform((v) => v || null).refine((v) => v === null || /^\+?[\d\s-]{8,16}$/.test(v), "Enter a valid phone number"),
  deskLabel: z.string().trim().max(60).optional().transform((v) => v || null),
});

/** Adds a counsellor within the branch's seats. The one-time password is shown once and must be changed at first sign in. */
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
    .where(and(eq(schema.users.orgId, org.id), eq(schema.users.active, true), inArray(schema.users.role, ["PARTNER", "COUNSELLOR"])));
  if (n >= org.counsellorSeats) return { error: `All ${org.counsellorSeats} seats for your tier are in use. Switch someone off, or ask the Overseas team about a higher tier.` };
  if (await db.query.users.findFirst({ where: eq(schema.users.email, d.email) })) return { fieldErrors: { email: ["Someone already signs in with this email"] }, error: "Check the highlighted fields." };
  const password = tempPassword();
  const [created] = await db
    .insert(schema.users)
    .values({ name: d.name, email: d.email, phone: d.phone, deskLabel: d.deskLabel, role: "COUNSELLOR", orgId: org.id, passwordHash: await hashPassword(password), mustChangePassword: true })
    .returning({ id: schema.users.id });
  await audit(owner.id, "team.add", "user", created.id, { email: d.email });
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
      .where(and(eq(schema.users.orgId, owner.orgId), eq(schema.users.active, true), inArray(schema.users.role, ["PARTNER", "COUNSELLOR"])));
    if (!org || n >= org.counsellorSeats) return;
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

export async function setDeskLabelAction(_: FormState, fd: FormData): Promise<FormState> {
  const owner = await requireUser(["PARTNER"]);
  const target = await ownCounsellor(owner.orgId, String(fd.get("userId") ?? ""));
  if (!target) return { error: "That person is not a counsellor in your branch." };
  const label = String(fd.get("deskLabel") ?? "").trim().slice(0, 60) || null;
  await db.update(schema.users).set({ deskLabel: label }).where(eq(schema.users.id, target.id));
  await audit(owner.id, "team.desk_label", "user", target.id, { label });
  revalidatePath("/settings/team");
  return { ok: "Saved." };
}
