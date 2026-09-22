import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import { Chip, Table, Td, Th } from "./ui";

type Row = { id: string; status: "CREATED" | "PAID" | "FAILED"; amountMinor: number; currency: string; orderId: string; paymentId: string | null; failureReason: string | null; createdAt: Date; paidAt: Date | null; orgName: string; ackNo: string | null; studentId: string | null; applicationId: string | null };

const amount = (minor: number, cur: string) => `${cur} ${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PaymentTable({ rows, showOrg }: { rows: Row[]; showOrg: boolean }) {
  return (
    <Table tableClassName="min-w-[720px]">
      <thead>
        <tr>
          <Th>When</Th>
          {showOrg && <Th>Partner</Th>}
          <Th>For</Th>
          <Th className="text-right">Amount</Th>
          <Th>State</Th>
          <Th>Razorpay</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(r.paidAt ?? r.createdAt)}</Td>
            {showOrg && <Td className="text-[13px]">{r.orgName}</Td>}
            <Td className="text-[13px]">
              Application fee
              {r.ackNo && r.studentId && (
                <Link href={`/students/${r.studentId}/applications?app=${r.applicationId}`} className="ml-1 text-brand-600 hover:underline">{r.ackNo}</Link>
              )}
            </Td>
            <Td className="whitespace-nowrap text-right font-semibold tabular">{amount(r.amountMinor, r.currency)}</Td>
            <Td>
              {r.status === "PAID" ? <Chip tone="ok">Paid</Chip> : r.status === "FAILED" ? <Chip tone="bad">Failed</Chip> : <Chip>Not completed</Chip>}
              {r.failureReason && <p className="mt-1 text-xs text-muted">{r.failureReason}</p>}
            </Td>
            <Td className="font-mono text-[11px] text-muted">{r.paymentId ?? r.orderId}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
