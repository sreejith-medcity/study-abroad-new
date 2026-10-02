"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { ensureStudentId } from "@/server/medcity-id";

/**
 * Gives a Medcity ID to a student who has none.
 *
 * Every student registered from now on is given one at registration, and the
 * rows that predate the numbering were given theirs in one pass. This is for
 * the stray: a branch whose letters had to be settled by hand, or a
 * registration that went through while the numbering was unavailable.
 */
export async function assignStudentIdAction(formData: FormData) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const studentId = String(formData.get("studentId"));
  const student = await getStudentForUser(user, studentId);
  if (student.medcityId) return;
  const minted = await ensureStudentId(studentId);
  if (minted) await audit(user.id, "student.id.mint", "student", studentId, { medcityId: minted });
  revalidatePath(`/students/${studentId}`, "layout");
}
