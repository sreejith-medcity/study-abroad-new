import Link from "next/link";
import { fmtDate, fullName } from "@/lib/format";
import { ageOf, balanceDue, fullyRefunded, invoiceStateLabel, istToday, rupees, type FeeInvoiceState } from "@/lib/student-fees";
import { branchOptions, invoiceList, openBalances, receiptsBetween, requireFees } from "@/server/student-fees";
import { Card, Chip, EmptyState, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Student fees" };
export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string }[] = [
  { key: "OPEN", label: "Open" },
  { key: "DRAFT", label: "Drafts" },
  { key: "PAID", label: "Paid" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "WRITTEN_OFF", label: "Written off" },
  { key: "ALL", label: "All" },
];

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ state?: string; branch?: string }> }) {
  const { user } = await requireFees();
  const sp = await searchParams;
  const state = FILTERS.some((f) => f.key === sp.state) ? sp.state! : "OPEN";
  const branches = await branchOptions(user);
  const orgId = branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const today = istToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [rows, open, month] = await Promise.all([
    invoiceList(user, { state: state === "ALL" ? undefined : (state as FeeInvoiceState | "OPEN"), orgId }),
    openBalances(user),
    receiptsBetween(user, monthStart, today),
  ]);
  const scoped = orgId ? open.filter((o) => o.orgId === orgId) : open;
  const due = scoped.reduce((s, r) => s + r.balance, 0);
  const late = scoped.filter((r) => ageOf(r.dueOn, today).days > 0);
  const lateSum = late.reduce((s, r) => s + r.balance, 0);
  const collected = month.filter((m) => !orgId || m.receipt.orgId === orgId).reduce((s, m) => s + m.receipt.amount, 0);
  const href = (k: string, b = orgId) => `/fees?${new URLSearchParams({ state: k, ...(b ? { branch: b } : {}) })}`;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Due now and coming</p>
          <p className="text-lg font-semibold">{rupees(due)}</p>
          <p className="text-xs text-muted">{scoped.length} open invoice{scoped.length === 1 ? "" : "s"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Overdue</p>
          <p className={late.length ? "text-lg font-semibold text-stop-700" : "text-lg font-semibold"}>{rupees(lateSum)}</p>
          <p className="text-xs text-muted">
            {late.length} past the due date. <Link href="/fees/ageing" className="text-brand-600 hover:underline">Ageing</Link>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted">Received this month</p>
          <p className="text-lg font-semibold">{rupees(collected)}</p>
          <p className="text-xs text-muted">
            Since {fmtDate(monthStart)}. <Link href="/fees/day-book" className="text-brand-600 hover:underline">Day book</Link>
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={href(f.key)} aria-current={f.key === state ? "page" : undefined} className={f.key === state ? "rounded-full bg-brand-600 px-3 py-1 text-sm text-white" : "rounded-full border border-line px-3 py-1 text-sm text-ink-soft hover:bg-surface-2"}>
            {f.label}
          </Link>
        ))}
        {branches.length > 0 && (
          <form className="ml-auto flex items-center gap-2" action="/fees">
            <input type="hidden" name="state" value={state} />
            <select name="branch" defaultValue={orgId ?? ""} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm" aria-label="Branch">
              <option value="">Every branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <button className="rounded-lg border border-line-strong px-2 py-1 text-sm">Show</button>
          </form>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No invoices here">Invoices are raised on a student&rsquo;s Fees tab, from their fee plan or by hand.</EmptyState>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Student</Th>
                <Th>Branch</Th>
                <Th>Due</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Received</Th>
                <Th className="text-right">Balance</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ invoice: i, firstName, lastName, medcityId, branch }) => {
                const bal = balanceDue(i.total, i.received);
                const days = i.dueOn && (i.state === "ISSUED" || i.state === "PART_PAID") ? ageOf(i.dueOn, today).days : 0;
                return (
                  <tr key={i.id} data-invoice={i.number ?? "draft"}>
                    <Td className="font-mono text-xs">{i.number ? <Link href={`/print/fees/invoice/${i.id}`} target="_blank" className="text-brand-600 hover:underline">{i.number}</Link> : "Draft"}</Td>
                    <Td>
                      <Link href={`/students/${i.studentId}/fees`} className="font-medium hover:underline">
                        {fullName({ firstName, lastName })}
                      </Link>
                      {medcityId && <span className="block font-mono text-2xs text-muted">{medcityId}</span>}
                    </Td>
                    <Td>{branch}</Td>
                    <Td>
                      {i.dueOn ? fmtDate(i.dueOn) : "Not recorded"}
                      {days > 0 && <span className="block text-xs text-stop-700">{days} days late</span>}
                    </Td>
                    <Td className="text-right tabular">{rupees(i.total)}</Td>
                    <Td className="text-right tabular">{rupees(i.received - i.refunded)}</Td>
                    <Td className="text-right tabular">{bal == null ? "Not recorded" : rupees(bal)}</Td>
                    <Td>
                      <Chip tone={fullyRefunded(i) && i.state !== "CANCELLED" ? "neutral" : i.state === "PAID" ? "ok" : i.state === "PART_PAID" ? "warn" : i.state === "WRITTEN_OFF" ? "bad" : i.state === "ISSUED" ? "info" : "neutral"}>{invoiceStateLabel(i)}</Chip>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
