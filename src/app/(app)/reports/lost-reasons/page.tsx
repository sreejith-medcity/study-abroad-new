import Link from "next/link";
import { asc, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { istDay } from "@/lib/journal";
import { isHeadOffice } from "@/lib/enquiry-routing";
import { NOT_RECORDED, reportPeriod, tallyLost, type Tally } from "@/lib/lost-reasons";
import { lostInPeriod, mayReadLostReport } from "@/server/lost-reasons";
import { SOURCE_LABEL } from "@/server/enquiries";
import { Alert, Button, Card, CardHeader, DateInput, EmptyState, LinkButton, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Lost reasons" };

const SHOWN = 200;

function TallyTable({ title, rows, total }: { title: string; rows: Tally[]; total: number }) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">None in this period.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>{title.replace(/^By /, "").replace(/^./, (c) => c.toUpperCase())}</Th>
              <Th className="text-right">Enquiries</Th>
              <Th className="text-right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <Td>{r.label === NOT_RECORDED ? <span className="text-muted">{NOT_RECORDED}</span> : r.label}</Td>
                <Td className="text-right tabular">{r.count}</Td>
                <Td className="text-right tabular">{total ? `${Math.round(r.share * 100)}%` : ""}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/**
 * Why enquiries were lost, for a period: by reason, by source and by branch,
 * with the enquiries behind the counts and a CSV of the lot. The head office
 * and management read every branch; a branch head reads their own.
 */
export default async function LostReasonsReport({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; org?: string }> }) {
  const user = await requireUser();
  if (!mayReadLostReport(user)) {
    return (
      <>
        <PageHeader title="Lost reasons" />
        <Alert tone="info">This report is for the head office, management and branch heads.</Alert>
      </>
    );
  }
  const sp = await searchParams;
  const period = reportPeriod(sp.from, sp.to, istDay());
  const everyBranch = isHeadOffice(user) || user.role === "MANAGEMENT";
  const org = everyBranch && sp.org ? sp.org : null;
  const [rows, orgs] = await Promise.all([
    lostInPeriod(user, period, org),
    everyBranch
      ? db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(ne(schema.organizations.type, "HQ")).orderBy(asc(schema.organizations.name))
      : Promise.resolve([]),
  ]);
  const t = tallyLost(rows, (s) => SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s);
  const unrecorded = rows.filter((r) => !r.reason).length;
  const qs = new URLSearchParams({ from: period.from, to: period.to, ...(org ? { org } : {}) }).toString();

  return (
    <>
      <PageHeader
        title="Lost reasons"
        subtitle={`Enquiries closed as lost from ${fmtDate(`${period.from}T00:00:00`)} to ${fmtDate(`${period.to}T00:00:00`)}${everyBranch ? "" : `, ${user.orgName}`}.`}
        actions={
          <LinkButton href={`/api/reports/lost-reasons?${qs}`} variant="secondary" prefetch={false}>
            Download CSV
          </LinkButton>
        }
      />
      <Card className="p-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <DateInput label="From" name="from" defaultValue={period.from} />
          <DateInput label="To" name="to" defaultValue={period.to} />
          {everyBranch && (
            <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
              Branch
              <Select name="org" defaultValue={org ?? ""} className="mt-1">
                <option value="">Every branch</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </label>
          )}
          <Button type="submit" variant="secondary" size="sm">Show</Button>
        </form>
      </Card>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Stat label="Lost in the period" value={t.total} tone="stop" />
        <Stat label="No reason picked (closed before the list)" value={unrecorded} tone="warn" />
      </div>

      {t.total === 0 ? (
        <div className="mt-5">
          <EmptyState title="Nothing lost in this period">Pick a longer period, or another branch.</EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <TallyTable title="By reason" rows={t.byReason} total={t.total} />
            <TallyTable title="By source" rows={t.bySource} total={t.total} />
            <TallyTable title="By branch" rows={t.byBranch} total={t.total} />
          </div>
          <Card className="mt-5">
            <CardHeader title="The enquiries" subtitle={rows.length > SHOWN ? `The latest ${SHOWN} of ${rows.length}; the CSV has them all` : `${rows.length}`} />
            <Table>
              <thead>
                <tr>
                  <Th>Enquiry</Th>
                  <Th>Branch</Th>
                  <Th>Source</Th>
                  <Th>Reason</Th>
                  <Th>Owner</Th>
                  <Th>Lost on</Th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOWN).map((r) => (
                  <tr key={r.id}>
                    <Td>
                      {user.role === "MANAGEMENT" ? r.name : (
                        <Link href={`/enquiries/${r.id}`} className="font-medium text-brand-600 hover:underline">{r.name}</Link>
                      )}
                    </Td>
                    <Td>{r.branch}</Td>
                    <Td>{SOURCE_LABEL[r.source]}</Td>
                    <Td>
                      {r.reason ?? <span className="text-muted">{NOT_RECORDED}</span>}
                      {r.detail && <span className="block text-xs text-muted">{r.detail}</span>}
                    </Td>
                    <Td>{r.owner ?? "Unassigned"}</Td>
                    <Td>{r.lostOn ? fmtDate(r.lostOn) : NOT_RECORDED}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
