import Link from "next/link";
import { and, asc, count, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime, fullName } from "@/lib/format";
import { PROCESSING_ROLES } from "@/lib/permissions";
import { SERVICE_LABEL, SERVICE_STATUSES, SERVICE_TYPES, STATUS_LABEL, STATUS_TONE, type ServiceStatus, type ServiceType } from "@/lib/services";
import { readFilters } from "@/server/queries";
import { Button, Card, Chip, EmptyState, LinkButton, PageHeader, Select, Toolbar } from "@/components/ui";
import { UpdateServiceForm } from "@/components/service-forms";

export const metadata = { title: "Services" };

const PAGE = 50;

/** Every service request across branches, open ones first and oldest first, so nothing waits unseen. */
export default async function ServicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser([...PROCESSING_ROLES]);
  const f = readFilters(await searchParams) as Record<string, string>;
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const sr = schema.serviceRequests;
  const conds: (SQL | undefined)[] = [];
  const status = (SERVICE_STATUSES as readonly string[]).includes(f.status) ? (f.status as ServiceStatus) : undefined;
  if (status) conds.push(eq(sr.status, status));
  else if (f.status !== "all") conds.push(sql`${sr.status} in ('NEW', 'IN_PROGRESS')`);
  if ((SERVICE_TYPES as readonly string[]).includes(f.type)) conds.push(eq(sr.type, f.type as ServiceType));
  if (f.org) conds.push(eq(sr.orgId, f.org));
  const where = and(...conds);

  const rows = await db.query.serviceRequests.findMany({
    where,
    with: { student: { columns: { id: true, firstName: true, lastName: true } }, org: { columns: { name: true } }, requestedBy: { columns: { name: true } }, owner: { columns: { name: true } } },
    orderBy: [sql`${sr.status} = 'NEW' desc`, asc(sr.createdAt)],
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const [{ total }] = await db.select({ total: count() }).from(sr).where(where);
  const byStatus = await db.select({ status: sr.status, n: count() }).from(sr).groupBy(sr.status);
  const orgs = await db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(sql`${schema.organizations.type} <> 'HQ'`).orderBy(asc(schema.organizations.name));
  const qs = (extra: Record<string, string>) => `/admin/services?${new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v))}`;

  return (
    <>
      <PageHeader
        title="Services"
        subtitle={`${byStatus.find((b) => b.status === "NEW")?.n ?? 0} new, ${byStatus.find((b) => b.status === "IN_PROGRESS")?.n ?? 0} in progress. Loans, forex, accommodation, insurance and flights for students.`}
      />
      <Toolbar>
        <form className="grid w-full gap-2.5 sm:grid-cols-4 [&>*]:min-w-0">
          <Select name="status" aria-label="Status" defaultValue={f.status ?? ""}>
            <option value="">Open (new and in progress)</option>
            {SERVICE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            <option value="all">Everything</option>
          </Select>
          <Select name="type" aria-label="Service" defaultValue={f.type ?? ""}>
            <option value="">Any service</option>
            {SERVICE_TYPES.map((t) => <option key={t} value={t}>{SERVICE_LABEL[t]}</option>)}
          </Select>
          <Select name="org" aria-label="Branch" defaultValue={f.org ?? ""}>
            <option value="">Every branch</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <LinkButton href="/admin/services" variant="quiet" size="sm">Clear</LinkButton>
            <Button type="submit" size="sm">Filter</Button>
          </div>
        </form>
      </Toolbar>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Nothing here">No service requests match these filters.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{SERVICE_LABEL[r.type]}</p>
                    <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                  </div>
                  <p className="text-[13px]">
                    <Link href={`/students/${r.student.id}/services`} className="font-medium text-brand-600 hover:underline">{fullName(r.student)}</Link>
                    <span className="text-muted"> · {r.org.name}</span>
                  </p>
                  <p className="whitespace-pre-wrap text-[13px] text-ink-soft">{r.details}</p>
                  <p className="text-xs text-muted">
                    Asked {fmtDateTime(r.createdAt)}{r.requestedBy ? ` by ${r.requestedBy.name}` : ""}
                    {r.owner ? ` · Handled by ${r.owner.name}` : ""}
                  </p>
                </div>
                <UpdateServiceForm id={r.id} status={r.status} provider={r.provider} teamNote={r.teamNote} />
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || page * PAGE < total) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px]">
            <span className="text-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
            <div className="flex gap-2">
              {page > 1 && <LinkButton variant="secondary" size="sm" href={qs({ page: String(page - 1) })}>Previous</LinkButton>}
              {page * PAGE < total && <LinkButton variant="secondary" size="sm" href={qs({ page: String(page + 1) })}>Next</LinkButton>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
