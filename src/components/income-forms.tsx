"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Checkbox, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { DEPARTURE_KINDS, INCOME_LABEL, INCOME_MEANS, PAYER_LABEL } from "@/lib/income";
import {
  deleteIncomeLineAction,
  layOutLinesAction,
  markReceivedAction,
  saveIncomeLineAction,
  saveRateCardAction,
  writeOffIncomeAction,
} from "@/server/income-actions";
import type { IncomeKind, IncomePayer } from "@/db/schema";

const KINDS = Object.keys(INCOME_LABEL) as IncomeKind[];
const PAYERS = Object.keys(PAYER_LABEL) as IncomePayer[];

export type LineForForm = {
  id: string;
  kind: IncomeKind;
  payer: IncomePayer;
  currency: string;
  expectedAmount: number | null;
  invoicedAmount: number | null;
  receivedAmount: number | null;
  state: string;
  branchSharePercent: number | null;
  dueOn: string | null;
  note: string | null;
};

/** One line, added or corrected. An amount left empty stays empty. */
export function LineForm({
  studentId,
  applications,
  vendors,
  line,
  onDone,
}: {
  studentId: string;
  applications: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
  line?: LineForForm;
  onDone?: () => void;
}) {
  const key = line?.id ?? "new";
  return (
    <ActionForm action={saveIncomeLineAction} submitLabel={line ? "Save the line" : "Add the line"} resetOnSuccess={!line}>
      {line && <input type="hidden" name="lineId" value={line.id} />}
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What for" htmlFor={`i-kind-${key}`} required hint={line ? undefined : "Every kind of money a student brings in."}>
          <Select id={`i-kind-${key}`} name="kind" defaultValue={line?.kind ?? "SERVICE_FEE"}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{INCOME_LABEL[k]}</option>
            ))}
          </Select>
          <FieldError name="kind" />
        </Field>
        <Field label="Who pays" htmlFor={`i-payer-${key}`}>
          <Select id={`i-payer-${key}`} name="payer" defaultValue={line?.payer ?? "STUDENT"}>
            {PAYERS.map((p) => (
              <option key={p} value={p}>{PAYER_LABEL[p]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Currency" htmlFor={`i-cur-${key}`}>
          <Input id={`i-cur-${key}`} name="currency" defaultValue={line?.currency ?? "INR"} className="uppercase" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Expected" htmlFor={`i-exp-${key}`} hint="Leave it empty if nobody knows yet. It will read Not recorded.">
          <Input id={`i-exp-${key}`} name="expectedAmount" inputMode="numeric" defaultValue={line?.expectedAmount ?? ""} />
          <FieldError name="expectedAmount" />
        </Field>
        <Field label="Invoiced" htmlFor={`i-inv-${key}`}>
          <Input id={`i-inv-${key}`} name="invoicedAmount" inputMode="numeric" defaultValue={line?.invoicedAmount ?? ""} />
          <FieldError name="invoicedAmount" />
        </Field>
        <Field label="Received" htmlFor={`i-rec-${key}`}>
          <Input id={`i-rec-${key}`} name="receivedAmount" inputMode="numeric" defaultValue={line?.receivedAmount ?? ""} />
          <FieldError name="receivedAmount" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="The branch's share" htmlFor={`i-share-${key}`} hint="A percentage of this line, where the branch keeps part of it.">
          <Input id={`i-share-${key}`} name="branchSharePercent" inputMode="decimal" defaultValue={line?.branchSharePercent ?? ""} />
          <FieldError name="branchSharePercent" />
        </Field>
        <Field label="Due" htmlFor={`i-due-${key}`}>
          <Input id={`i-due-${key}`} type="date" name="dueOn" defaultValue={line?.dueOn ?? ""} />
        </Field>
        {vendors.length > 0 && (
          <Field label="Owed by which vendor" htmlFor={`i-vendor-${key}`} hint="Only where a vendor owes it.">
            <Select id={`i-vendor-${key}`} name="vendorId" defaultValue="">
              <option value="">Nobody in particular</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {applications.length > 0 && (
        <Field label="Against which application" htmlFor={`i-app-${key}`} hint="Where this line belongs to one application rather than the student as a whole.">
          <Select id={`i-app-${key}`} name="applicationId" defaultValue="">
            <option value="">The student as a whole</option>
            {applications.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Note" htmlFor={`i-note-${key}`} hint="Who the provider was, what was agreed, anything a figure cannot say.">
        <Textarea id={`i-note-${key}`} name="note" rows={2} defaultValue={line?.note ?? ""} />
      </Field>
      {onDone && (
        <button type="button" onClick={onDone} className="text-[13px] text-muted hover:text-ink">Close</button>
      )}
    </ActionForm>
  );
}

/** The form, folded away until it is wanted. */
export function AddLine({ studentId, applications, vendors }: { studentId: string; applications: { id: string; label: string }[]; vendors: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">
        Add a line
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a line of income" description="What Medcity earns on this student, and who pays it." className="max-w-2xl">
        <LineForm studentId={studentId} applications={applications} vendors={vendors} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

/** Money in, part payments and all. */
export function LineActions({
  line,
  studentId,
  applications,
  vendors,
  canWriteOff,
}: {
  line: LineForForm;
  studentId: string;
  applications: { id: string; label: string }[];
  vendors: { id: string; name: string }[];
  canWriteOff: boolean;
}) {
  const [open, setOpen] = useState<null | "received" | "edit" | "off">(null);
  const today = new Date().toISOString().slice(0, 10);
  const settled = line.state === "RECEIVED" || line.state === "WRITTEN_OFF";
  return (
    <span className="flex flex-wrap items-center justify-end gap-3 whitespace-nowrap">
      {!settled && (
        <button type="button" onClick={() => setOpen("received")} className="text-[13px] font-medium text-brand-600 hover:underline">Money in</button>
      )}
      {line.state !== "WRITTEN_OFF" && (
        <button type="button" onClick={() => setOpen("edit")} className="text-[13px] text-muted hover:text-ink">Edit</button>
      )}
      {canWriteOff && !settled && (
        <button type="button" onClick={() => setOpen("off")} className="text-[13px] text-muted hover:text-ink">Write off</button>
      )}
      {line.expectedAmount == null && line.invoicedAmount == null && line.receivedAmount == null && (
        <form action={deleteIncomeLineAction} className="inline">
          <input type="hidden" name="lineId" value={line.id} />
          <button type="submit" className="text-[13px] text-muted hover:text-ink">Remove</button>
        </form>
      )}

      <Modal open={open === "received"} onClose={() => setOpen(null)} title={`${INCOME_LABEL[line.kind]}: money in`} description="Part payment is normal. The line stays open until the whole of it is in.">
        <ActionForm action={markReceivedAction} submitLabel="Record it">
          <input type="hidden" name="lineId" value={line.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How much came in" htmlFor={`r-amt-${line.id}`} hint={line.invoicedAmount ?? line.expectedAmount ? `Leave it empty for the whole ${line.invoicedAmount ?? line.expectedAmount}.` : "Nothing is on record, so give the amount."}>
              <Input id={`r-amt-${line.id}`} name="receivedAmount" inputMode="numeric" defaultValue={line.receivedAmount ?? ""} />
              <FieldError name="receivedAmount" />
            </Field>
            <Field label="On" htmlFor={`r-on-${line.id}`} hint="The day it arrived, not today.">
              <Input id={`r-on-${line.id}`} type="date" name="receivedOn" defaultValue={today} max={today} />
            </Field>
          </div>
        </ActionForm>
      </Modal>

      <Modal open={open === "off"} onClose={() => setOpen(null)} title="Write it off" description="Money that stops being owed should never be quiet. The reason stays on the sheet and in the audit log.">
        <ActionForm action={writeOffIncomeAction} submitLabel="Write it off" submitVariant="secondary">
          <input type="hidden" name="lineId" value={line.id} />
          <Field label="Why it will never come in" htmlFor={`o-${line.id}`} required>
            <Textarea id={`o-${line.id}`} name="reason" rows={3} />
            <FieldError name="reason" />
          </Field>
        </ActionForm>
      </Modal>

      <Modal open={open === "edit"} onClose={() => setOpen(null)} title={`Edit the ${INCOME_LABEL[line.kind].toLowerCase()} line`} className="max-w-2xl">
        <LineForm studentId={studentId} applications={applications} vendors={vendors} line={line} onDone={() => setOpen(null)} />
      </Modal>
    </span>
  );
}

/** Lays out the lines a student should have, from the branch's rate cards. */
export function LayOutLines({ studentId, missing }: { studentId: string; missing: IncomeKind[] }) {
  const [open, setOpen] = useState(false);
  if (missing.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink">
        Lay out the usual lines
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Lay out the usual lines"
        description="Adds a line for each one ticked, priced from your branch's rate card. Anything with no rate recorded is still added, reading Not recorded, so you can see what has not been priced."
        className="max-w-xl"
      >
        <ActionForm action={layOutLinesAction} submitLabel="Add them">
          <input type="hidden" name="studentId" value={studentId} />
          <div className="space-y-1.5">
            {missing.map((k) => (
              <Checkbox
                key={k}
                name="kinds"
                value={k}
                defaultChecked={DEPARTURE_KINDS.includes(k) || k === "SERVICE_FEE"}
                label={
                  <span>
                    <span className="font-medium">{INCOME_LABEL[k]}</span>
                    <span className="ml-2 text-xs text-muted">{INCOME_MEANS[k]}</span>
                  </span>
                }
              />
            ))}
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}

/** What a branch charges or keeps for one kind, from a day. */
export function RateCardForm({ branches }: { branches: { id: string; name: string }[] }) {
  const [kind, setKind] = useState<IncomeKind>("SERVICE_FEE");
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={saveRateCardAction} submitLabel="Record the rate" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What for" htmlFor="rc-kind" required hint={INCOME_MEANS[kind]}>
          <Select id="rc-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value as IncomeKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{INCOME_LABEL[k]}</option>
            ))}
          </Select>
          <FieldError name="kind" />
        </Field>
        <Field label="Which branch" htmlFor="rc-org" hint="Leave it on every branch for the platform's own rate.">
          <Select id="rc-org" name="orgId" defaultValue="">
            <option value="">Every branch</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Flat amount" htmlFor="rc-amount" hint="What Medcity keeps.">
          <Input id="rc-amount" name="amount" inputMode="numeric" />
          <FieldError name="amount" />
        </Field>
        <Field label="Or a percentage of the sale" htmlFor="rc-percent">
          <Input id="rc-percent" name="percentOfSale" inputMode="decimal" />
          <FieldError name="percentOfSale" />
        </Field>
        <Field label="Currency" htmlFor="rc-cur">
          <Input id="rc-cur" name="currency" defaultValue="INR" className="uppercase" />
        </Field>
        <Field label="From" htmlFor="rc-from" required hint="A rate is added, never edited.">
          <Input id="rc-from" type="date" name="activeFrom" defaultValue={today} />
          <FieldError name="activeFrom" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who pays" htmlFor="rc-payer">
          <Select id="rc-payer" name="payer" defaultValue="STUDENT">
            {PAYERS.map((p) => (
              <option key={p} value={p}>{PAYER_LABEL[p]}</option>
            ))}
          </Select>
        </Field>
        <Field label="The branch's share" htmlFor="rc-share" hint="A percentage of the line the branch keeps.">
          <Input id="rc-share" name="branchSharePercent" inputMode="decimal" />
          <FieldError name="branchSharePercent" />
        </Field>
      </div>
      <Field label="Note" htmlFor="rc-note" hint="What was agreed, and with whom.">
        <Input id="rc-note" name="note" />
      </Field>
      <Chip tone="info">Lines already laid out keep the rate they were priced at</Chip>
    </ActionForm>
  );
}
