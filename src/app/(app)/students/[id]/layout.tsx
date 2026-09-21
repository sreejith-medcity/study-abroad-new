import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fullName } from "@/lib/format";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { Card, Chip } from "@/components/ui";
import { StepTabs } from "@/components/tabs";

const PATHWAY_LABEL = { DEGREE: "Degree", AUSBILDUNG: "Ausbildung", NURSING: "Nurse registration" } as const;

export default async function StudentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const [{ apps }] = await db.select({ apps: count() }).from(schema.applications).where(eq(schema.applications.studentId, id));
  const [{ docs }] = await db.select({ docs: count() }).from(schema.documents).where(eq(schema.documents.studentId, id));
  const [{ picks }] = await db.select({ picks: count() }).from(schema.shortlists).where(eq(schema.shortlists.studentId, id));

  return (
    <div>
      <nav className="mb-3 text-muted" aria-label="Breadcrumb">
        <Link href="/students" className="hover:underline">Students</Link> <span aria-hidden="true">›</span> <span className="text-ink">{fullName(student)}</span>
      </nav>
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{fullName(student)}</h1>
            {student.preferredPathway && <Chip tone="info">{PATHWAY_LABEL[student.preferredPathway]}</Chip>}
            {student.profileLocked && <Chip tone="warn">Profile locked</Chip>}
          </div>
          <p className="mt-1 break-all text-muted">{student.email}</p>
          <p className="text-muted tabular">{student.phone}{student.whatsappOptIn && <span className="ml-2 text-xs text-emerald-700">WhatsApp on</span>}</p>
          <p className="mt-2 text-xs text-muted">
            {isStaff(user) ? `${student.org.name} · ` : ""}Assigned to {student.assignedTo ? student.assignedTo.deskLabel ?? student.assignedTo.name : "nobody"}
            {student.consentAt ? " · Consent recorded" : " · No consent on file"}
          </p>
        </Card>
        <Card className="flex items-center p-4">
          <div className="w-full">
            <StepTabs
              steps={[
                { href: `/students/${id}/profile`, label: "Profile" },
                { href: `/students/${id}/shortlist`, label: `Shortlist (${picks})`, done: picks > 0 },
                { href: `/students/${id}/applications`, label: `Applications (${apps})`, done: apps > 0 },
                { href: `/students/${id}/documents`, label: `Documents (${docs})`, done: docs > 0 },
              ]}
            />
          </div>
        </Card>
      </div>
      {children}
    </div>
  );
}
