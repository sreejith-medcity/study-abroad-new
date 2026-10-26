import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { fmtDateTime } from "@/lib/format";
import { ENTITY_LABEL, feedWindow, fieldLabel, readFeedCursor, readHistoryFilters, showValue, type HistoryEntity } from "@/lib/record-history";
import { can } from "@/server/capabilities";
import { feedBranches, feedViewer, mayReadLedger } from "@/server/history-feed";
import { feedPage, feedPeople, feedWhere, nameBook, recordTitles } from "@/server/record-history";
import { actionLabel } from "@/components/record-history";
import { Button, Card, Chip, DateInput, EmptyState, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { IconExport } from "@/components/icons";

export const metadata = { title: "Change history" };
export const dynamic = "force-dynamic";

const PAGE = 50;

/**
 * Every change to students, enquiries, applications and staff accounts that
 * this person may read, newest first. The head office reads every record, a
 * branch head their branch, a counsellor their own; a row about a record the
 * reader could not open is never listed, whatever the filters say.
 */
export default async function ChangeHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const f = readHistoryFilters(sp);
  const cursor = readFeedCursor(sp);
  const viewer = await feedViewer(user);
  const where = feedWhere(viewer, f);
  const [fetched, people, branches, fullPassport] = await Promise.all([
    feedPage(where, PAGE + 1, cursor),
    feedPeople(viewer),
    viewer.headOffice ? feedBranches() : Promise.resolve([]),
    can(user, "SEE_FULL_PASSPORT"),
  ]);
  const { rows: list, older, newer } = feedWindow(fetched, PAGE, cursor);
  const [names, titles] = await Promise.all([nameBook(list), recordTitles(list)]);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(f as Record<string, string>), ...extra }).toString();
  const scopeLine = viewer.headOffice
    ? "Every branch."
    : viewer.seesBranch
      ? `${user.orgName} only.`
      : "Your own students, enquiries and account only.";

  return (
    <>
      <PageHeader
        title="Change history"
        subtitle={`Who changed which field on a student, an enquiry, an application or a staff account, from what to what, and when. ${scopeLine}`}
        actions={
          <LinkButton variant="secondary" href={`/api/history/export?${new URLSearchParams(f as Record<string, string>).toString()}`}>
            <IconExport className="size-4" /> Download CSV
          </LinkButton>
        }
      />

      <Card className="mb-4 p-4">
        <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6 [&>*]:min-w-0" data-history-filters>
          <Select name="entity" aria-label="Record type" defaultValue={f.entity ?? ""}>
            <option value="">Every kind of record</option>
            {(Object.keys(ENTITY_LABEL) as HistoryEntity[]).map((e) => (
              <option key={e} value={e}>
                {ENTITY_LABEL[e]}
              </option>
            ))}
          </Select>
          <Select name="by" aria-label="Who" defaultValue={f.by ?? ""}>
            <option value="">Anyone</option>
            <option value="system">The portal itself</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {viewer.headOffice ? (
            <Select name="org" aria-label="Branch" defaultValue={f.org ?? ""}>
              <option value="">Every branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : (
            <span />
          )}
          <DateInput label="From" name="from" defaultValue={f.from} />
          <DateInput label="To" name="to" defaultValue={f.to} />
          <div className="flex items-end gap-2">
            <Button type="submit">Filter</Button>
            <LinkButton variant="quiet" href="/admin/history">
              Clear
            </LinkButton>
          </div>
        </form>
      </Card>

      <Card>
        {list.length === 0 ? (
          <EmptyState title="No changes for these filters">Changes are kept from the day version history was switched on. Widen the dates or clear the filters.</EmptyState>
        ) : (
          <Table tableClassName="min-w-[960px]">
            <thead>
              <tr>
                <Th className="w-44">When</Th>
                <Th className="w-44">Who</Th>
                <Th className="w-56">Record</Th>
                <Th>What changed</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const t = titles.get(r.entityId);
                return (
                  <tr key={r.id} data-history-row={r.entity}>
                    <Td className="whitespace-nowrap text-muted tabular">{fmtDateTime(r.createdAt)}</Td>
                    <Td>{r.by ?? (r.byId ? "Not recorded" : <Chip>The portal</Chip>)}</Td>
                    <Td>
                      <p className="text-xs uppercase tracking-wide text-muted">
                        {ENTITY_LABEL[r.entity]}
                        {r.org ? ` · ${r.org}` : ""}
                      </p>
                      {t?.href ? (
                        <Link href={t.href} className="font-medium text-brand-600 hover:underline">
                          {t.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{t?.title ?? "No longer on file"}</span>
                      )}
                    </Td>
                    <Td>
                      <p className="mb-1 text-xs text-muted">{actionLabel(r.action)}</p>
                      <ul className="space-y-0.5 text-sm">
                        {r.changes.slice(0, 4).map((c) => (
                          <li key={c.field}>
                            <span className="text-muted">{fieldLabel(r.entity, c.field)}:</span> {showValue(r.entity, c.field, c.before, names, { fullPassport })} <span className="text-muted">to</span>{" "}
                            <span className="font-medium">{showValue(r.entity, c.field, c.after, names, { fullPassport })}</span>
                          </li>
                        ))}
                        {r.changes.length > 4 && <li className="text-muted">and {r.changes.length - 4} more</li>}
                      </ul>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {(cursor || older || newer) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-md" data-history-pager>
            <span className="text-muted">
              Newest first.{" "}
              {cursor && (
                <Link href={`/admin/history?${qs({})}`} className="font-medium text-brand-600 hover:underline">
                  Back to the newest
                </Link>
              )}
            </span>
            <div className="flex gap-2">
              {newer && (
                <LinkButton variant="secondary" href={`/admin/history?${qs({ before: newer })}`}>
                  Previous
                </LinkButton>
              )}
              {older && (
                <LinkButton variant="secondary" href={`/admin/history?${qs({ after: older })}`}>
                  Next
                </LinkButton>
              )}
            </div>
          </div>
        )}
      </Card>
      {mayReadLedger(user) && (
        <p className="mt-3 text-sm text-muted">
          Who has owned each student and enquiry over time is kept separately, on the{" "}
          <Link href="/admin/ledger" className="font-medium text-brand-600 hover:underline">
            ownership ledger
          </Link>
          .
        </p>
      )}
    </>
  );
}
