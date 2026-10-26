import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isAdmin, worksStudentFiles } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { getApplicationForUser } from "@/server/queries";
import { nameBook, versionsOf } from "@/server/record-history";
import { RecordHistory } from "@/components/record-history";
import { Card } from "@/components/ui";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export const metadata = { title: "Application history" };
export const dynamic = "force-dynamic";

/** One application's history: status, officer, route, desk stage and dates, field by field. */
export default async function ApplicationHistoryPage({ params, searchParams }: { params: Promise<{ id: string; appId: string }>; searchParams: Promise<{ a?: string; b?: string; done?: string; why?: string }> }) {
  const { id, appId } = await params;
  const sp = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  const app = await getApplicationForUser(user, appId);
  if (app.studentId !== id) notFound();
  const [versions, creator] = await Promise.all([versionsOf("application", appId), db.query.users.findFirst({ where: eq(schema.users.id, app.createdById), columns: { name: true } })]);
  const names = await nameBook(versions);

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div>
          <p className="text-xs text-muted">Application</p>
          <p className="text-lg font-semibold tabular">{app.ackNo}</p>
        </div>
        <p className="text-sm text-muted">Created {fmtDateTime(app.createdAt)}</p>
        <Link href={`/students/${id}/applications?app=${appId}`} className="ml-auto text-sm font-medium text-brand-600 hover:underline">
          Back to the application
        </Link>
      </Card>
      <RecordHistory
        entity="application"
        versions={versions}
        names={names}
        // The same people as each field's own control: the priority is anybody's
        // who works the file, the rest the Overseas team's. The action asks again.
        canRestore={(field) => (field === "priority" ? worksStudentFiles(user) : isAdmin(user))}
        fullPassport={false}
        back={`/students/${id}/applications/${appId}/history`}
        a={sp.a}
        b={sp.b}
        done={sp.done}
        why={sp.why}
        started={{ at: app.createdAt, by: creator?.name ?? null }}
      />
    </div>
  );
}
