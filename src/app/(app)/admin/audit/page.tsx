import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { actionLabel, actionTone, auditBase, auditCount, auditFacets, auditOrder, auditWhere, metaPairs, readAuditFilters } from "@/server/audit-query";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { IconExport, IconShield } from "@/components/icons";

export const metadata = { title: "Audit log" };

const PAGE = 60;

/** Where an entity row can be opened, when the entity still exists. */
function entityHref(entityType: string, entityId: string) {
  if (entityId === "*") return null;
  switch (entityType) {
    case "student":
      return `/students/${entityId}/profile`;
    case "application":
      return `/applications?ack=${entityId}`;
    case "organization":
      return `/admin/partners#org-${entityId}`;
    case "program":
      return `/admin/programs`;
    default:
      return null;
  }
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(["SUPER_ADMIN"]);
  const f = readAuditFilters(await searchParams);
  const page = Math.max(1, Number(f.page ?? 1));
  const where = auditWhere(f);

  const [rows, facets, total] = await Promise.all([
    auditBase().where(where).orderBy(auditOrder()).limit(PAGE + 1).offset((page - 1) * PAGE),
    auditFacets(),
    auditCount(f),
  ]);
  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(f as Record<string, string>), ...extra }).toString();

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <IconShield className="size-4" /> Super admin
          </span>
        }
        title="Audit log"
        subtitle="Every action that touches a student, an application, a document or an account, with who did it and when."
        actions={
          <LinkButton variant="secondary" href={`/api/audit/export?${new URLSearchParams(f as Record<string, string>).toString()}`}>
            <IconExport className="size-4" /> Export CSV
          </LinkButton>
        }
      />

      <Card className="mb-4 p-4">
        <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-7 [&>*]:min-w-0">
          <Input name="q" placeholder="Search person or record" aria-label="Search" defaultValue={f.q} className="xl:col-span-2" />
          <Select name="actor" aria-label="Who" defaultValue={f.actor ?? ""}>
            <option value="">Anyone</option>
            <option value="system">System</option>
            {facets.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select name="action" aria-label="Action" defaultValue={f.action ?? ""}>
            <option value="">Any action</option>
            {facets.actions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
          <Select name="entityType" aria-label="Record type" defaultValue={f.entityType ?? ""}>
            <option value="">Any record</option>
            {facets.entityTypes.map((e) => (
              <option key={e} value={e}>
                {e.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 xl:col-span-2 [&>*]:min-w-0">
            <Input type="date" name="from" aria-label="From" defaultValue={f.from} />
            <Input type="date" name="to" aria-label="To" defaultValue={f.to} />
          </div>
          <div className="flex gap-2 sm:col-span-2 xl:col-span-7 xl:justify-end">
            <Button type="submit">Filter</Button>
            <LinkButton variant="quiet" href="/admin/audit">
              Clear
            </LinkButton>
          </div>
        </form>
      </Card>

      <Card>
        {list.length === 0 ? (
          <EmptyState title="Nothing recorded for these filters" icon={<IconShield className="size-6" />}>
            The log keeps every write action. Widen the dates or clear the filters.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[960px]">
            <thead>
              <tr>
                <Th className="w-44">When</Th>
                <Th className="w-56">Who</Th>
                <Th className="w-64">Action</Th>
                <Th>Record</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const href = entityHref(r.entityType, r.entityId);
                return (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-muted tabular">{fmtDateTime(r.createdAt)}</Td>
                    <Td>
                      {r.actorId ? (
                        <>
                          <p className="font-medium">{r.actorName}</p>
                          <p className="truncate text-xs text-muted">{r.actorEmail}</p>
                        </>
                      ) : (
                        <Chip>System</Chip>
                      )}
                    </Td>
                    <Td>
                      <Chip tone={actionTone(r.action)}>{actionLabel(r.action)}</Chip>
                      <p className="mt-1 font-mono text-[11px] text-muted/80">{r.action}</p>
                    </Td>
                    <Td>
                      <p className="text-xs uppercase tracking-wide text-muted">{r.entityType.replace(/_/g, " ")}</p>
                      {href ? (
                        <Link href={href} className="font-mono text-[11px] text-brand-600 hover:underline">
                          {r.entityId.slice(0, 12)}
                        </Link>
                      ) : (
                        <span className="font-mono text-[11px] text-muted">{r.entityId === "*" ? "all records" : r.entityId.slice(0, 12)}</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex max-w-md flex-wrap gap-1">
                        {metaPairs(r.meta).map(([k, v]) => (
                          <Chip key={k} tone="neutral">
                            <span className="text-muted">{k}</span> {v}
                          </Chip>
                        ))}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {(page > 1 || hasNext) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-muted">
              Page {page} of the newest entries first{total ? ` · ${total} total` : ""}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <LinkButton variant="secondary" href={`/admin/audit?${qs({ page: String(page - 1) })}`}>
                  Previous
                </LinkButton>
              )}
              {hasNext && (
                <LinkButton variant="secondary" href={`/admin/audit?${qs({ page: String(page + 1) })}`}>
                  Next
                </LinkButton>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
