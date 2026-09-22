"use client";

import { useMemo, useState } from "react";
import { FormatBar } from "@/components/format-bar";
import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { dayText, daysUntil } from "@/lib/catalogue";
import { addCommentAction, addDeadlineAction, changeStatusAction, createApplicationAction, saveOfferVisaAction } from "./actions";
import { DEADLINE_LABEL, DEADLINE_TYPES } from "@/lib/deadline-types";

type ProgramOption = {
  id: string;
  name: string;
  university: string;
  country: string;
  pathway: "DEGREE" | "AUSBILDUNG" | "NURSING";
  intakeMonths: number[];
  shortlisted: boolean;
  tuition: string;
  requirements: string;
  /** Last day to apply, keyed "yyyy-m" by intake. */
  deadlines: Record<string, string>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ApplyForm({
  studentId,
  programs,
  preselectProgramId,
  limited,
}: {
  studentId: string;
  programs: ProgramOption[];
  preselectProgramId?: string;
  /** True when more programs matched than were sent; the counsellor should narrow the search. */
  limited: boolean;
}) {
  const [intake, setIntake] = useState("");
  const [programId, setProgramId] = useState(programs.some((p) => p.id === preselectProgramId) ? preselectProgramId! : "");
  const program = programs.find((p) => p.id === programId);
  const picked = programs.filter((p) => p.shortlisted);
  const others = programs.filter((p) => !p.shortlisted);

  const intakes = useMemo(() => {
    if (!program) return [];
    const now = new Date();
    const out: { value: string; label: string; order: number }[] = [];
    // No intakes on record (the CRICOS register has none) is not the same as no
    // intakes: every month is offered and the team confirms it with the institution.
    const months = program.intakeMonths.length ? program.intakeMonths : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    for (let y = now.getFullYear(); y <= now.getFullYear() + 2; y++) {
      for (const m of months) {
        if (new Date(y, m - 1, 1) > now) out.push({ value: `${y}-${m}`, label: `${MONTHS[m - 1]} ${y}`, order: y * 100 + m });
      }
    }
    // By date, not by the value string: "2027-10" sorts before "2027-2" as text.
    return out.sort((a, b) => a.order - b.order);
  }, [program]);

  const label = (p: ProgramOption) => `${p.name} · ${p.university}, ${p.country}`;
  return (
    <ActionForm action={createApplicationAction} submitLabel="Create application" pendingLabel="Creating…">
      <input type="hidden" name="studentId" value={studentId} />
      <Field label="Program" htmlFor="programId" required hint={limited ? "Showing the first 50 matches. Search above to narrow the list." : programs.length ? undefined : "Nothing open for applications matches. Change the search above."}>
        <Select id="programId" name="programId" value={programId} onChange={(e) => { setProgramId(e.target.value); setIntake(""); }}>
          <option value="">Choose a program</option>
          {picked.length > 0 && (
            <optgroup label="Shortlisted">
              {picked.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label={picked.length ? "Search results" : "Programs"}>
              {others.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
            </optgroup>
          )}
        </Select>
        <FieldError name="programId" />
      </Field>
      {program && (
        <div className="rounded-md border border-line bg-ground/60 p-3 text-sm">
          <p className="font-medium">{program.name}</p>
          <p className="text-muted">{program.university}, {program.country} · {program.tuition}</p>
          {program.requirements && <p className="mt-1 text-muted">Requirements: {program.requirements}</p>}
        </div>
      )}
      <Field label="Intake" htmlFor="intake" required hint={program && !program.intakeMonths.length ? "No intakes are recorded for this program. Pick the one the student is aiming for; the Overseas team confirms it with the institution." : undefined}>
        <Select id="intake" name="intake" disabled={!program} value={intake} onChange={(e) => setIntake(e.target.value)}>
          <option value="">{program ? "Choose an intake" : "Choose a program first"}</option>
          {intakes.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
              {program?.deadlines[i.value] ? ` (apply by ${dayText(program.deadlines[i.value])})` : ""}
            </option>
          ))}
        </Select>
        <FieldError name="intake" />
        {program && intake && program.deadlines[intake] && daysUntil(program.deadlines[intake]) < 0 && (
          <p className="text-xs font-medium text-red-700">
            The institution&apos;s deadline for this intake was {dayText(program.deadlines[intake])}. You can still create the application, but the team may not be able to submit it; check before promising the student.
          </p>
        )}
      </Field>
    </ActionForm>
  );
}

export function StatusForm({ applicationId, currentId, statuses }: { applicationId: string; currentId: string; statuses: { id: string; label: string; requiresReason: boolean; isMilestone: boolean }[] }) {
  const [selected, setSelected] = useState(currentId);
  const s = statuses.find((x) => x.id === selected);
  return (
    <ActionForm action={changeStatusAction} submitLabel="Update status" pendingLabel="Updating…">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Field label="Status" htmlFor={`status-${applicationId}`}>
        <Select id={`status-${applicationId}`} name="statusId" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {statuses.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </Select>
      </Field>
      {s && selected !== currentId && (
        <Field label={s.requiresReason ? "Reason (required)" : "Note to partner (optional)"} htmlFor={`reason-${applicationId}`}>
          <Textarea id={`reason-${applicationId}`} name="reason" rows={2} required={s.requiresReason} />
        </Field>
      )}
      {s?.isMilestone && selected !== currentId && <p className="text-xs text-emerald-700">Milestone: the student gets a WhatsApp update.</p>}
    </ActionForm>
  );
}

export function CommentComposer({ applicationId, channel, whatsapp }: { applicationId: string; channel: "TEAM" | "STUDENT"; whatsapp: boolean }) {
  return (
    <ActionForm action={addCommentAction} submitLabel={channel === "STUDENT" && whatsapp ? "Send to student" : "Post comment"} pendingLabel="Sending…" resetOnSuccess>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="channel" value={channel} />
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`body-${channel}`} className="sr-only">Message</label>
        <FormatBar target={`body-${channel}`} />
        <span className="text-[11px] text-muted">**bold**, *italic*, lines starting &quot;- &quot; for a list</span>
      </div>
      <Textarea id={`body-${channel}`} name="body" rows={3} placeholder={channel === "TEAM" ? "Message the Medcity Overseas team. The student can't see this." : whatsapp ? "Message the student. They'll also get it on WhatsApp." : "Message the student. They'll see it in their portal."} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <label htmlFor={`file-${channel}`}>Attach</label>
        <input id={`file-${channel}`} type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs" />
        <span>PDF or image, up to 10 MB</span>
      </div>
    </ActionForm>
  );
}

export type OfferVisaValues = {
  offerType: string | null;
  offerDate: string | null;
  offerConditions: string | null;
  offerAcceptBy: string | null;
  depositAmount: number | null;
  depositPaidOn: string | null;
  confirmationNumber: string | null;
  confirmationIssuedOn: string | null;
  visaLodgedOn: string | null;
  visaDecision: string | null;
  visaDecisionOn: string | null;
};

export function OfferVisaForm({ applicationId, values, currency, confirmation }: { applicationId: string; values: OfferVisaValues; currency: string; confirmation: string }) {
  const v = (x: string | number | null) => (x == null ? "" : String(x));
  const date = (name: keyof OfferVisaValues, label: string) => (
    <Field label={label} htmlFor={`ov-${name}`}>
      <Input id={`ov-${name}`} name={name} type="date" defaultValue={v(values[name])} />
      <FieldError name={name} />
    </Field>
  );
  return (
    <ActionForm action={saveOfferVisaAction} submitLabel="Save offer and visa" submitVariant="secondary">
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Offer" htmlFor="ov-offerType">
          <Select id="ov-offerType" name="offerType" defaultValue={v(values.offerType)}>
            <option value="">No offer yet</option>
            <option value="CONDITIONAL">Conditional</option>
            <option value="UNCONDITIONAL">Unconditional</option>
          </Select>
          <FieldError name="offerType" />
        </Field>
        {date("offerDate", "Offer issued")}
        {date("offerAcceptBy", "Accept by")}
      </div>
      <Field label="Conditions to meet" htmlFor="ov-offerConditions">
        <Textarea id="ov-offerConditions" name="offerConditions" rows={2} defaultValue={v(values.offerConditions)} placeholder="Final marksheets, IELTS 6.5 with no band below 6.0…" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Deposit paid (${currency})`} htmlFor="ov-depositAmount">
          <Input id="ov-depositAmount" name="depositAmount" inputMode="numeric" defaultValue={v(values.depositAmount)} />
          <FieldError name="depositAmount" />
        </Field>
        {date("depositPaidOn", "Deposit paid on")}
        <div />
        <Field label={`${confirmation} number`} htmlFor="ov-confirmationNumber">
          <Input id="ov-confirmationNumber" name="confirmationNumber" defaultValue={v(values.confirmationNumber)} />
        </Field>
        {date("confirmationIssuedOn", `${confirmation} issued`)}
        <div />
        {date("visaLodgedOn", "Visa lodged")}
        <Field label="Visa decision" htmlFor="ov-visaDecision">
          <Select id="ov-visaDecision" name="visaDecision" defaultValue={v(values.visaDecision)}>
            <option value="">Awaiting</option>
            <option value="GRANTED">Granted</option>
            <option value="REFUSED">Refused</option>
          </Select>
          <FieldError name="visaDecision" />
        </Field>
        {date("visaDecisionOn", "Decision date")}
      </div>
    </ActionForm>
  );
}

export function DeadlineAddForm({ applicationId }: { applicationId: string }) {
  return (
    <ActionForm action={addDeadlineAction} submitLabel="Add deadline" submitVariant="secondary" resetOnSuccess>
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="What is due" htmlFor={`dl-type-${applicationId}`}>
          <Select id={`dl-type-${applicationId}`} name="type" defaultValue="">
            <option value="">Choose</option>
            {DEADLINE_TYPES.map((t) => <option key={t} value={t}>{DEADLINE_LABEL[t]}</option>)}
          </Select>
          <FieldError name="type" />
        </Field>
        <Field label="By" htmlFor={`dl-due-${applicationId}`}>
          <Input id={`dl-due-${applicationId}`} name="dueOn" type="date" />
          <FieldError name="dueOn" />
        </Field>
        <Field label="Note" htmlFor={`dl-note-${applicationId}`}>
          <Input id={`dl-note-${applicationId}`} name="note" />
        </Field>
      </div>
    </ActionForm>
  );
}
