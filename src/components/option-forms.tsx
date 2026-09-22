"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { EDUCATION_LEVELS, MAX_CHOICES } from "@/lib/options";
import { createOptionRequestAction, optionMessageAction, shortlistAllAction } from "@/server/option-requests";

const LEVELS = [
  ["UG_DIPLOMA", "Diploma"],
  ["UG", "Bachelor's"],
  ["PG_DIPLOMA", "PG diploma"],
  ["PG", "Master's"],
  ["PHD", "PhD"],
  ["VOCATIONAL", "Ausbildung"],
  ["CERTIFICATE", "Certificate"],
] as const;

export function OptionRequestForm({ students, countries, preselect }: { students: { id: string; name: string }[]; countries: { code: string; name: string }[]; preselect?: string }) {
  const [existing, setExisting] = useState(preselect ? "existing" : "new");
  const [dest, setDest] = useState<string[]>([]);
  const [levels, setLevels] = useState<string[]>([]);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : list.length >= MAX_CHOICES ? list : [...list, v]);
  return (
    <ActionForm action={createOptionRequestAction} submitLabel="Send request to the Overseas team" pendingLabel="Sending…">
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted">Who is it for</legend>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-2"><input type="radio" name="who" checked={existing === "existing"} onChange={() => setExisting("existing")} className="accent-brand-600" /> A student already registered</label>
          <label className="flex items-center gap-2"><input type="radio" name="who" checked={existing === "new"} onChange={() => setExisting("new")} className="accent-brand-600" /> Someone not registered yet</label>
        </div>
        {existing === "existing" ? (
          <Field label="Student" htmlFor="or-student">
            <Select id="or-student" name="studentId" defaultValue={preselect ?? ""}>
              <option value="">Choose a student</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Student's full name" htmlFor="or-name">
            <Input id="or-name" name="studentName" />
            <FieldError name="studentName" />
          </Field>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Country of education" htmlFor="or-edu">
          <Input id="or-edu" name="educationCountry" defaultValue="India" />
        </Field>
        <Field label="Highest level completed" htmlFor="or-level" required>
          <Select id="or-level" name="highestLevel" defaultValue="">
            <option value="">Choose</option>
            {EDUCATION_LEVELS.map((l) => <option key={l}>{l}</option>)}
          </Select>
          <FieldError name="highestLevel" />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Destinations (up to {MAX_CHOICES})</legend>
        <div className="flex flex-wrap gap-1.5">
          {countries.map((c) => (
            <label key={c.code} className={`cursor-pointer rounded-full border px-3 py-1 text-[13px] ${dest.includes(c.code) ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft"}`}>
              <input type="checkbox" name="destination" value={c.code} checked={dest.includes(c.code)} onChange={() => toggle(dest, setDest, c.code)} className="sr-only" />
              {c.name}
            </label>
          ))}
        </div>
        <FieldError name="destination" />
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Level to study (up to {MAX_CHOICES})</legend>
        <div className="flex flex-wrap gap-1.5">
          {LEVELS.map(([v, l]) => (
            <label key={v} className={`cursor-pointer rounded-full border px-3 py-1 text-[13px] ${levels.includes(v) ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft"}`}>
              <input type="checkbox" name="studyLevel" value={v} checked={levels.includes(v)} onChange={() => toggle(levels, setLevels, v)} className="sr-only" />
              {l}
            </label>
          ))}
        </div>
        <FieldError name="studyLevel" />
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Field key={i} label={i === 0 ? "Study area" : `Study area ${i + 1} (optional)`} htmlFor={`or-area-${i}`}>
            <Input id={`or-area-${i}`} name={`studyArea${i}`} placeholder={["Data science", "Nursing", "Business analytics"][i]} />
            {i === 0 && <FieldError name="studyArea0" />}
          </Field>
        ))}
      </div>
      <Field label="Marksheets and certificates" htmlFor="or-files" hint="PDF or images, up to 8. Needed when the student has no file here yet.">
        <input id="or-files" type="file" name="files" multiple accept=".pdf,image/*" className="text-xs" />
        <FieldError name="files" />
      </Field>
      <Field label="Anything else the team should know" htmlFor="or-info" hint="Visa refusals, universities they like, study gap, backlogs, budget">
        <Textarea id="or-info" name="additionalInfo" rows={3} />
      </Field>
    </ActionForm>
  );
}

export function OptionMessageForm({ requestId }: { requestId: string }) {
  return (
    <ActionForm action={optionMessageAction} submitLabel="Send" submitVariant="secondary" resetOnSuccess>
      <input type="hidden" name="requestId" value={requestId} />
      <label htmlFor={`om-${requestId}`} className="sr-only">Message</label>
      <Textarea id={`om-${requestId}`} name="body" rows={2} placeholder="Ask the team or reply" />
      <FieldError name="body" />
    </ActionForm>
  );
}

export function ShortlistAllForm({ requestId, count, student }: { requestId: string; count: number; student: string }) {
  return (
    <ActionForm action={shortlistAllAction} submitLabel={`Shortlist all ${count} for ${student}`} pendingLabel="Adding…">
      <input type="hidden" name="requestId" value={requestId} />
    </ActionForm>
  );
}

