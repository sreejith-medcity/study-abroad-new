import Link from "next/link";
import { fmtDate, fullName } from "@/lib/format";
import { AGEING_BUCKETS, AGEING_LABEL, ageingTable, istToday, longestOverdue, rupees } from "@/lib/student-fees";
import { openBalances, requireFees } from "@/server/student-fees";
import { Card, CardHeader, EmptyState, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Fee ageing" };
export const dynamic = "force-dynamic";

/**
 * What students owe, by branch and by how late: not yet due, then thirty-day
 * steps to over ninety. Every issued invoice with a balance is in it; a draft
 * is not owed yet and a written-off one is not owed any more.
 */
export default async function FeeAgeingPage() {
  const { user } = await requireFees();
  const today = istToday();
  const rows = await openBalances(user);
  const table = ageingTable(rows, today);
  const oldest = longestOverdue(rows, today, 25);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Receivables ageing"
          subtitle={`Balances due as on ${fmtDate(today)}, by the student's branch.`}
          action={
            <a href="/api/fees/ageing" className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
              Download CSV
            </a>
          }
        />
        {rows.length === 0 ? (
          <div className="p-4 pt-0">
            <EmptyState title="Nothing is owed">No issued invoice has a balance on it.</EmptyState>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th className="text-right">Invoices</Th>
                {AGEING_BUCKETS.map((b) => (
                  <Th key={b} className="text-right">
                    {AGEING_LABEL[b]}
                  </Th>
                ))}
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {[...table.branches, table.all].map((r) => (
                <tr key={r.branch} data-branch={r.branch} className={r === table.all ? "font-semibold" : undefined}>
                  <Td>{r.branch}</Td>
                  <Td className="text-right tabular">{r.invoices}</Td>
                  {AGEING_BUCKETS.map((b) => (
                    <Td key={b} className="text-right tabular">
                      {rupees(r[b])}
                    </Td>
                  ))}
                  <Td className="text-right tabular">{rupees(r.total)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {oldest.length > 0 && (
        <Card>
          <CardHeader title="Longest overdue" subtitle="The invoices furthest past their due date, the largest first among equals." />
          <Table>
            <thead>
              <tr>
                <Th>Invoice</Th>
                <Th>Student</Th>
                <Th>Branch</Th>
                <Th>Due on</Th>
                <Th className="text-right">Days late</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {oldest.map((r) => (
                <tr key={r.id} data-overdue={r.number}>
                  <Td className="font-mono text-xs">{r.number}</Td>
                  <Td>
                    <Link href={`/students/${r.studentId}/fees`} className="hover:underline">
                      {fullName(r)}
                    </Link>
                  </Td>
                  <Td>{r.branch}</Td>
                  <Td>{fmtDate(r.dueOn)}</Td>
                  <Td className="text-right tabular">{r.days}</Td>
                  <Td className="text-right tabular">{rupees(r.balance)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
