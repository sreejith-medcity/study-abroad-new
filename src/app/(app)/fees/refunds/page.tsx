import Link from "next/link";
import { fmtDate, fullName } from "@/lib/format";
import { FEE_METHOD_LABEL, rupees } from "@/lib/student-fees";
import { refundList, requireFees } from "@/server/student-fees";
import { Card, EmptyState, Table, Td, Th } from "@/components/ui";
import { DecideRefund, PayRefund } from "@/components/fee-forms";

export const metadata = { title: "Refunds" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { REQUESTED: "Waiting for a decision", APPROVED: "Approved, not yet paid", REJECTED: "Rejected", PAID: "Paid out" };

/**
 * Money going back to students. Anybody who takes fees may ask; finance or
 * the head office decides, and never on a request of their own.
 */
export default async function RefundsPage() {
  const { user, access } = await requireFees();
  const rows = await refundList(user);
  if (rows.length === 0) return <EmptyState title="No refunds">A refund is asked for on the student&rsquo;s Fees tab, against the invoice the money was paid on.</EmptyState>;
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Refund</Th>
            <Th>Student</Th>
            <Th>Invoice</Th>
            <Th className="text-right">Amount</Th>
            <Th>Asked for</Th>
            <Th>Where it is</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ refund: r, invoiceNumber, branch, requestedBy, ...s }) => (
            <tr key={r.id} data-refund={r.number}>
              <Td className="font-mono text-xs">{r.number}</Td>
              <Td>
                <Link href={`/students/${r.studentId}/fees`} className="font-medium hover:underline">
                  {fullName(s)}
                </Link>
                <span className="block text-xs text-muted">{branch}</span>
              </Td>
              <Td className="font-mono text-xs">{invoiceNumber}</Td>
              <Td className="text-right tabular">{rupees(r.amount)}</Td>
              <Td>
                {requestedBy}, {fmtDate(r.createdAt)}
                <span className="block max-w-xs text-xs text-muted">{r.reason}</span>
              </Td>
              <Td>
                {LABEL[r.state]}
                {r.decisionNote && <span className="block text-xs text-muted">{r.decisionNote}</span>}
                {r.payoutReference && (
                  <span className="block text-xs text-muted">
                    {r.payoutMethod ? FEE_METHOD_LABEL[r.payoutMethod] : ""} {r.payoutReference}
                  </span>
                )}
              </Td>
              <Td className="w-64">
                {access.desk && r.state === "REQUESTED" && (r.requestedById === user.id ? <span className="text-xs text-muted">Your own request: somebody else decides it</span> : <DecideRefund refundId={r.id} />)}
                {access.desk && r.state === "APPROVED" && <PayRefund refundId={r.id} />}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
