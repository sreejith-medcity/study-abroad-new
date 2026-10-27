import "server-only";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { feeAccess } from "@/server/student-fees";
import { mayOpenStudent } from "@/server/scope";

/**
 * Who may print a student's fee document: the student themselves, for
 * anything issued, and staff who may open the student and read their fees.
 * Anybody else is told it is not there.
 */
export async function mayPrint(student: { id: string; orgId: string; assignedToId: string | null; createdById: string | null }, issued: boolean) {
  const session = await getSession();
  if (!session) notFound();
  if (session.role === "STUDENT") {
    if (session.studentId !== student.id || !issued) notFound();
    return { student: true };
  }
  if (!(await feeAccess(session)).read || !(await mayOpenStudent(session, student))) notFound();
  return { student: false };
}
