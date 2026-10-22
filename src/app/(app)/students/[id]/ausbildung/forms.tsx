"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { saveAusbildungAction, saveGermanModuleAction } from "@/server/ausbildung-actions";
import { markReceivedAction, saveIncomeLineAction } from "@/server/income-actions";
import { AUSBILDUNG_FIELDS, MODULE_STATE_LABEL, type ModuleState } from "@/lib/ausbildung";

type Profile = {
  preference1: string | null;
  preference2: string | null;
  preference3: string | null;
  applicationSubmittedOn: string | null;
  interview: string;
  interviewWith: string | null;
  contractReceivedOn: string | null;
  contractEmployer: string | null;
  note: string | null;
};

/** The three preferences and the three dates, on one form. */
export function AusbildungForm({ studentId, profile }: { studentId: string; profile: Profile }) {
  return (
    <ActionForm action={saveAusbildungAction} submitLabel="Save Ausbildung details">
      <input type="hidden" name="studentId" value={studentId} />
      <datalist id="ausbildung-fields">
        {AUSBILDUNG_FIELDS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink">Fields they would train in, first choice first</legend>
        {([1, 2, 3] as const).map((n) => (
          <Field key={n} label={`Preference ${n}`} htmlFor={`pref-${n}`}>
            <Input id={`pref-${n}`} name={`preference${n}`} list="ausbildung-fields" defaultValue={profile[`preference${n}`] ?? ""} placeholder={n === 1 ? "e.g. Nursing" : ""} />
          </Field>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Application submitted" htmlFor="au-applied">
          <Input id="au-applied" name="applicationSubmittedOn" type="date" defaultValue={profile.applicationSubmittedOn ?? ""} />
        </Field>
        <Field label="Interview (IST)" htmlFor="au-interview">
          <Input id="au-interview" name="interviewOn" type="datetime-local" defaultValue={profile.interview} />
          <FieldError name="interviewOn" />
        </Field>
        <Field label="Interview with" htmlFor="au-with">
          <Input id="au-with" name="interviewWith" defaultValue={profile.interviewWith ?? ""} placeholder="Employer" />
        </Field>
        <Field label="Contract received" htmlFor="au-contract">
          <Input id="au-contract" name="contractReceivedOn" type="date" defaultValue={profile.contractReceivedOn ?? ""} />
        </Field>
        <Field label="Contract with" htmlFor="au-employer">
          <Input id="au-employer" name="contractEmployer" defaultValue={profile.contractEmployer ?? ""} placeholder="Employer" />
          <FieldError name="contractEmployer" />
        </Field>
      </div>
      <Field label="Note" htmlFor="au-note">
        <Textarea id="au-note" name="note" rows={2} defaultValue={profile.note ?? ""} />
      </Field>
    </ActionForm>
  );
}

/** One German level on one line: the level, where it stands, the day it was finished, Save. */
export function ModuleForm({ studentId, level, state, completedOn }: { studentId: string; level: string; state: ModuleState; completedOn: string | null }) {
  return (
    <ActionForm action={saveGermanModuleAction} submitLabel="Save" submitVariant="secondary" className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="level" value={level} />
      <span className="w-10 font-display text-lg font-semibold text-ink">{level}</span>
      <Select name="state" defaultValue={state} className="w-40" aria-label={`German ${level}`}>
        {(Object.keys(MODULE_STATE_LABEL) as ModuleState[]).map((k) => (
          <option key={k} value={k}>
            {MODULE_STATE_LABEL[k]}
          </option>
        ))}
      </Select>
      <Input name="completedOn" type="date" defaultValue={completedOn ?? ""} className="w-40" aria-label={`German ${level} completed on`} title="The day it was finished" />
    </ActionForm>
  );
}

/** Raising the service charge on this student, starting from the destination's usual figure. */
export function RaiseServiceCharge({ studentId, usual }: { studentId: string; usual: number | null }) {
  return (
    <ActionForm action={saveIncomeLineAction} submitLabel="Raise the service charge" submitVariant="secondary" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="kind" value="SERVICE_FEE" />
      <input type="hidden" name="payer" value="STUDENT" />
      <input type="hidden" name="currency" value="INR" />
      <Field label="Service charge (₹)" htmlFor="sc-amount" hint={usual == null ? "No usual figure is set for this destination." : "The destination's usual figure. Change it if this student's is different."}>
        <Input id="sc-amount" name="expectedAmount" inputMode="numeric" defaultValue={usual ?? ""} className="w-40" />
        <FieldError name="expectedAmount" />
      </Field>
      <Field label="Due by" htmlFor="sc-due">
        <Input id="sc-due" name="dueOn" type="date" className="w-40" />
      </Field>
    </ActionForm>
  );
}

/** A payment in. The figure is the total received so far, not this one payment. */
export function RecordPayment({ lineId, received }: { lineId: string; received: number | null }) {
  return (
    <ActionForm action={markReceivedAction} submitLabel="Record" submitVariant="secondary" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="lineId" value={lineId} />
      <Field label="Received in total (₹)" htmlFor={`rp-${lineId}`}>
        <Input id={`rp-${lineId}`} name="receivedAmount" inputMode="numeric" defaultValue={received ?? ""} className="w-36" />
        <FieldError name="receivedAmount" />
      </Field>
      <Field label="On" htmlFor={`rp-d-${lineId}`}>
        <Input id={`rp-d-${lineId}`} name="receivedOn" type="date" className="w-40" />
      </Field>
    </ActionForm>
  );
}
