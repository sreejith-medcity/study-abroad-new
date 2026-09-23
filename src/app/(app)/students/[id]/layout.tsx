import Link from "next/link";
import { count, eq, ilike } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fullName } from "@/lib/format";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { Card, Chip } from "@/components/ui";
import { StepTabs } from "@/components/tabs";
import { profileCompleteness } from "@/lib/checks";
import { backgroundComplete } from "@/lib/background";

const PATHWAY_LABEL = { DEGREE: "Degree", AUSBILDUNG: "Ausbildung", NURSING: "Nurse registration" } as const;

export default async function StudentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const [{ apps }] = await db.select({ apps: count() }).from(schema.applications).where(eq(schema.applications.studentId, id));
  const [{ docs }] = await db.select({ docs: count() }).from(schema.documents).where(eq(schema.documents.studentId, id));
  const [{ picks }] = await db.select({ picks: count() }).from(schema.shortlists).where(eq(schema.shortlists.studentId, id));
  const [{ quals }] = await db.select({ quals: count() }).from(schema.academicRecords).where(eq(schema.academicRecords.studentId, id));
  const profileDone = profileCompleteness({ ...student, academics: Array(quals).fill({ level: "" }), tests: [], documentTypeCodes: [] });
  const profileReady = profileDone.personal && profileDone.academics && backgroundComplete(student.background);
  const [{ services }] = await db.select({ services: count() }).from(schema.serviceRequests).where(eq(schema.serviceRequests.studentId, id));
  // The student's preferred destination is stored by name; search filters by code.
  const preferred = student.preferredCountry
    ? await db.query.countries.findFirst({ where: ilike(schema.countries.name, student.preferredCountry.trim()) })
    : undefined;
  const findHref = `/search?${new URLSearchParams({ student: id, ...(preferred ? { country: preferred.code } : {}) })}`;

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
          <p className="mt-1 break-all text-muted">{student.email ?? "No email on file"}</p>
          <p className="text-muted tabular">{student.phone}{student.whatsappOptIn && <span className="ml-2 text-xs text-emerald-700">WhatsApp on</span>}</p>
          <Link href={findHref} data-print="hide" className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
            Find programs for {student.firstName}{preferred ? ` in ${preferred.name}` : ""}
          </Link>
          <Link href={`/program-options/new?student=${id}`} data-print="hide" className="ml-3 mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
            Ask the team for options
          </Link>
          <p className="mt-2 text-xs text-muted">
            {isStaff(user) ? `${student.org.name} · ` : ""}Assigned to {student.assignedTo ? student.assignedTo.deskLabel ?? student.assignedTo.name : "nobody"}
            {student.consentAt ? " · Consent recorded" : " · No consent on file"}
          </p>
        </Card>
        <Card className="flex items-center p-4" data-print="hide">
          <div className="w-full">
            <StepTabs
              steps={[
                { href: `/students/${id}/profile`, label: "Profile", done: profileReady },
                { href: `/students/${id}/shortlist`, label: `Shortlist (${picks})`, done: picks > 0 },
                { href: `/students/${id}/applications`, label: `Applications (${apps})`, done: apps > 0 },
                { href: `/students/${id}/documents`, label: `Documents (${docs})`, done: docs > 0 },
                { href: `/students/${id}/services`, label: `Services (${services})`, done: services > 0 },
              ]}
            />
          </div>
        </Card>
      </div>
      {children}
    </div>
  );
}
