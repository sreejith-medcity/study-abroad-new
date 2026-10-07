import type { SessionUser } from "@/lib/auth";
import { ageing, invoiceList, queueByVendor } from "@/server/invoicing";
import { AGE_LABEL, AGE_ORDER } from "@/lib/invoicing";
import { fmtMoney } from "@/lib/format";
import { Card, CardHeader, Chip, DashboardHero, EmptyState, LinkButton, Stat, Table, Td, Th, cn } from "@/components/ui";
import { IconAlert, IconCheck, IconClock, IconQueue } from "@/components/icons";

/**
 * The money, for whoever is answerable for it.
 *
 * Four questions, in the order a finance person asks them: what can be invoiced
 * and is not, what is owed, what is late, and what has been credited back.
 * Amounts stay in the currency they were raised in: a vendor who settles in
 * pounds and one who settles in rupees do not add up to a number anybody can
 * check against a bank statement.
 */
export default async function FinanceDashboard({ user }: { user: SessionUser }) {
  const [vendors, aged, invoices] = await Promise.all([queueByVendor(), ageing(), invoiceList({})]);
  const ready = vendors.reduce((n, v) => n + v.ready.length, 0);
  const waiting = vendors.reduce((n, v) => n + v.waiting.length, 0);
  const unpriced = vendors.reduce((n, v) => n + v.unpriced.length, 0);
  const readyMoney: Record<string, number> = {};
  for (const v of vendors) for (const l of v.ready) readyMoney[l.currency] = (readyMoney[l.currency] ?? 0) + (l.amount ?? 0);
  const owed: Record<string, number> = {};
  for (const r of aged.invoices) owed[r.currency] = (owed[r.currency] ?? 0) + r.outstanding;
  const late = aged.invoices.filter((r) => r.bucket !== "NOT_DUE");
  const credited = invoices.reduce((n, r) => n + r.credited, 0);
  const amounts = (by: Record<string, number>) => (Object.keys(by).length === 0 ? "nothing" : Object.entries(by).map(([c, n]) => fmtMoney(n, c)).join(" + "));

  return (
    <div className="space-y-5">
      <DashboardHero
        eyebrow="Finance"
        title={`${ready} ready to invoice, ${aged.invoices.length} open`}
        subtitle={
          ready > 0
            ? `${amounts(readyMoney)} can be invoiced today. ${amounts(owed)} is outstanding across the open invoices.`
            : `Nothing is waiting to be invoiced. ${amounts(owed)} is outstanding across the open invoices.`
        }
        actions={
          <>
            <LinkButton href="/admin/invoices?tab=queue">What can be invoiced</LinkButton>
            <LinkButton href="/admin/invoices?tab=ageing" variant="secondary">
              What is late
            </LinkButton>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Stat icon={<IconQueue />} label="Ready to invoice" value={ready} />
          <p className="mt-1 text-xs text-muted">{amounts(readyMoney)}</p>
        </Card>
        <Card className="p-4">
          <Stat icon={<IconClock />} label="Open invoices" value={aged.invoices.length} />
          <p className="mt-1 text-xs text-muted">{amounts(owed)} outstanding</p>
        </Card>
        <Card className="p-4">
          <Stat icon={<IconAlert />} label="Late" value={late.length} tone={late.length > 0 ? "stop" : undefined} />
          <p className="mt-1 text-xs text-muted">{late.length > 0 ? "Past the date their terms gave" : "Nothing past its due date"}</p>
        </Card>
        <Card className="p-4">
          <Stat icon={<IconCheck />} label="Waiting on a milestone" value={waiting} />
          <p className="mt-1 text-xs text-muted">{unpriced > 0 ? `${unpriced} with no rate recorded at all` : "Every ready line has a rate"}</p>
        </Card>
      </div>

      {unpriced > 0 && (
        <Card className="border-amber-300 bg-amber-50/60 p-4 text-[13px]">
          <span className="font-medium">{unpriced} placement{unpriced === 1 ? " has" : "s have"} no rate on their route.</span> Those can never be invoiced until
          somebody records what the route pays. The terms live on Vendors and routes, which is an admin&rsquo;s screen, so this one is for them rather than you.
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What is owed, by how late it is" subtitle="Paid and written-off invoices are out of it. A credited part is already off." />
          <Table>
            <thead>
              <tr>
                <Th>How late</Th>
                <Th className="text-right">Invoices</Th>
                <Th className="text-right">Owed</Th>
              </tr>
            </thead>
            <tbody>
              {AGE_ORDER.map((bucket) => {
                const row = aged.buckets.get(bucket);
                return (
                  <tr key={bucket}>
                    <Td className={cn(bucket === "LATE_90" || bucket === "LATE_60" ? "font-medium text-stop-700" : undefined)}>{AGE_LABEL[bucket]}</Td>
                    <Td className="text-right tabular">{row?.count ?? 0}</Td>
                    <Td className="text-right tabular">{row ? amounts(row.amounts) : "nothing"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <p className="border-t border-line px-4 py-2.5 text-[13px]">
            <a href="/api/invoices/ageing-export" className="font-medium text-brand-600 hover:underline">Download the open invoices</a>
          </p>
        </Card>

        <Card>
          <CardHeader title="Who is slow to pay" subtitle="From your own invoices rather than an impression." />
          {aged.byVendor.length === 0 ? (
            <EmptyState title="Nothing outstanding">Every invoice raised has been settled.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Vendor</Th>
                  <Th className="text-right">Open</Th>
                  <Th className="text-right">Owed</Th>
                  <Th>Worst of them</Th>
                </tr>
              </thead>
              <tbody>
                {aged.byVendor.map((v) => (
                  <tr key={v.code}>
                    <Td>
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: v.colour }}>{v.code}</span>
                      <span className="ml-2">{v.vendor}</span>
                    </Td>
                    <Td className="text-right tabular">{v.count}</Td>
                    <Td className="text-right tabular">{amounts(v.amounts)}</Td>
                    <Td>
                      <Chip tone={v.worst === "LATE_90" || v.worst === "LATE_60" ? "bad" : v.worst === "LATE_30" ? "warn" : "neutral"}>{AGE_LABEL[v.worst]}</Chip>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {credited > 0 && (
        <Card className="p-4 text-[13px] text-muted">
          <span className="font-medium text-ink">Credited back across every invoice: {credited.toLocaleString("en-IN")}</span> in the currencies they were raised
          in. A credit note says part of an invoice was never owed, which is not the same as money arriving, and the two are kept apart on purpose.
        </Card>
      )}

      <p className="text-[13px] text-muted">
        Signed in as {user.deskLabel ?? user.name}. Students, applications and documents are not part of this role.
      </p>
    </div>
  );
}
