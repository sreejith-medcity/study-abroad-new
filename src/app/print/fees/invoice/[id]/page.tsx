import { notFound } from "next/navigation";
import { fmtDate, fullName } from "@/lib/format";
import { FEE_INVOICE_STATE_LABEL, balanceDue, rupees, rupeesInWords } from "@/lib/student-fees";
import { loadInvoice } from "@/server/student-fees";
import { mayPrint } from "../../access";
import { PaperHead, PaperShell } from "../../shell";

export const metadata = { title: "Fee invoice" };
export const dynamic = "force-dynamic";

/**
 * The invoice as the student keeps it: a tax invoice with CGST and SGST, or
 * IGST, where the branch has a GSTIN, and otherwise a bill of supply that
 * says there is no GST on it. The total is in figures and in words.
 */
export default async function FeeInvoicePrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadInvoice(id);
  if (!data || !data.invoice.number) notFound();
  const { invoice: inv, lines, student, receipts } = data;
  await mayPrint(student, true);
  const tax = inv.kind === "TAX_INVOICE";
  const due = balanceDue(inv.total, inv.received);
  return (
    <PaperShell>
      <PaperHead
        seller={inv.sellerName ?? data.org.name}
        gstin={inv.sellerGstin}
        state={inv.sellerState}
        address={inv.sellerAddress}
        title={tax ? "Tax invoice" : "Bill of supply"}
        number={inv.number!}
        date={`Issued ${fmtDate(inv.issuedOn)}`}
      />
      <section className="mb-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[#6b6275]">Bill to</p>
          <p className="font-semibold">{fullName(student)}</p>
          {student.medcityId && <p className="font-mono">{student.medcityId}</p>}
          <p>{[student.city, student.state].filter(Boolean).join(", ") || "Address not recorded"}</p>
        </div>
        <div className="text-right">
          <p>Due by {inv.dueOn ? fmtDate(inv.dueOn) : "Not recorded"}</p>
          {tax && <p>Place of supply: {inv.placeOfSupply ?? inv.sellerState ?? "Not recorded"}</p>}
          <p>Status: {FEE_INVOICE_STATE_LABEL[inv.state]}</p>
        </div>
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[#e6e1eb] text-left text-[11.5px] uppercase text-[#6b6275]">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-b border-[#f0edf3]">
              <td className="py-2">{l.description}</td>
              <td className="py-2 text-right tabular-nums">{rupees(l.amount)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 text-[#6b6275]">{tax ? "Taxable value" : "Value"}</td>
            <td className="py-1.5 text-right tabular-nums">{rupees(inv.taxable)}</td>
          </tr>
          {tax && inv.igst != null && (
            <tr>
              <td className="py-1.5">IGST at {inv.gstPercent}%</td>
              <td className="py-1.5 text-right tabular-nums">{rupees(inv.igst)}</td>
            </tr>
          )}
          {tax && inv.cgst != null && (
            <>
              <tr>
                <td className="py-1.5">CGST at {(inv.gstPercent ?? 0) / 2}%</td>
                <td className="py-1.5 text-right tabular-nums">{rupees(inv.cgst)}</td>
              </tr>
              <tr>
                <td className="py-1.5">SGST at {(inv.gstPercent ?? 0) / 2}%</td>
                <td className="py-1.5 text-right tabular-nums">{rupees(inv.sgst)}</td>
              </tr>
            </>
          )}
          <tr className="border-t border-[#e6e1eb] text-[15px] font-semibold">
            <td className="py-2">Total</td>
            <td className="py-2 text-right tabular-nums">{rupees(inv.total)}</td>
          </tr>
          <tr>
            <td className="py-1 text-[#6b6275]">Received so far</td>
            <td className="py-1 text-right tabular-nums">{rupees(inv.received)}</td>
          </tr>
          {inv.refunded > 0 && (
            <tr>
              <td className="py-1 text-[#6b6275]">Refunded</td>
              <td className="py-1 text-right tabular-nums">{rupees(inv.refunded)}</td>
            </tr>
          )}
          <tr className="font-semibold">
            <td className="py-1">Balance due</td>
            <td className="py-1 text-right tabular-nums">{due == null ? "Not recorded" : rupees(due)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3" data-testid="in-words">
        Total in words: {inv.total == null ? "Not recorded" : rupeesInWords(inv.total)}
      </p>
      {!tax && <p className="mt-1 text-[#6b6275]">No GST is charged: the supplier has no GSTIN recorded.</p>}
      {receipts.length > 0 && (
        <p className="mt-3 text-[#6b6275]">Receipts: {receipts.map((r) => `${r.number} (${rupees(r.amount)}, ${fmtDate(r.receivedOn)})`).join("; ")}</p>
      )}
      <footer className="mt-12 flex items-end justify-between text-[12px] text-[#6b6275]">
        <span>This is a computer-generated document.</span>
        <span className="border-t border-[#c9c3cf] pt-1">Authorised signatory</span>
      </footer>
    </PaperShell>
  );
}
