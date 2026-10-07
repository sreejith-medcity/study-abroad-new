import Link from "next/link";
import { and, count, eq, ilike, notInArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fullName } from "@/lib/format";
import { APP_ROLES, isStaff, worksStudentFiles } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { Alert, Button, Card, Chip } from "@/components/ui";
import { StepTabs } from "@/components/tabs";
import { LogContact } from "@/components/crm-forms";
import { profileCompleteness } from "@/lib/checks";
import { backgroundComplete } from "@/lib/background";
import { commissionVisible } from "@/server/commission-visibility";
import { assignStudentIdAction } from "@/server/id-actions";

const PATHWAY_LABEL = { DEGREE: "Degree", AUSBILDUNG: "Ausbildung", NURSING: "Nurse registration" } as const;

export default async function StudentLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  // Read it or work it: everything below asks this once, rather than each
  // screen naming the roles it thinks are read-only.
  const canWork = worksStudentFiles(user);
  const [{ apps }] = await db.select({ apps: count() }).from(schema.applications).where(eq(schema.applications.studentId, id));
  const [{ docs }] = await db.select({ docs: count() }).from(schema.documents).where(eq(schema.documents.studentId, id));
  // The documentation tab counts what is still owed, not what is on the list:
  // "Documentation (3)" is a number somebody can act on this afternoon.
  const [{ owed }] = await db
    .select({ owed: count() })
    .from(schema.checklistItems)
    .where(and(eq(schema.checklistItems.studentId, id), eq(schema.checklistItems.required, true), notInArray(schema.checklistItems.state, ["ACCEPTED", "NOT_NEEDED"])));
  const [{ picks }] = await db.select({ picks: count() }).from(schema.shortlists).where(eq(schema.shortlists.studentId, id));
  const [{ quals }] = await db.select({ quals: count() }).from(schema.academicRecords).where(eq(schema.academicRecords.studentId, id));
  const profileDone = profileCompleteness({ ...student, academics: Array(quals).fill({ level: "" }), tests: [], documentTypeCodes: [] });
  const profileReady = profileDone.personal && profileDone.academics && backgroundComplete(student.background);
  const [{ services }] = await db.select({ services: count() }).from(schema.serviceRequests).where(eq(schema.serviceRequests.studentId, id));
  // Money is off a counsellor's screens where the branch owner chose that, and
  // the tab follows the same switch rather than adding a second one to forget.
  const money = await commissionVisible(user);
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
          {student.medcityId ? (
            <p className="mt-1 font-mono text-[13px] font-medium tracking-tight text-brand-700">{student.medcityId}</p>
          ) : !canWork ? (
            <p className="mt-1 text-[13px] text-muted">No Medcity ID yet</p>
          ) : (
            <form action={assignStudentIdAction} className="mt-1 flex items-center gap-2" data-print="hide">
              <input type="hidden" name="studentId" value={id} />
              <span className="text-[13px] text-muted">No Medcity ID yet</span>
              <Button variant="quiet" className="py-0.5 text-xs">Give one</Button>
            </form>
          )}
          <p className="mt-1 break-all text-muted">{student.email ?? "No email on file"}</p>
          <p className="text-muted tabular">{student.phone}{student.whatsappOptIn && <span className="ml-2 text-xs text-emerald-700">WhatsApp on</span>}</p>
          <Link href={findHref} data-print="hide" className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
            Find programs for {student.firstName}{preferred ? ` in ${preferred.name}` : ""}
          </Link>
          <Link href={`/program-options/new?student=${id}`} data-print="hide" className="ml-3 mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
            Ask the team for options
          </Link>
          {canWork && (
            <div className="mt-3 flex flex-wrap gap-2" data-print="hide">
              <LogContact studentId={id} studentName={student.firstName} />
            </div>
          )}
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
                { href: `/students/${id}/documentation`, label: owed > 0 ? `Documentation (${owed})` : "Documentation", done: owed === 0 },
                { href: `/students/${id}/timeline`, label: "Timeline", done: true },
                ...(money ? [{ href: `/students/${id}/income`, label: "Income", done: true }] : []),
                { href: `/students/${id}/services`, label: `Services (${services})`, done: services > 0 },
              ]}
            />
          </div>
        </Card>
      </div>
      {canWork ? (
        children
      ) : (
        <>
          <Alert tone="info" title="You are reading this file, not working on it">
            Your role opens a student so the figures, the stage and the history can be checked. Changing what is on the file belongs to the branch counsellor
            and the documentation desk, so the controls below are shown as they stand and cannot be used.
          </Alert>
          {/* Disabled at the top rather than screen by screen: a control the
              server will refuse should never be pressable. */}
          <fieldset disabled className="mt-4 w-full min-w-0 border-0 p-0">
            {children}
          </fieldset>
        </>
      )}
    </div>
  );
}
