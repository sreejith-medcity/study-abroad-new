"use client";

import { useState, type ReactNode } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Button, Checkbox, Input, Select, cn } from "@/components/ui";
import { DUE_CHOICES, FEE_METHOD_LABEL, COUNTER_METHODS, type FeePlanItem } from "@/lib/student-fees";
import { FEE_STEP_PATHWAYS, feeStepPathway } from "@/lib/fee-steps";
import {
  applyFeePlanAction,
  cancelFeeInvoiceAction,
  cancelScheduleAction,
  createFeeInvoiceAction,
  decideFeeRefundAction,
  issueFeeInvoiceAction,
  payFeeRefundAction,
  raiseInstalmentAction,
  recordFeeReceiptAction,
  requestFeeRefundAction,
  saveFeePlanAction,
  saveTaxDetailsAction,
  sendFeeLinkAction,
  setDraftGstAction,
  writeOffFeeInvoiceAction,
} from "@/server/student-fee-actions";

/** A control that opens into a small form, so a row of them stays one line until it is used. */
export function Fold({ label, children, tone = "secondary", className }: { label: string; children: ReactNode; tone?: "secondary" | "danger"; className?: string }) {
  return (
    <details className={cn("group w-full", className)}>
      <summary
        className={cn(
          "inline-flex cursor-pointer list-none items-center rounded-lg border px-2.5 py-1 text-xs font-medium",
          tone === "danger" ? "border-stop-500/40 text-stop-700 hover:bg-stop-50" : "border-line-strong text-ink-soft hover:bg-surface-2",
        )}
      >
        {label}
      </summary>
      <div className="mt-2 rounded-lg border border-line bg-surface-2/50 p-3">{children}</div>
    </details>
  );
}

// ---------- Plans ----------

/**
 * One instalment row in the editor. `due` is ON_APPLY, DAYS, DATE or a
 * pathway's key (src/lib/fee-steps.ts); `steps` keeps the step chosen on each
 * pathway, so switching back and forth does not lose it. `gst` is "plan" for
 * the plan's rate, "none" for a rate that is not recorded, or a GST slab.
 */
type Row = { label: string; kind: "amount" | "share"; value: string; due: string; days: string; date: string; steps: Record<string, string>; gst: string };

const GST_SLABS = ["0", "5", "12", "18", "28"];

/** The step each pathway's list starts on: the journey's offer stage, otherwise the first step. */
const firstSteps = (): Record<string, string> =>
  Object.fromEntries(FEE_STEP_PATHWAYS.map((p) => [p.key, p.steps.find((s) => s.key === "OFFER")?.key ?? p.steps[0]?.key ?? ""]));

const toRow = (i: FeePlanItem): Row => {
  const isStep = i.due === "STEP" && !!feeStepPathway(i.pathway);
  return {
    label: i.label,
    kind: i.share != null ? "share" : "amount",
    value: String(i.share ?? i.amount ?? ""),
    due: isStep ? i.pathway! : i.due === "STEP" ? "ON_APPLY" : i.due,
    days: i.days != null ? String(i.days) : "",
    date: i.date ?? "",
    steps: { ...firstSteps(), ...(isStep && i.stepKey ? { [i.pathway!]: i.stepKey } : {}) },
    gst: i.gstPercent === undefined ? "plan" : i.gstPercent === null ? "none" : String(i.gstPercent),
  };
};

const blank = (): Row => ({
  label: "",
  kind: "share",
  value: "",
  due: "ON_APPLY",
  days: "30",
  date: "",
  steps: firstSteps(),
  gst: "plan",
});

function toItem(r: Row): FeePlanItem {
  const n = Number(r.value);
  return {
    label: r.label.trim(),
    amount: r.kind === "amount" && r.value.trim() ? Math.round(n) : null,
    share: r.kind === "share" && r.value.trim() ? n : null,
    due: r.due === "ON_APPLY" || r.due === "DAYS" || r.due === "DATE" ? r.due : "STEP",
    days: r.due === "DAYS" ? Number(r.days || 0) : null,
    date: r.due === "DATE" ? r.date || null : null,
    ...(feeStepPathway(r.due) ? { pathway: r.due, stepKey: r.steps[r.due] ?? null } : {}),
    ...(r.gst === "plan" ? {} : { gstPercent: r.gst === "none" ? null : Number(r.gst) }),
  } as FeePlanItem;
}

/** The template editor: name, GST rate, and a row per instalment. */
export function PlanEditor({ plan }: { plan?: { id: string; name: string; note: string | null; gstPercent: number | null; items: FeePlanItem[] } }) {
  const [rows, setRows] = useState<Row[]>(plan ? plan.items.map(toRow) : [blank()]);
  const set = (k: number, patch: Partial<Row>) => setRows((all) => all.map((r, i) => (i === k ? { ...r, ...patch } : r)));
  const shares = rows.filter((r) => r.kind === "share").reduce((s, r) => s + (Number(r.value) || 0), 0);
  const prefix = plan?.id ?? "new";
  return (
    <ActionForm action={saveFeePlanAction} submitLabel={plan ? "Save plan" : "Add plan"} pendingLabel="Saving…">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <input type="hidden" name="items" value={JSON.stringify(rows.map(toItem))} />
      <div className="grid gap-3 md:grid-cols-3">
        <TextField id={`name-${prefix}`} label="Plan name" name="name" defaultValue={plan?.name} required placeholder="UK Masters, three instalments" />
        <TextField id={`gst-${prefix}`} label="GST rate, %" name="gstPercent" defaultValue={plan?.gstPercent ?? ""} inputMode="decimal" hint="Empty means not recorded. Applies only where the branch has a GSTIN." />
        <TextField id={`note-${prefix}`} label="Note" name="note" defaultValue={plan?.note ?? ""} />
      </div>
      <div className="space-y-2">
        {rows.map((r, k) => (
          <div key={k} className="grid gap-2 rounded-lg border border-line p-2 md:grid-cols-[1.4fr_0.8fr_0.8fr_1.2fr_1.2fr_0.8fr_auto]">
            <Input aria-label={`Instalment ${k + 1} name`} value={r.label} onChange={(e) => set(k, { label: e.target.value })} placeholder="On offer" />
            <Select aria-label={`Instalment ${k + 1} kind`} value={r.kind} onChange={(e) => set(k, { kind: e.target.value as Row["kind"] })}>
              <option value="share">Share, %</option>
              <option value="amount">Amount, ₹</option>
            </Select>
            <Input aria-label={`Instalment ${k + 1} value`} value={r.value} inputMode="decimal" onChange={(e) => set(k, { value: e.target.value })} />
            <Select aria-label={`Instalment ${k + 1} due`} value={r.due} onChange={(e) => set(k, { due: e.target.value })}>
              {DUE_CHOICES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
            <div>
              {r.due === "DAYS" && <Input aria-label={`Instalment ${k + 1} days`} value={r.days} inputMode="numeric" onChange={(e) => set(k, { days: e.target.value })} />}
              {r.due === "DATE" && <Input aria-label={`Instalment ${k + 1} date`} type="date" value={r.date} onChange={(e) => set(k, { date: e.target.value })} />}
              {FEE_STEP_PATHWAYS.filter((p) => p.key === r.due).map((p) => (
                <Select key={p.key} aria-label={`Instalment ${k + 1} ${p.stepNoun}`} value={r.steps[p.key] ?? ""} onChange={(e) => set(k, { steps: { ...r.steps, [p.key]: e.target.value } })}>
                  {p.steps.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              ))}
            </div>
            <Select aria-label={`Instalment ${k + 1} GST`} value={r.gst} onChange={(e) => set(k, { gst: e.target.value })}>
              <option value="plan">Plan&rsquo;s GST</option>
              <option value="none">GST not recorded</option>
              {GST_SLABS.map((g) => (
                <option key={g} value={g}>
                  GST {g}%
                </option>
              ))}
            </Select>
            <Button type="button" variant="quiet" size="sm" onClick={() => setRows((all) => all.filter((_, i) => i !== k))} disabled={rows.length === 1}>
              Remove
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={() => setRows((all) => [...all, blank()])}>
            Add instalment
          </Button>
          {rows.some((r) => r.kind === "share") && <span className={cn("text-xs", Math.abs(shares - 100) < 0.001 ? "text-good-700" : "text-stop-700")}>Shares add up to {Math.round(shares * 100) / 100}%</span>}
        </div>
      </div>
    </ActionForm>
  );
}

export function TaxDetailsForm({ org }: { org: { id: string; name: string; gstin: string | null; state: string | null } }) {
  return (
    <ActionForm action={saveTaxDetailsAction} submitLabel="Save tax details" className="grid items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
      <input type="hidden" name="orgId" value={org.id} />
      <TextField id={`gstin-${org.id}`} label="GSTIN" name="gstin" defaultValue={org.gstin ?? ""} placeholder="Not recorded" />
      <TextField id={`state-${org.id}`} label="State" name="state" defaultValue={org.state ?? ""} placeholder="Read from the GSTIN when there is one" />
    </ActionForm>
  );
}

// ---------- A student's schedule ----------

/**
 * Puts a plan on the student. `billedEarlier` names what an earlier plan has
 * already billed, which the new plan does not raise again; the plan can also
 * be started from a later instalment.
 */
export function ApplyPlan({
  studentId,
  plans,
  today,
  billedEarlier = [],
}: {
  studentId: string;
  plans: { id: string; name: string; shares: boolean; summary: string; labels: string[] }[];
  today: string;
  billedEarlier?: string[];
}) {
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const chosen = plans.find((p) => p.id === planId);
  return (
    <ActionForm action={applyFeePlanAction} submitLabel="Apply plan" pendingLabel="Applying…">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 md:grid-cols-4">
        <SelectField label="Fee plan" name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Package fee, ₹"
          name="fee"
          inputMode="numeric"
          hint={chosen?.shares ? "Required: this plan is in shares of the fee." : "Not needed: this plan is in fixed amounts."}
          disabled={!chosen?.shares}
        />
        <TextField label="Applied from" name="startOn" type="date" defaultValue={today} hint="Instalments due in days count from here." />
        <SelectField key={planId} label="Start from instalment" name="startFrom" defaultValue="1" hint="Instalments before it are not raised on this plan.">
          {(chosen?.labels ?? []).map((label, k) => (
            <option key={k} value={k + 1}>
              {k + 1}. {label}
            </option>
          ))}
        </SelectField>
      </div>
      {chosen && <p className="text-xs text-muted">{chosen.summary}</p>}
      {billedEarlier.length > 0 && (
        <p className="text-xs text-muted" data-testid="billed-earlier">
          Already billed under an earlier plan, so not raised again where the new plan has the same instalment or step: {billedEarlier.join("; ")}.
        </p>
      )}
    </ActionForm>
  );
}

export function CancelSchedule({ studentId }: { studentId: string }) {
  return (
    <Fold label="Cancel the rest of the schedule" tone="danger">
      <ActionForm action={cancelScheduleAction} submitLabel="Cancel what is not invoiced" submitVariant="secondary">
        <input type="hidden" name="studentId" value={studentId} />
        <TextField id={`schedule-reason-${studentId}`} label="Why" name="reason" />
      </ActionForm>
    </Fold>
  );
}

export function RaiseInstalment({ instalmentId, dueOn }: { instalmentId: string; dueOn: string }) {
  return (
    <ActionForm action={raiseInstalmentAction} submitLabel="Invoice now" submitVariant="secondary" className="flex items-end gap-2 space-y-0">
      <input type="hidden" name="instalmentId" value={instalmentId} />
      <label className="text-2xs text-muted">
        Due
        <Input type="date" name="dueOn" defaultValue={dueOn} className="py-1 text-xs" aria-label="Due on" />
      </label>
    </ActionForm>
  );
}

// ---------- Invoices ----------

export function InvoiceByHand({ studentId, defaultDue }: { studentId: string; defaultDue: string }) {
  return (
    <ActionForm action={createFeeInvoiceAction} submitLabel="Raise invoice" pendingLabel="Raising…" resetOnSuccess>
      <input type="hidden" name="studentId" value={studentId} />
      {[1, 2, 3].map((n) => (
        <div key={n} className="grid gap-2 md:grid-cols-[2fr_1fr]">
          <TextField label={n === 1 ? "What for" : `Line ${n}, what for`} name={`description${n}`} />
          <TextField label="Amount, ₹" name={`amount${n}`} inputMode="numeric" />
        </div>
      ))}
      <div className="grid gap-2 md:grid-cols-3">
        <TextField label="Due on" name="dueOn" type="date" defaultValue={defaultDue} />
        <TextField label="GST rate, %" name="gstPercent" inputMode="decimal" hint="Empty means not recorded." />
        <TextField label="Note" name="note" />
      </div>
      <Checkbox name="issueNow" defaultChecked label="Issue it now, with its number" />
    </ActionForm>
  );
}

export function IssueInvoice({ invoiceId }: { invoiceId: string }) {
  return (
    <ActionForm action={issueFeeInvoiceAction} submitLabel="Issue" submitVariant="secondary" className="space-y-0">
      <input type="hidden" name="invoiceId" value={invoiceId} />
    </ActionForm>
  );
}

export function DraftGst({ invoiceId, gstPercent }: { invoiceId: string; gstPercent: number | null }) {
  return (
    <Fold label="GST rate">
      <ActionForm action={setDraftGstAction} submitLabel="Set rate" submitVariant="secondary">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <TextField id={`gst-${invoiceId}`} label="GST rate, %" name="gstPercent" defaultValue={gstPercent ?? ""} inputMode="decimal" />
      </ActionForm>
    </Fold>
  );
}

export function RecordReceipt({ invoiceId, due, today }: { invoiceId: string; due: number; today: string }) {
  return (
    <Fold label="Record receipt">
      <ActionForm action={recordFeeReceiptAction} submitLabel="Record receipt" pendingLabel="Recording…">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <div className="grid gap-2 md:grid-cols-2">
          <TextField id={`amount-${invoiceId}`} label="Amount, ₹" name="amount" defaultValue={String(due)} inputMode="numeric" />
          <SelectField id={`method-${invoiceId}`} label="How" name="method" defaultValue="CASH">
            {COUNTER_METHODS.map((m) => (
              <option key={m} value={m}>
                {FEE_METHOD_LABEL[m]}
              </option>
            ))}
          </SelectField>
          <TextField id={`reference-${invoiceId}`} label="Reference" name="reference" hint="Not needed for cash." />
          <TextField id={`received-${invoiceId}`} label="Received on" name="receivedOn" type="date" defaultValue={today} max={today} />
        </div>
      </ActionForm>
    </Fold>
  );
}

export function SendLink({ invoiceId }: { invoiceId: string }) {
  return (
    <ActionForm action={sendFeeLinkAction} submitLabel="Payment link" submitVariant="secondary" className="space-y-0">
      <input type="hidden" name="invoiceId" value={invoiceId} />
    </ActionForm>
  );
}

/**
 * Cancels or discards an invoice. One raised from a schedule asks what
 * becomes of its instalment: raised again later, or waived for good (only
 * for those who collect fees).
 */
export function CancelInvoice({ invoiceId, draft, instalment, mayWaive }: { invoiceId: string; draft: boolean; instalment?: string | null; mayWaive?: boolean }) {
  return (
    <Fold label={draft ? "Discard draft" : "Cancel invoice"} tone="danger">
      <ActionForm action={cancelFeeInvoiceAction} submitLabel={draft ? "Discard" : "Cancel it"} submitVariant="secondary">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <TextField id={`cancel-${invoiceId}`} label="Why" name="reason" hint={instalment && mayWaive ? "Needed for a waiver too." : undefined} />
        {instalment && (
          <fieldset className="space-y-1 text-xs">
            <legend className="mb-1 text-muted">{instalment}, afterwards</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="afterwards" value="RAISE_AGAIN" defaultChecked /> Raise it again later
            </label>
            {mayWaive && (
              <label className="flex items-center gap-2">
                <input type="radio" name="afterwards" value="WAIVE" /> Waive this instalment: it is never raised again
              </label>
            )}
          </fieldset>
        )}
      </ActionForm>
    </Fold>
  );
}

export function WriteOff({ invoiceId }: { invoiceId: string }) {
  return (
    <Fold label="Write off" tone="danger">
      <ActionForm action={writeOffFeeInvoiceAction} submitLabel="Write off the balance" submitVariant="secondary">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <TextField id={`writeoff-${invoiceId}`} label="Why" name="reason" />
      </ActionForm>
    </Fold>
  );
}

// ---------- Refunds ----------

export function RequestRefund({ invoiceId, room }: { invoiceId: string; room: number }) {
  return (
    <Fold label="Request refund">
      <ActionForm action={requestFeeRefundAction} submitLabel="Request refund" submitVariant="secondary">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <TextField id={`refund-amount-${invoiceId}`} label="Amount, ₹" name="amount" inputMode="numeric" hint={`Up to ${room}.`} />
        <TextareaField id={`refund-reason-${invoiceId}`} label="Why" name="reason" rows={2} />
      </ActionForm>
    </Fold>
  );
}

export function DecideRefund({ refundId }: { refundId: string }) {
  return (
    <ActionForm action={decideFeeRefundAction} hideSubmit className="space-y-2">
      <input type="hidden" name="refundId" value={refundId} />
      <Input id={`decision-note-${refundId}`} name="note" placeholder="Note (needed to reject)" aria-label="Decision note" className="py-1 text-xs" />
      <FieldError name="note" />
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="APPROVED" size="sm">
          Approve
        </Button>
        <Button type="submit" name="decision" value="REJECTED" size="sm" variant="secondary">
          Reject
        </Button>
      </div>
    </ActionForm>
  );
}

export function PayRefund({ refundId }: { refundId: string }) {
  return (
    <Fold label="Record payout">
      <ActionForm action={payFeeRefundAction} submitLabel="Record payout">
        <input type="hidden" name="refundId" value={refundId} />
        <SelectField id={`payout-method-${refundId}`} label="How it went back" name="method" defaultValue="BANK_TRANSFER">
          {COUNTER_METHODS.map((m) => (
            <option key={m} value={m}>
              {FEE_METHOD_LABEL[m]}
            </option>
          ))}
        </SelectField>
        <TextField id={`payout-ref-${refundId}`} label="Payout reference" name="reference" />
      </ActionForm>
    </Fold>
  );
}
