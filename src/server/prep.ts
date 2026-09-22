"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { ADMIN_ROLES } from "@/lib/permissions";
import { PREP_TESTS } from "@/lib/prep";
import { makeSlug } from "@/server/public-form";

const course = z.object({
  test: z.enum(PREP_TESTS, { message: "Choose the test" }),
  title: z.string().trim().min(3, "Give the course a name").max(120),
  summary: z.string().trim().min(10, "Say what the course covers").max(600),
  mode: z.string().trim().min(2, "Online, at the branch, or both").max(60),
  durationWeeks: z.string().optional().transform((v) => (v ? Number(v) : null)).refine((v) => v === null || (Number.isInteger(v) && v > 0 && v <= 52), "Whole weeks, up to 52"),
  feeInr: z.string().optional().transform((v) => (v ? Number(v.replace(/[,\s]/g, "")) : null)).refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v < 1_000_000), "A fee in rupees, or blank if it is quoted"),
  sortOrder: z.coerce.number().int().min(0).max(999).default(100),
});

export async function createPrepCourseAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = course.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const [row] = await db.insert(schema.prepCourses).values(parsed.data).returning({ id: schema.prepCourses.id });
  await audit(user.id, "prep_course.create", "prep_course", row.id, { title: parsed.data.title });
  revalidatePath("/admin/prep");
  return { ok: "Course added." };
}

export async function setPrepCoursePublishedAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const published = fd.get("published") === "true";
  await db.update(schema.prepCourses).set({ published }).where(eq(schema.prepCourses.id, id));
  await audit(user.id, published ? "prep_course.publish" : "prep_course.withdraw", "prep_course", id);
  revalidatePath("/admin/prep");
}

/** The owner switches the branch's prep page on or off. Its link uses the branch's public code. */
export async function setPrepPageAction(fd: FormData) {
  const user = await requireUser(["PARTNER"]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  if (!org || org.type === "HQ") return;
  const on = fd.get("on") === "1";
  const slug = org.publicSlug ?? makeSlug(org.name);
  await db.update(schema.organizations).set({ prepPageEnabled: on, publicSlug: slug }).where(eq(schema.organizations.id, org.id));
  await audit(user.id, on ? "org.prep_page_on" : "org.prep_page_off", "organization", org.id, { slug });
  revalidatePath("/settings/students");
}
