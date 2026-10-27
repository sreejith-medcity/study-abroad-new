import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { fmtDate, fullName } from "@/lib/format";
import { FEE_METHOD_LABEL, rupees, rupeesInWords } from "@/lib/student-fees";
import { mayPrint } from "../../access";
import { PaperHead, PaperShell } from "../../shell";

export const metadata = { title: "Fee receipt" };
export const dynamic = "force-dynamic";

/** A receipt as the student keeps it, with the amount in figures and in words. */
export default async function FeeReceiptPrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await db.query.feeReceipts.findFirst({ where: eq(schema.feeReceipts.id, id) });
  if (!receipt) notFound();
  const [invoice, student, org] = await Promise.all([
    db.query.feeInvoices.findFirst({ where: eq(schema.feeInvoices.id, receipt.invoiceId) }),
    db.query.students.findFirst({ where: eq(schema.students.id, receipt.studentId) }),
    db.query.organizations.findFirst({ where: eq(schema.organizations.id, receipt.orgId) }),
  ]);
  if (!invoice || !student || !org) notFound();
  const viewer = await mayPrint(student, true);
  const by = receipt.recordedById ? await db.query.users.findFirst({ where: eq(schema.users.id, receipt.recordedById), columns: { name: true } }) : null;
  return (
    <PaperShell>
      <PaperHead
        seller={invoice.sellerName ?? org.name}
        gstin={invoice.sellerGstin ?? org.gstin}
        state={invoice.sellerState ?? org.state}
        address={invoice.sellerAddress ?? org.addressLine}
        title="Fee receipt"
        number={receipt.number}
        date={fmtDate(receipt.receivedOn)}
      />
      <table className="w-full">
        <tbody>
          <Row k="Received from" v={fullName(student)} strong />
          {student.medcityId && <Row k="Medcity ID" v={student.medcityId} />}
          <Row k="Towards" v={`Invoice ${invoice.number}`} />
          <Row k="Paid by" v={`${FEE_METHOD_LABEL[receipt.method]}${receipt.reference && !viewer.student ? `, reference ${receipt.reference}` : ""}`} />
          <Row k="Amount" v={rupees(receipt.amount)} strong />
          <Row k="In words" v={rupeesInWords(receipt.amount)} />
        </tbody>
      </table>
      <footer className="mt-12 flex items-end justify-between text-[12px] text-[#6b6275]">
        <span>{viewer.student ? "" : `Recorded by ${by?.name ?? (receipt.method === "RAZORPAY" ? "Razorpay" : "Not recorded")}. `}This is a computer-generated receipt.</span>
        <span className="border-t border-[#c9c3cf] pt-1">Authorised signatory</span>
      </footer>
    </PaperShell>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <tr>
      <td className="w-44 py-1.5 text-[#6b6275]">{k}</td>
      <td className={strong ? "py-1.5 text-[15px] font-semibold" : "py-1.5"}>{v}</td>
    </tr>
  );
}
