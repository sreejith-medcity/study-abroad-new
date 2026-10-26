import { requireUser } from "@/lib/auth";
import { APP_ROLES, isAdmin, isStaff, worksStudentFiles } from "@/lib/permissions";
import { can } from "@/server/capabilities";
import { getStudentForUser } from "@/server/queries";
import { ledgerFor } from "@/server/ledger";
import { nameBook, versionsOf } from "@/server/record-history";
import { RecordHistory } from "@/components/record-history";
import { OwnershipTimeline } from "@/components/ownership-timeline";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const metadata = { title: "History" };
export const dynamic = "force-dynamic";

/**
 * The student file's own history: every saved change to the profile, the
 * assignment and the stage, field by field, with compare and restore, and
 * who has owned the file over time from the ownership ledger.
 */
export default async function StudentHistoryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string; done?: string; why?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  // The file opens only for somebody who may open it; everything below is about this one file.
  const student = await getStudentForUser(user, id);
  const [versions, entries, fullPassport, creator] = await Promise.all([
    versionsOf("student", id),
    ledgerFor("student", id),
    can(user, "SEE_FULL_PASSPORT"),
    student.createdById ? db.query.users.findFirst({ where: eq(schema.users.id, student.createdById), columns: { name: true } }) : undefined,
  ]);
  const names = await nameBook(versions);
  const canRestore = worksStudentFiles(user) && (!student.profileLocked || isAdmin(user));

  return (
    <div className="space-y-4">
      <RecordHistory
        entity="student"
        versions={versions}
        names={names}
        canRestore={canRestore}
        fullPassport={fullPassport}
        back={`/students/${id}/history`}
        a={sp.a}
        b={sp.b}
        done={sp.done}
        why={sp.why}
        started={{ at: student.createdAt, by: creator?.name ?? null }}
      />
      <OwnershipTimeline entries={entries} owner={student.assignedTo ? student.assignedTo.name : "nobody"} admin={isStaff(user) && isAdmin(user)} />
    </div>
  );
}
