"use client";

import { useMemo, useState } from "react";
import { FormatBar } from "@/components/format-bar";
import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { dayText, daysUntil } from "@/lib/catalogue";
import { addCommentAction, addDeadlineAction, changeStatusAction, createApplicationAction, saveOfferVisaAction } from "./actions";
import { DEADLINE_LABEL, DEADLINE_TYPES } from "@/lib/deadline-types";

import type { ProgramOption } from "@/server/apply-options";
import { Combobox, type PickOption } from "@/components/combobox";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const asOption = (p: ProgramOption): PickOption => ({
  id: p.id,
  label: p.name,
  sub: `${p.university}, ${p.country}${p.tuition ? ` · ${p.tuition}` : ""}`,
  tag: p.shortlisted ? "Shortlisted" : undefined,
  data: p,
});

export function ApplyForm({
  studentId,
  initialPrograms,
  countries,
  defaultCountry,
  defaultPathway,
  preselectProgramId,
  canApply,
  gate,
}: {
  studentId: string;
  /** What the picker shows before anything is typed: the shortlist, and the course arrived with. */
  initialPrograms: ProgramOption[];
  countries: { code: string; name: string }[];
  defaultCountry: string;
  defaultPathway: string;
  preselectProgramId?: string;
  /** False for a role that builds the file but does not start applications. */
  canApply: boolean;
  /** What the profile stage is still short of, and whether this person may apply anyway. */
  gate?: { missing: string[]; canOverride: boolean; holds: boolean; locked?: string[] };
}) {
  const [intake, setIntake] = useState("");
  const [country, setCountry] = useState(defaultCountry);
  const [pathway, setPathway] = useState(defaultPathway);
  const preselected = initialPrograms.find((p) => p.id === preselectProgramId) ?? null;
  const [program, setProgram] = useState<ProgramOption | null>(preselected);

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

  if (!canApply) {
    return (
      <div className="rounded-lg border border-line bg-surface-2/50 p-4 text-sm">
        <p className="font-medium">Your role does not start applications</p>
        <p className="mt-1 text-muted">
          Build the file and collect the documents; whoever starts applications at your branch, or the Overseas desk, sends it from here.
        </p>
      </div>
    );
  }

  return (
    <ActionForm action={createApplicationAction} submitLabel="Create application" pendingLabel="Creating…">
      <input type="hidden" name="studentId" value={studentId} />
      <Field
        label="Program"
        htmlFor="programId"
        required
        hint="Type a course or a university. The student’s shortlist is at the top until you start typing."
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,170px)_minmax(0,190px)]">
          <Combobox
            name="programId"
            label="Program"
            endpoint="/api/pick/programs"
            params={{ student: studentId, country, pathway }}
            initial={initialPrograms.map(asOption)}
            selected={preselected ? asOption(preselected) : null}
            placeholder="Type a course or university"
            emptyText="No open course matches that. Try fewer words, or clear the filters beside it."
            onPick={(o) => {
              setProgram((o?.data as ProgramOption | undefined) ?? null);
              setIntake("");
            }}
          />
          <Select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">All countries</option>
            {countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </Select>
          <Select aria-label="Pathway" value={pathway} onChange={(e) => setPathway(e.target.value)}>
            <option value="">All pathways</option>
            <option value="DEGREE">University degree</option>
            <option value="AUSBILDUNG">Ausbildung (Germany)</option>
            <option value="NURSING">Nurse registration</option>
          </Select>
        </div>
        <FieldError name="programId" />
      </Field>
      {program && (
        <div className="rounded-md border border-line bg-ground/60 p-3 text-sm">
          <p className="font-medium">{program.name}</p>
          <p className="text-muted">{program.university}, {program.country} · {program.tuition}</p>
          {program.requirements && <p className="mt-1 text-muted">Requirements: {program.requirements}</p>}
        </div>
      )}
      <p className="text-[13px] text-muted">
        Which vendor this goes through is the Overseas desk&rsquo;s decision, made once the documents are in. Build the file, collect the paper, then hand it over.
      </p>
      {gate && gate.missing.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px]">
          <p className="font-medium text-amber-900">The profile documents are not complete</p>
          <p className="mt-0.5 text-amber-900">Still needed: {gate.missing.join(", ")}.</p>
          {gate.holds && gate.canOverride ? (
            <Field label="Reason for applying anyway" htmlFor="gateReason" hint="Logged on the file and shown on the documentation tab.">
              <Input id="gateReason" name="gateReason" />
              <FieldError name="gateReason" />
            </Field>
          ) : (
            <p className="mt-1 text-amber-900">
              {gate.locked && gate.locked.length > 0
                ? `${gate.locked.join(", ")} cannot be waived by anybody, so this has to wait until ${gate.locked.length === 1 ? "it is" : "they are"} in.`
                : gate.holds
                  ? "Collect them on the Documentation tab, or ask the Overseas team to let this one through."
                  : "The application can still be created. Collect them on the Documentation tab before it is handed to the desk."}
            </p>
          )}
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
