import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { APP_ROLES, PROCESSING_ROLES } from "@/lib/permissions";
import { SERVICE_LABEL, STATUS_LABEL, STATUS_TONE } from "@/lib/services";
import { getStudentForUser } from "@/server/queries";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui";
import { RequestServiceForm, UpdateServiceForm } from "@/components/service-forms";

export const metadata = { title: "Services" };

export default async function StudentServicesPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const { id } = await params;
  const student = await getStudentForUser(user, id);
  const canRequest = user.role !== "MANAGEMENT";
  const canWork = (PROCESSING_ROLES as readonly string[]).includes(user.role);
  const rows = await db.query.serviceRequests.findMany({
    where: eq(schema.serviceRequests.studentId, student.id),
    with: { requestedBy: { columns: { name: true } }, owner: { columns: { name: true } } },
    orderBy: desc(schema.serviceRequests.createdAt),
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardHeader title="Services" subtitle="Loans, forex, accommodation, insurance and flights, worked by the Overseas team" />
        {rows.length === 0 ? (
          <EmptyState title="Nothing requested yet">Ask for a service on the right and the Overseas team takes it from there.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{SERVICE_LABEL[r.type]}</p>
                  <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                </div>
                <p className="whitespace-pre-wrap text-[13px] text-ink-soft">{r.details}</p>
                <p className="text-xs text-muted">
                  Asked {fmtDateTime(r.createdAt)}{r.requestedBy ? ` by ${r.requestedBy.name}` : ""}
                  {r.provider ? ` · Provider: ${r.provider}` : ""}
                  {r.owner ? ` · Handled by ${r.owner.name}` : ""}
                </p>
                {r.teamNote && <p className="rounded-md bg-brand-50 px-3 py-2 text-[13px]">{r.teamNote}</p>}
                {canWork && (
                  <details>
                    <summary className="cursor-pointer text-[13px] font-medium text-brand-600">Update</summary>
                    <div className="mt-2"><UpdateServiceForm id={r.id} status={r.status} provider={r.provider} teamNote={r.teamNote} /></div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {canRequest && (
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">Request a service for {student.firstName}</h2>
          <RequestServiceForm studentId={student.id} />
        </Card>
      )}
    </div>
  );
}
