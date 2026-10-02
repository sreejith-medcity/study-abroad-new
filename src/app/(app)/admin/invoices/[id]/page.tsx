import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtMoney, intakeLabel } from "@/lib/format";
import { isSuperAdmin, REPORTING_ROLES } from "@/lib/permissions";
import { describeLine, loadInvoice } from "@/server/invoicing";
import { AGE_LABEL, INVOICE_STATE_LABEL, INVOICE_STATE_MEANS } from "@/lib/invoicing";
import { Alert, Card, CardHeader, Chip, PageHeader, Table, Td, Th } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { DisputeInvoice, RecordPayment, SendInvoice, WriteOffInvoice } from "@/components/invoice-forms";
import { RemoveLine } from "./forms";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await loadInvoice(id);
  return { title: invoice ? invoice.number : "Invoice" };
}

/**
 * One invoice, and the document itself.
 *
 * What prints is the invoice: the company that raises it with its GSTIN, the
 * vendor it goes to, a line per student that the vendor can match against their
 * own file, the tax treatment in words, and the bank details. Everything the
 * desk does with it is on screen and kept off the print.
 */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ raised?: string }> }) {
  const { id } = await params;
  const { raised } = await searchParams;
  const user = await requireUser([...REPORTING_ROLES]);
  const invoice = await loadInvoice(id);
  if (!invoice) notFound();
  const canWork = user.role === "ADMIN" || user.role === "OPS_MANAGER" || user.role === "SUPER_ADMIN";
  const company = invoice.billingCompany;
  const settled = invoice.state === "PAID" || invoice.state === "WRITTEN_OFF";

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/admin/invoices" className="hover:underline">Invoices</Link>}
        title={invoice.number}
        subtitle={INVOICE_STATE_MEANS[invoice.state]}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <PrintButton />
            {canWork && !settled && invoice.state !== "DISPUTED" && invoice.state !== "SENT" && <SendInvoice invoiceId={invoice.id} suggested={invoice.vendor.contactEmail} />}
            {canWork && !settled && <RecordPayment invoiceId={invoice.id} currency={invoice.currency} outstanding={invoice.money.outstanding} />}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3" data-print="hide">
        <Chip tone={invoice.state === "PAID" ? "ok" : invoice.state === "DISPUTED" || invoice.state === "WRITTEN_OFF" ? "bad" : invoice.state === "PART_PAID" ? "warn" : "info"}>
          {INVOICE_STATE_LABEL[invoice.state]}
        </Chip>
        {invoice.dueOn && invoice.state !== "PAID" && invoice.state !== "WRITTEN_OFF" && (
          <Chip tone={invoice.age.bucket === "NOT_DUE" ? "neutral" : invoice.age.bucket === "DUE" ? "warn" : "bad"}>
            {AGE_LABEL[invoice.age.bucket]}
            {invoice.age.days != null && invoice.age.days > 0 ? `, ${invoice.age.days} days` : ""}
          </Chip>
        )}
        {canWork && !settled && <DisputeInvoice invoiceId={invoice.id} disputed={invoice.state === "DISPUTED"} />}
        {isSuperAdmin(user) && invoice.state !== "WRITTEN_OFF" && invoice.state !== "PAID" && <WriteOffInvoice invoiceId={invoice.id} />}
      </div>

      {raised === "1" && (
        <Alert tone="ok" title={`${invoice.number} raised`}>
          {fmtMoney(invoice.money.total, invoice.currency)} over {invoice.lines.length} student{invoice.lines.length === 1 ? "" : "s"}, due {invoice.dueOn ? fmtDate(invoice.dueOn) : "on terms not recorded"}.
          {" "}Send it to the vendor and record that below, so the ageing report starts counting.
        </Alert>
      )}
      {invoice.state === "DISPUTED" && invoice.disputeReason && (
        <Alert tone="bad" title="The vendor has questioned this">{invoice.disputeReason}</Alert>
      )}
      {invoice.state === "WRITTEN_OFF" && invoice.writtenOffReason && (
        <Alert tone="bad" title="Written off">{invoice.writtenOffReason}</Alert>
      )}
      {invoice.tax.percent > 0 && invoice.tax.treatment.includes("lapsed") && (
        <Alert tone="warn" title="The LUT has lapsed">{invoice.tax.note}</Alert>
      )}

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-display text-lg font-semibold">{company?.legalName ?? "No billing company chosen"}</p>
            {company && (
              <p className="mt-1 max-w-xs whitespace-pre-line text-[13px] leading-relaxed text-muted">
                {company.address}
                {"\n"}
                {company.state}
                {"\n"}PAN {company.pan}
                {company.gstin ? `\nGSTIN ${company.gstin}` : ""}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-muted">Invoice</p>
            <p className="font-display text-lg font-semibold tabular">{invoice.number}</p>
            <p className="text-[13px] text-muted">Raised {invoice.raisedOn ? fmtDate(invoice.raisedOn) : "not yet"}</p>
            <p className="text-[13px] text-muted">Due {invoice.dueOn ? fmtDate(invoice.dueOn) : "not recorded"}</p>
          </div>
        </div>

        <div className="mt-6 border-t border-line pt-4">
          <p className="text-xs uppercase tracking-wide text-muted">To</p>
          <p className="font-semibold">{invoice.vendor.billingName ?? invoice.vendor.name}</p>
          {invoice.vendor.billingAddress && <p className="max-w-sm whitespace-pre-line text-[13px] text-muted">{invoice.vendor.billingAddress}</p>}
          {invoice.vendor.gstin && <p className="text-[13px] text-muted">GSTIN {invoice.vendor.gstin}</p>}
          {!invoice.vendor.billingAddress && <p className="text-[13px] text-muted">No billing address on record for this vendor.</p>}
        </div>

        <div className="mt-6">
          <Table>
            <thead>
              <tr>
                <Th>Student and placement</Th>
                <Th>Intake</Th>
                <Th className="text-right">Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l) => (
                <tr key={l.id}>
                  <Td>{describeLine(l)}</Td>
                  <Td className="whitespace-nowrap text-xs">
                    {l.incomeLine.application ? intakeLabel(l.incomeLine.application.intakeMonth, l.incomeLine.application.intakeYear) : "—"}
                  </Td>
                  <Td className="whitespace-nowrap text-right tabular">{fmtMoney(l.amount, invoice.currency)}</Td>
                  <Td data-print="hide" className="text-right">
                    {canWork && (invoice.state === "RAISED" || invoice.state === "DRAFT") && <RemoveLine lineId={l.id} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>

        <div className="mt-4 flex flex-col items-end gap-1 border-t border-line pt-4 text-[13px]">
          <p>
            <span className="text-muted">Net </span>
            <span className="tabular font-medium">{fmtMoney(invoice.money.net, invoice.currency)}</span>
          </p>
          <p>
            <span className="text-muted">{invoice.taxTreatment ?? invoice.tax.treatment} </span>
            <span className="tabular font-medium">{fmtMoney(invoice.money.taxAmount, invoice.currency)}</span>
          </p>
          <p className="text-base">
            <span className="text-muted">Total </span>
            <span className="tabular font-semibold">{fmtMoney(invoice.money.total, invoice.currency)}</span>
          </p>
          {invoice.rupeeTotal != null && invoice.currency !== "INR" && (
            <p className="text-xs text-muted">
              About {fmtMoney(invoice.rupeeTotal, "INR")} at {invoice.rateUsed} to the {invoice.currency}, the indicative rate when it was raised. The bank&rsquo;s own figure is what counts.
            </p>
          )}
        </div>

        <div className="mt-6 border-t border-line pt-4 text-[13px] text-muted">
          <p>{invoice.taxTreatment ?? invoice.tax.treatment}. {invoice.tax.note}</p>
          {company && (
            <p className="mt-2">
              Pay to {company.bankAccountName}, account {company.bankAccountNumber}, IFSC {company.ifsc}.
            </p>
          )}
          {invoice.note && <p className="mt-2">{invoice.note}</p>}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2" data-print="hide">
        <Card>
          <CardHeader title={`Money in (${invoice.payments.length})`} subtitle="Each payment is its own row, so nothing is overwritten and a part payment is not mistaken for the whole." />
          {invoice.payments.length === 0 ? (
            <p className="p-4 text-muted">Nothing yet. {invoice.money.outstanding ? `${fmtMoney(invoice.money.outstanding, invoice.currency)} owed.` : ""}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>On</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Reference</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map((p) => (
                  <tr key={p.id}>
                    <Td className="whitespace-nowrap text-xs tabular">{fmtDate(p.receivedOn)}</Td>
                    <Td className="whitespace-nowrap text-right tabular">
                      {fmtMoney(p.amount, p.currency)}
                      {p.rupeeAmount != null && p.currency !== "INR" && <span className="block text-xs text-muted">{fmtMoney(p.rupeeAmount, "INR")} at {p.rateUsed}</span>}
                    </Td>
                    <Td className="text-xs">{p.reference ?? "—"}{p.note && <span className="block text-muted">{p.note}</span>}</Td>
                    <Td className="text-xs">{p.recordedBy ? (p.recordedBy.deskLabel ?? p.recordedBy.name) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-2 font-semibold">How it stands</h2>
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Total</dt>
              <dd className="tabular font-medium">{fmtMoney(invoice.money.total, invoice.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Received</dt>
              <dd className="tabular font-medium">{fmtMoney(invoice.money.received, invoice.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Still owed</dt>
              <dd className="tabular font-medium">{fmtMoney(invoice.money.outstanding, invoice.currency)}</dd>
            </div>
            {invoice.money.overpaid > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-stop-700">Paid over</dt>
                <dd className="tabular font-medium text-stop-700">{fmtMoney(invoice.money.overpaid, invoice.currency)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-line pt-1.5">
              <dt className="text-muted">Raised by</dt>
              <dd>{invoice.createdBy ? (invoice.createdBy.deskLabel ?? invoice.createdBy.name) : "—"}</dd>
            </div>
            {invoice.sentAt && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Sent</dt>
                <dd className="text-right">
                  {fmtDateTime(invoice.sentAt)}
                  {invoice.sentTo && <span className="block text-xs text-muted">{invoice.sentTo}</span>}
                </dd>
              </div>
            )}
            {invoice.paidAt && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Settled</dt>
                <dd>{fmtDateTime(invoice.paidAt)}</dd>
              </div>
            )}
          </dl>
        </Card>
      </div>
    </>
  );
}
