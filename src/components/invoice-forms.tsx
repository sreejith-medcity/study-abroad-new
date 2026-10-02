"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Alert, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import {
  disputeInvoiceAction,
  raiseInvoiceAction,
  recordInvoicePaymentAction,
  resolveDisputeAction,
  sendInvoiceAction,
  writeOffInvoiceAction,
} from "@/server/invoice-actions";

export type QueueItem = { incomeLineId: string; studentName: string; branch: string; course: string | null; ackNo: string | null; amount: number | null; currency: string; readyOn: string | null; payableWhen: string };
export type Company = { id: string; legalName: string; gstin: string | null; lutNumber: string | null; lutValidUntil: string | null; isDefault: boolean };

/**
 * One invoice over as many students as the desk ticks. The total is the sum of
 * the lines, so there is no figure to type and none to get wrong.
 */
export function RaiseInvoice({
  vendorId,
  vendorName,
  ready,
  companies,
  taxNote,
}: {
  vendorId: string;
  vendorName: string;
  ready: QueueItem[];
  companies: Company[];
  taxNote: string;
}) {
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>(ready.map((r) => r.incomeLineId));
  const today = new Date().toISOString().slice(0, 10);
  const chosen = ready.filter((r) => ticked.includes(r.incomeLineId));
  const currency = chosen[0]?.currency ?? ready[0]?.currency ?? "INR";
  const sameCurrency = new Set(chosen.map((c) => c.currency)).size <= 1;
  const net = chosen.reduce((sum, c) => sum + (c.amount ?? 0), 0);

  if (ready.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">
        Raise an invoice ({ready.length})
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Invoice ${vendorName}`} description="One invoice, as many students as you tick. Vendors settle in batches, so an invoice per placement is an invoice nobody pays." className="max-w-3xl">
        <ActionForm action={raiseInvoiceAction} submitLabel={`Raise it for ${net.toLocaleString("en-IN")} ${currency}`} pendingLabel="Raising…">
          <input type="hidden" name="vendorId" value={vendorId} />
          {ticked.map((id) => (
            <input key={id} type="hidden" name="incomeLineIds" value={id} />
          ))}
          <Alert tone="info" title="Tax on this invoice">{taxNote}</Alert>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
            {ready.map((r) => (
              <label key={r.incomeLineId} className="flex cursor-pointer items-start gap-3 border-b border-line p-2.5 last:border-b-0 hover:bg-ground/60">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={ticked.includes(r.incomeLineId)}
                  onChange={(e) => setTicked((was) => (e.target.checked ? [...was, r.incomeLineId] : was.filter((x) => x !== r.incomeLineId)))}
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.studentName}</span>
                  <span className="ml-2 text-xs text-muted">{r.branch}</span>
                  <span className="block text-xs text-muted">
                    {[r.course, r.ackNo].filter(Boolean).join(" · ")} · {r.payableWhen} on {r.readyOn}
                  </span>
                </span>
                <span className="shrink-0 tabular">{r.amount?.toLocaleString("en-IN")} {r.currency}</span>
              </label>
            ))}
          </div>
          {!sameCurrency && <Alert tone="bad">One invoice, one currency. Untick until only one currency is left.</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Raised by which company" htmlFor={`inv-co-${vendorId}`} required hint="Its GSTIN and LUT decide the tax.">
              <Select id={`inv-co-${vendorId}`} name="billingCompanyId" defaultValue={companies.find((c) => c.isDefault)?.id ?? companies[0]?.id ?? ""}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.legalName}{c.isDefault ? " (default)" : ""}</option>
                ))}
              </Select>
              <FieldError name="billingCompanyId" />
            </Field>
            <Field label="Raised on" htmlFor={`inv-on-${vendorId}`} hint="The due date comes from the vendor's own terms.">
              <Input id={`inv-on-${vendorId}`} type="date" name="raisedOn" defaultValue={today} max={today} />
            </Field>
          </div>
          <Field label="Note on the invoice" htmlFor={`inv-note-${vendorId}`}>
            <Input id={`inv-note-${vendorId}`} name="note" placeholder="Against your statement of 30 September" />
          </Field>
          <p className="text-xs text-muted">{chosen.length} student{chosen.length === 1 ? "" : "s"}, {net.toLocaleString("en-IN")} {currency} before tax.</p>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Marks it as gone, and to whom. The portal does not email it. */
export function SendInvoice({ invoiceId, suggested }: { invoiceId: string; suggested: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">
        It has been sent
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record that it has gone" description="The portal does not email invoices: attach the document to your own mail, then record it here so the ageing report starts counting.">
        <ActionForm action={sendInvoiceAction} submitLabel="Record it">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <Field label="Sent to" htmlFor={`sent-${invoiceId}`} hint="Who at the vendor it went to.">
            <Input id={`sent-${invoiceId}`} name="sentTo" defaultValue={suggested ?? ""} />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Money against an invoice, in the instalments vendors actually pay in. */
export function RecordPayment({ invoiceId, currency, outstanding }: { invoiceId: string; currency: string; outstanding: number }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">
        Money in
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a payment" description="Part payment is normal. Each one is kept as its own row, so nothing is overwritten.">
        <ActionForm action={recordInvoicePaymentAction} submitLabel="Record it">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`How much came in (${currency})`} htmlFor={`p-amt-${invoiceId}`} required hint={`${outstanding.toLocaleString("en-IN")} is still owed.`}>
              <Input id={`p-amt-${invoiceId}`} name="amount" inputMode="numeric" defaultValue={outstanding || ""} />
              <FieldError name="amount" />
            </Field>
            <Field label="On" htmlFor={`p-on-${invoiceId}`} required hint="The day it hit the bank.">
              <Input id={`p-on-${invoiceId}`} type="date" name="receivedOn" defaultValue={today} max={today} />
              <FieldError name="receivedOn" />
            </Field>
          </div>
          {currency !== "INR" && (
            <Field label="What hit the bank in rupees" htmlFor={`p-inr-${invoiceId}`} hint="The real figure from the statement. The rate is worked out from it and kept, so the books can be read back.">
              <Input id={`p-inr-${invoiceId}`} name="rupeeAmount" inputMode="numeric" />
              <FieldError name="rupeeAmount" />
            </Field>
          )}
          <Field label="Their reference" htmlFor={`p-ref-${invoiceId}`}>
            <Input id={`p-ref-${invoiceId}`} name="reference" placeholder="UTR or their payment advice number" />
          </Field>
          <Field label="Note" htmlFor={`p-note-${invoiceId}`}>
            <Input id={`p-note-${invoiceId}`} name="note" />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** The vendor has questioned it, or it has been worked out. */
export function DisputeInvoice({ invoiceId, disputed }: { invoiceId: string; disputed: boolean }) {
  const [open, setOpen] = useState(false);
  if (disputed) {
    return (
      <form action={resolveDisputeAction} className="inline">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <button type="submit" className="text-[13px] font-medium text-brand-600 hover:underline">It has been worked out</button>
      </form>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-muted hover:text-ink">They have questioned it</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Mark it disputed" description="A state, not a failure. It stays on the ageing report until it is settled.">
        <ActionForm action={disputeInvoiceAction} submitLabel="Mark it disputed" submitVariant="secondary">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <Field label="What they are questioning" htmlFor={`d-${invoiceId}`} required>
            <Textarea id={`d-${invoiceId}`} name="reason" rows={3} />
            <FieldError name="reason" />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Writing an invoice off: a super admin, with a reason, and it stays on the record. */
export function WriteOffInvoice({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-muted hover:text-ink">Write it off</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Write it off" description="Every student's line on this invoice will say so too, and it is in the audit log. Money that stops being owed should never be quiet.">
        <ActionForm action={writeOffInvoiceAction} submitLabel="Write it off" submitVariant="secondary">
          <input type="hidden" name="invoiceId" value={invoiceId} />
          <Field label="Why it will never be paid" htmlFor={`wo-${invoiceId}`} required>
            <Textarea id={`wo-${invoiceId}`} name="reason" rows={3} />
            <FieldError name="reason" />
          </Field>
          <Chip tone="warn">Only a super admin can do this</Chip>
        </ActionForm>
      </Modal>
    </>
  );
}

/** Unused ticks are the common slip, so the raise form says what it will cover. */
export function QueueNote({ unpriced, waiting }: { unpriced: number; waiting: number }) {
  if (unpriced === 0 && waiting === 0) return null;
  return (
    <p className="mt-2 text-xs text-muted">
      {waiting > 0 && `${waiting} not ready yet: the milestone the vendor pays on has not happened, or nobody recorded the date. `}
      {unpriced > 0 && `${unpriced} with no amount on them, which cannot go on an invoice until somebody prices them.`}
    </p>
  );
}
