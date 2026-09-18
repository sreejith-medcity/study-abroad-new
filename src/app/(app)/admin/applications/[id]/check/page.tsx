import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { summarise } from "@/lib/checks";
import { fullName, intakeLabel } from "@/lib/format";
import { checkApplication } from "@/server/applications";
import { Button, Card, Chip, PageHeader, StatusBadge } from "@/components/ui";
import { askPartnerAction } from "@/app/(app)/students/[id]/applications/actions";
import { PROCESSING_ROLES } from "@/lib/permissions";

export const metadata = { title: "Pre-submission check" };

export default async function CheckPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser([...PROCESSING_ROLES]);
  const { id } = await params;
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, id),
    with: { status: true, student: true, org: true, program: { with: { university: { with: { country: true } } } } },
  });
  if (!app) notFound();
  const results = await checkApplication(id);
  const { blockers, warnings } = summarise(results);

  return (
    <div className="max-w-3xl">
      <nav className="mb-3 text-muted"><Link href="/admin/queue" className="hover:underline">Work queue</Link> › Check</nav>
      <PageHeader
        title={`Ready to submit? ${app.ackNo}`}
        subtitle={`${fullName(app.student)} · ${app.program.name}, ${app.program.university.name} · ${intakeLabel(app.intakeMonth, app.intakeYear)} · ${app.org.name}`}
        actions={<StatusBadge group={app.status.group} label={app.status.label} className="text-sm" />}
      />
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-2">
          {blockers > 0 && <Chip tone="bad">{blockers} blocker{blockers > 1 ? "s" : ""}</Chip>}
          {warnings > 0 && <Chip tone="warn">{warnings} warning{warnings > 1 ? "s" : ""}</Chip>}
          {blockers + warnings === 0 && <Chip tone="ok">All checks pass</Chip>}
        </div>
        <ul className="divide-y divide-line">
          {results.map((r) => (
            <li key={r.code} className="flex items-center gap-3 py-2.5">
              <Chip tone={r.severity === "blocker" ? "bad" : r.severity === "warning" ? "warn" : "ok"} className="w-20 justify-center">{r.severity === "blocker" ? "Blocker" : r.severity === "warning" ? "Warning" : "Pass"}</Chip>
              <span className="flex-1">{r.message}</span>
              {r.section && <Link href={`/students/${app.studentId}/${r.section}`} className="text-xs text-brand-600 hover:underline">View</Link>}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {blockers + warnings > 0 && (
            <form action={askPartnerAction}>
              <input type="hidden" name="applicationId" value={app.id} />
              <Button variant="secondary">Send all to partner as one request</Button>
            </form>
          )}
          <Link href={`/students/${app.studentId}/applications?app=${app.id}`} className="text-brand-600 hover:underline">Open application to change status</Link>
          <p className="w-full text-xs text-muted">Partners see the same checks on the application before it reaches you, which is what cuts the back-and-forth.</p>
        </div>
      </Card>
    </div>
  );
}
