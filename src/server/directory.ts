"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { ADMIN_ROLES } from "@/lib/permissions";
import { notifyUsers } from "@/server/notify";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const contact = z.object({
  area: z.string().trim().min(2, "Say what they handle, such as UK admissions").max(80),
  name: z.string().trim().min(2, "Enter a name").max(120),
  title: opt(120),
  phone: opt(20).refine((v) => v === null || /^\+?[\d\s-]{8,16}$/.test(v), "Enter a valid phone number"),
  email: opt(160).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email"),
  whatsapp: z.string().optional().transform((v) => v === "on"),
  level: z.coerce.number().int().min(1).max(3),
  hours: opt(80),
  sortOrder: z.coerce.number().int().min(0).max(999).default(100),
});

export async function saveTeamContactAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = contact.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  if (!parsed.data.phone && !parsed.data.email) return { fieldErrors: { phone: ["Give a phone number or an email"] }, error: "Check the highlighted fields." };
  const id = String(fd.get("id") ?? "");
  if (id) {
    await db.update(schema.teamContacts).set(parsed.data).where(eq(schema.teamContacts.id, id));
    await audit(user.id, "team_contact.update", "team_contact", id, { name: parsed.data.name });
  } else {
    const [row] = await db.insert(schema.teamContacts).values(parsed.data).returning({ id: schema.teamContacts.id });
    await audit(user.id, "team_contact.create", "team_contact", row.id, { name: parsed.data.name });
  }
  revalidatePath("/admin/contacts");
  return { ok: id ? "Contact updated." : "Contact added.", redirectTo: id ? "/admin/contacts" : undefined };
}

export async function setTeamContactActiveAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const active = fd.get("active") === "true";
  await db.update(schema.teamContacts).set({ active }).where(eq(schema.teamContacts.id, id));
  await audit(user.id, active ? "team_contact.show" : "team_contact.hide", "team_contact", id);
  revalidatePath("/admin/contacts");
}

const link = z.object({
  label: z.string().trim().min(2, "Give the link a name").max(80),
  url: z.string().trim().refine((v) => /^https:\/\/[^\s]+\.[^\s]+/.test(v), "A full https:// address"),
  note: opt(160),
  sortOrder: z.coerce.number().int().min(0).max(999).default(100),
});

export async function saveQuickLinkAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = link.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const [row] = await db.insert(schema.quickLinks).values(parsed.data).returning({ id: schema.quickLinks.id });
  await audit(user.id, "quick_link.create", "quick_link", row.id, { label: parsed.data.label });
  revalidatePath("/admin/contacts");
  return { ok: "Link added." };
}

export async function deleteQuickLinkAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  await db.delete(schema.quickLinks).where(eq(schema.quickLinks.id, id));
  await audit(user.id, "quick_link.delete", "quick_link", id);
  revalidatePath("/admin/contacts");
}

const promotion = z
  .object({
    title: z.string().trim().min(3, "Give it a title").max(160),
    summary: z.string().trim().min(5, "Say what partners get, in one line").max(300),
    terms: z.string().trim().min(10, "Spell out the terms: who qualifies and how it is paid").max(6000),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the first day"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the last day"),
  })
  .refine((v) => v.endsOn >= v.startsOn, { path: ["endsOn"], message: "It cannot end before it starts" });

export async function createPromotionAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = promotion.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const countries = [...new Set(fd.getAll("country").map(String).filter(Boolean))];
  const [row] = await db.insert(schema.promotions).values({ ...parsed.data, countries, createdById: user.id }).returning();
  await audit(user.id, "promotion.publish", "promotion", row.id, { title: row.title });
  // Owners hear about every scheme; counsellors only where their owner lets them see commission.
  const people = await db
    .select({ id: schema.users.id, role: schema.users.role, sees: schema.organizations.counsellorsSeeCommission })
    .from(schema.users)
    .innerJoin(schema.organizations, eq(schema.users.orgId, schema.organizations.id))
    .where(and(inArray(schema.users.role, ["PARTNER", "COUNSELLOR"]), eq(schema.users.active, true)));
  await notifyUsers(people.filter((p) => p.role === "PARTNER" || p.sees).map((p) => p.id), `New scheme: ${row.title}`, row.summary, `/promotions#${row.id}`);
  revalidatePath("/admin/promotions");
  return { ok: "Published. Partners have been told." };
}

export async function setPromotionPublishedAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const published = fd.get("published") === "true";
  await db.update(schema.promotions).set({ published }).where(eq(schema.promotions.id, id));
  await audit(user.id, published ? "promotion.publish" : "promotion.withdraw", "promotion", id);
  revalidatePath("/admin/promotions");
}
