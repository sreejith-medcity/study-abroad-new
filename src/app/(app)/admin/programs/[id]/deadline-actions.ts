"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import type { FormState } from "@/lib/form-state";

/** Adds or replaces the deadline for one intake of one program. */
export async function saveDeadlineAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const programId = String(fd.get("programId") ?? "");
  const program = await db.query.programs.findFirst({ where: eq(schema.programs.id, programId) });
  if (!program) return { error: "That program no longer exists." };

  const errors: Record<string, string[]> = {};
  const intake = String(fd.get("intake") ?? "").match(/^(\d{4})-(\d{1,2})$/);
  const deadline = String(fd.get("deadline") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  if (!intake) errors.intake = ["Choose the intake"];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline)) errors.deadline = ["Enter the date"];
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };
  const year = Number(intake![1]);
  const month = Number(intake![2]);
  if (program.intakeMonths.length && !program.intakeMonths.includes(month)) return { fieldErrors: { intake: ["Not one of this program's intakes"] }, error: "Check the highlighted fields." };
  // A deadline after the intake month has begun and ended is a typo in the year.
  const [dy, dm] = deadline.split("-").map(Number);
  if (dy * 12 + dm > year * 12 + month) return { fieldErrors: { deadline: ["After the intake itself: check the year"] }, error: "Check the highlighted fields." };

  const d = schema.programDeadlines;
  await db
    .insert(d)
    .values({ programId, intakeMonth: month, intakeYear: year, deadline, note, createdById: user.id })
    .onConflictDoUpdate({ target: [d.programId, d.intakeYear, d.intakeMonth], set: { deadline, note, createdById: user.id } });
  await audit(user.id, "program.deadline", "program", programId, { intake: `${month}/${year}`, deadline });
  revalidatePath(`/admin/programs/${programId}`);
  return { ok: "Deadline saved." };
}

export async function deleteDeadlineAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const d = schema.programDeadlines;
  const [row] = await db.delete(d).where(and(eq(d.id, id))).returning();
  if (!row) return;
  await audit(user.id, "program.deadline_remove", "program", row.programId, { intake: `${row.intakeMonth}/${row.intakeYear}` });
  revalidatePath(`/admin/programs/${row.programId}`);
}
