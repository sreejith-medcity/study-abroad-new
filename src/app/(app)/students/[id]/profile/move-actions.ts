"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { moveStudents } from "@/server/student-move";
import type { FormState } from "@/lib/form-state";

const clean = (v: FormDataEntryValue | null) => String(v ?? "").trim().slice(0, 40);

/**
 * Moves this student to another branch. The head office admins only: which
 * branch a student belongs to is not something a branch decides for itself,
 * least of all about a student it would be giving away or taking in.
 */
export async function moveStudentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const studentId = clean(fd.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  const said = await moveStudents(user, {
    studentId,
    fromOrgId: student.orgId,
    toOrgId: clean(fd.get("toOrgId")),
    choice: clean(fd.get("choice")),
    counsellorId: clean(fd.get("counsellorId")) || null,
  });
  if ("error" in said) return { error: said.error };
  revalidatePath(`/students/${studentId}`, "layout");
  revalidatePath("/students");
  revalidatePath("/admin/partners");
  return { ok: said.ok, keep: true };
}
