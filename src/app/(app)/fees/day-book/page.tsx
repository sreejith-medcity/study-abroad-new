import { fmtDate, fullName } from "@/lib/format";
import { COUNTER_METHODS, FEE_METHOD_LABEL, isDay, istToday, rupees, type FeeMethod } from "@/lib/student-fees";
import { receiptsBetween, refundsPaidBetween, requireFees } from "@/server/student-fees";
import { Card, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Day book" };
export const dynamic = "force-dynamic";

const METHODS: FeeMethod[] = [...COUNTER_METHODS, "RAZORPAY"];

/**
 * One day's receipts by branch and by method, for closing the cash and the
 * bank. Refunds paid out that day are listed under it, apart from the
 * receipts, so the drawer can be counted both ways.
 */
export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { user } = await requireFees();
  const today = istToday();
  const asked = (await searchParams).day ?? "";
  const day = isDay(asked) && asked <= today ? asked : today;
  const [rows, refunds] = await Promise.all([receiptsBetween(user, day, day), refundsPaidBetween(user, new Date(`${day}T00:00:00+05:30`), new Date(`${day}T23:59:59.999+05:30`))]);
  const branches = [...new Set(rows.map((r) => r.branch))].sort();
  const cell = (branch: string | null, m: FeeMethod | null) => rows.filter((r) => (!branch || r.branch === branch) && (!m || r.receipt.method === m)).reduce((s, r) => s + r.receipt.amount, 0);
  return (
    <div className="space-y-4">
      <form className="flex flex-wrap items-end gap-2" action="/fees/day-book">
        <label className="text-xs text-muted">
          Day
          <input type="date" name="day" defaultValue={day} max={today} className="mt-1 block rounded-lg border border-line-strong bg-surface px-2 py-1 text-sm" />
        </label>
        <button className="rounded-lg border border-line-strong px-3 py-1.5 text-sm">Show</button>
        <a href={`/api/fees/day-book?day=${day}`} className="ml-auto rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
          Download CSV
        </a>
      </form>
      <Card>
        <CardHeader title={`Receipts on ${fmtDate(day)}`} subtitle="By the branch that took them and how they were paid." />
        {rows.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState title="Nothing received this day">Receipts recorded at the counter or by Razorpay appear here on the day they were received.</EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Branch</Th>
                {METHODS.map((m) => (
                  <Th key={m} className="text-right">
                    {FEE_METHOD_LABEL[m]}
                  </Th>
                ))}
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {[...branches, null].map((b) => (
                <tr key={b ?? "all"} data-daybook={b ?? "All branches"} className={b ? undefined : "font-semibold"}>
                  <Td>{b ?? "All branches"}</Td>
                  {METHODS.map((m) => (
                    <Td key={m} className="text-right tabular">
                      {rupees(cell(b, m))}
                    </Td>
                  ))}
                  <Td className="text-right tabular">{rupees(cell(b, null))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {rows.length > 0 && (
        <Card>
          <CardHeader title="Every receipt" />
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th>Branch</Th>
                <Th>Student</Th>
                <Th>How</Th>
                <Th className="text-right">Amount</Th>
                <Th>Recorded by</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.receipt.id}>
                  <Td className="font-mono text-xs">{r.receipt.number}</Td>
                  <Td>{r.branch}</Td>
                  <Td>{fullName(r)}</Td>
                  <Td>
                    {FEE_METHOD_LABEL[r.receipt.method]}
                    {r.receipt.reference && <span className="block text-xs text-muted">{r.receipt.reference}</span>}
                  </Td>
                  <Td className="text-right tabular">{rupees(r.receipt.amount)}</Td>
                  <Td>{r.by ?? (r.receipt.method === "RAZORPAY" ? "Razorpay" : "Not recorded")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {refunds.length > 0 && (
        <Card>
          <CardHeader title="Refunds paid out this day" />
          <Table>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.refund.id}>
                  <Td className="font-mono text-xs">{r.refund.number}</Td>
                  <Td>{r.branch}</Td>
                  <Td>{fullName(r)}</Td>
                  <Td>{r.refund.payoutMethod ? FEE_METHOD_LABEL[r.refund.payoutMethod] : "Not recorded"}</Td>
                  <Td className="text-right tabular">{rupees(r.refund.amount)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
