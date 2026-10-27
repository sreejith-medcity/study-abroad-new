import { notFound } from "next/navigation";
import { fmtDate, fullName } from "@/lib/format";
import { FEE_METHOD_LABEL, rupees, rupeesInWords } from "@/lib/student-fees";
import { loadCreditNote } from "@/server/student-fees";
import { mayPrint } from "../../access";
import { PaperHead, PaperShell } from "../../shell";

export const metadata = { title: "Credit note" };
export const dynamic = "force-dynamic";

/**
 * The credit note made when a refund on a tax invoice was paid out: the fee
 * and the GST it takes back, in the same proportion as the invoice, against
 * the invoice it corrects. The seller's details are the invoice's own.
 */
export default async function CreditNotePrint({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadCreditNote(id);
  if (!data) notFound();
  const { refund: r, invoice: inv, student } = data;
  await mayPrint(student, true);
  const half = (inv.gstPercent ?? 0) / 2;
  return (
    <PaperShell>
      <PaperHead
        seller={inv.sellerName ?? data.org.name}
        gstin={inv.sellerGstin}
        state={inv.sellerState}
        address={inv.sellerAddress}
        title="Credit note"
        number={r.creditNoteNumber!}
        date={`Issued ${fmtDate(r.creditNoteOn)}`}
      />
      <section className="mb-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[#6b6275]">Issued to</p>
          <p className="font-semibold">{fullName(student)}</p>
          {student.medcityId && <p className="font-mono">{student.medcityId}</p>}
          <p>{[student.city, student.state].filter(Boolean).join(", ") || "Address not recorded"}</p>
        </div>
        <div className="text-right">
          <p>
            Against tax invoice <span className="font-mono">{inv.number}</span>
          </p>
          <p>Invoice issued {fmtDate(inv.issuedOn)}</p>
          <p>Place of supply: {inv.placeOfSupply ?? inv.sellerState ?? "Not recorded"}</p>
          <p>
            Refund <span className="font-mono">{r.number}</span>
          </p>
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
          <tr className="border-b border-[#f0edf3]">
            <td className="py-2">Refund of fees: {r.reason}</td>
            <td className="py-2 text-right tabular-nums">{rupees(r.creditTaxable)}</td>
          </tr>
          <tr>
            <td className="py-1.5 text-[#6b6275]">Taxable value taken back</td>
            <td className="py-1.5 text-right tabular-nums">{rupees(r.creditTaxable)}</td>
          </tr>
          {r.creditIgst != null && (
            <tr>
              <td className="py-1.5">IGST at {inv.gstPercent}%</td>
              <td className="py-1.5 text-right tabular-nums">{rupees(r.creditIgst)}</td>
            </tr>
          )}
          {r.creditCgst != null && (
            <tr>
              <td className="py-1.5">CGST at {half}%</td>
              <td className="py-1.5 text-right tabular-nums">{rupees(r.creditCgst)}</td>
            </tr>
          )}
          {r.creditSgst != null && (
            <tr>
              <td className="py-1.5">SGST at {half}%</td>
              <td className="py-1.5 text-right tabular-nums">{rupees(r.creditSgst)}</td>
            </tr>
          )}
          <tr className="border-t border-[#e6e1eb] text-[15px] font-semibold">
            <td className="py-2">Total credit</td>
            <td className="py-2 text-right tabular-nums">{rupees(r.amount)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3" data-testid="in-words">
        Total in words: {rupeesInWords(r.amount)}
      </p>
      <p className="mt-1 text-[#6b6275]">
        Paid back {r.paidAt ? fmtDate(r.paidAt) : "on a day not recorded"}
        {r.payoutMethod ? `, ${FEE_METHOD_LABEL[r.payoutMethod]}` : ""}
        {r.payoutReference ? `, reference ${r.payoutReference}` : ""}.
      </p>
      <footer className="mt-12 flex items-end justify-between text-[12px] text-[#6b6275]">
        <span>This is a computer-generated document.</span>
        <span className="border-t border-[#c9c3cf] pt-1">Authorised signatory</span>
      </footer>
    </PaperShell>
  );
}
