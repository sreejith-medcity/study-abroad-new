"use server";

import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { SHORTLIST_LIMIT } from "@/lib/catalogue";
import { ADMIN_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";

/**
 * Adds a program to a student's shortlist, or takes it off again. The same
 * people who can apply for a student can shortlist for them; management and
 * the documentation team read it but do not change it.
 *
 * It does not revalidate anything: every page that shows the shortlist is
 * rendered per request, and the button refreshes its own page. Revalidating here
 * as well made the search page fetch twice and cancel both.
 */
export async function toggleShortlistAction(formData: FormData): Promise<{ on: boolean; error?: string }> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId") ?? "");
  const programId = String(formData.get("programId") ?? "");
  const student = await getStudentForUser(user, studentId);
  const sl = schema.shortlists;

  const existing = await db.query.shortlists.findFirst({ where: and(eq(sl.studentId, student.id), eq(sl.programId, programId)) });
  if (existing) {
    await db.delete(sl).where(eq(sl.id, existing.id));
    await audit(user.id, "shortlist.remove", "student", student.id, { programId });
    return { on: false };
  }
  const program = await db.query.programs.findFirst({ where: eq(schema.programs.id, programId) });
  if (!program || program.status !== "LIVE") return { on: false, error: "That program is not open any more." };
  const [{ n }] = await db.select({ n: count() }).from(sl).where(eq(sl.studentId, student.id));
  if (n >= SHORTLIST_LIMIT) return { on: false, error: `The shortlist is full at ${SHORTLIST_LIMIT}. Remove one first.` };
  await db.insert(sl).values({ studentId: student.id, programId, addedById: user.id }).onConflictDoNothing();
  await audit(user.id, "shortlist.add", "student", student.id, { programId });
  return { on: true };
}
