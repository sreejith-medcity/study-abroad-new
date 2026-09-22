"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { BULLETIN_KINDS, BULLETIN_LABEL } from "@/lib/bulletins";
import type { FormState } from "@/lib/form-state";
import { ADMIN_ROLES } from "@/lib/permissions";
import { notifyUsers } from "@/server/notify";

const input = z
  .object({
    kind: z.enum(BULLETIN_KINDS, { message: "Choose what it is" }),
    title: z.string().trim().min(3, "Give it a title").max(200),
    body: z.string().trim().min(5, "Say what changed").max(8000),
    university: z.string().trim().transform((v) => v || null),
    intakes: z.string().trim().max(100).transform((v) => v || null),
    ctaLabel: z.string().trim().max(40).transform((v) => v || null),
    ctaUrl: z.union([z.literal(""), z.string().trim().refine((v) => v.startsWith("https://") || v.startsWith("/"), "A full https:// link or a page in the portal")]).transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (!!v.ctaLabel !== !!v.ctaUrl) ctx.addIssue({ code: "custom", path: ["ctaUrl"], message: "A button needs both its label and its link" });
  });

export async function createBulletinAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = input.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const { university, ...v } = parsed.data;
  let universityId: string | null = null;
  if (university) {
    const u = await db.query.universities.findFirst({ where: ilike(schema.universities.name, university) });
    if (!u) return { fieldErrors: { university: ["No university by that name in the catalogue"] }, error: "Check the highlighted fields." };
    universityId = u.id;
  }
  const countries = [...new Set(fd.getAll("country").map(String).filter(Boolean))];
  const [row] = await db.insert(schema.bulletins).values({ ...v, countries, universityId, createdById: user.id }).returning();
  await audit(user.id, "bulletin.publish", "bulletin", row.id, { kind: row.kind, title: row.title });
  if (row.kind !== "WHATS_NEW") {
    const people = await db.select({ id: schema.users.id }).from(schema.users).where(and(inArray(schema.users.role, ["PARTNER", "COUNSELLOR"]), eq(schema.users.active, true)));
    await notifyUsers(people.map((p) => p.id), `${BULLETIN_LABEL[row.kind]}: ${row.title}`, row.body.slice(0, 120), row.kind === "UPDATE" ? `/updates?id=${row.id}` : `/updates?tab=announcements&id=${row.id}`);
  }
  revalidatePath("/admin/updates");
  return { ok: row.kind === "WHATS_NEW" ? "Published to What's New." : "Published. Partners have been told." };
}

export async function setBulletinPublishedAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const published = fd.get("published") === "true";
  await db.update(schema.bulletins).set({ published }).where(eq(schema.bulletins.id, id));
  await audit(user.id, published ? "bulletin.publish" : "bulletin.withdraw", "bulletin", id);
  revalidatePath("/admin/updates");
}
