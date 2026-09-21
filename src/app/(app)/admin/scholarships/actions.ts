"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { ADMIN_ROLES } from "@/lib/permissions";

const LEVELS = ["UG_DIPLOMA", "UG", "PG_DIPLOMA", "PG", "PHD", "VOCATIONAL", "CERTIFICATE", "SCHOOL", "REGISTRATION"] as const;

/**
 * Adds a scholarship. The university is chosen by name within a country, and
 * a link to the institution's own page is required: a scholarship nobody can
 * check is exactly what a student should not be sold on.
 */
export async function addScholarshipAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const errors: Record<string, string[]> = {};
  const universityName = String(fd.get("university") ?? "").trim();
  const name = String(fd.get("name") ?? "").trim();
  const amount = String(fd.get("amount") ?? "").trim();
  const url = String(fd.get("url") ?? "").trim();
  const eligibility = String(fd.get("eligibility") ?? "").trim() || null;
  const deadline = String(fd.get("deadline") ?? "").trim() || null;
  const levels = fd.getAll("level").map(String).filter((l): l is (typeof LEVELS)[number] => (LEVELS as readonly string[]).includes(l));

  if (!universityName) errors.university = ["Choose the university"];
  if (!name) errors.name = ["Enter the scholarship's name"];
  if (!amount) errors.amount = ["Enter the amount as the university words it"];
  if (!/^https?:\/\/\S+\.\S+/.test(url)) errors.url = ["Link the university's own page for it"];
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) errors.deadline = ["Use a date"];

  const matches = universityName
    ? await db.select({ id: schema.universities.id }).from(schema.universities).where(eq(schema.universities.name, universityName)).limit(2)
    : [];
  if (universityName && matches.length !== 1) errors.university = [matches.length ? "Two universities share that name; ask for it to be fixed" : "No university by that exact name. Pick one from the list"];
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };

  const duplicate = await db.query.scholarships.findFirst({ where: and(eq(schema.scholarships.universityId, matches[0].id), eq(schema.scholarships.name, name)) });
  if (duplicate) return { error: "That university already has a scholarship with this name.", fieldErrors: { name: ["Already listed"] } };

  const [row] = await db
    .insert(schema.scholarships)
    .values({ universityId: matches[0].id, name, amount, url, eligibility, deadline, levels, createdById: user.id })
    .returning({ id: schema.scholarships.id });
  await audit(user.id, "scholarship.create", "scholarship", row.id, { university: universityName, name });
  revalidatePath("/admin/scholarships");
  return { ok: `Added ${name}.` };
}

export async function setScholarshipActiveAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const active = fd.get("active") === "true";
  await db.update(schema.scholarships).set({ active, updatedAt: new Date() }).where(eq(schema.scholarships.id, id));
  await audit(user.id, active ? "scholarship.activate" : "scholarship.pause", "scholarship", id);
  revalidatePath("/admin/scholarships");
}

export async function deleteScholarshipAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  await db.delete(schema.scholarships).where(eq(schema.scholarships.id, id));
  await audit(user.id, "scholarship.delete", "scholarship", id);
  revalidatePath("/admin/scholarships");
}
