"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { createEnquiryAction, logFollowUpAction, markEnquiryLostAction, updateEnquiryAction } from "./actions";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SOURCES: [string, string][] = [
  ["WALK_IN", "Walk in"],
  ["PHONE", "Phone call"],
  ["WHATSAPP", "WhatsApp"],
  ["WEBSITE", "Website"],
  ["REFERRAL", "Referral"],
  ["EVENT", "Event or seminar"],
  ["SOCIAL", "Social media"],
  ["OTHER", "Other"],
];
const STAGES: [string, string][] = [
  ["NEW", "New"],
  ["CONTACTED", "Contacted"],
  ["QUALIFIED", "Qualified"],
  ["COUNSELLING", "In counselling"],
  ["LOST", "Lost"],
];

export type Person = { id: string; name: string; deskLabel: string | null };

export type EnquiryValues = {
  id?: string;
  name?: string;
  phone?: string;
  email?: string | null;
  city?: string | null;
  source?: string;
  interestCountry?: string | null;
  interestPathway?: string | null;
  intakeMonth?: number | null;
  intakeYear?: number | null;
  budgetLakhs?: number | null;
  assignedToId?: string | null;
  nextFollowUpAt?: Date | null;
  notes?: string | null;
};

function isoDate(d?: Date | null) {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

/** Capture and edit share one shape, so a walk-in and a correction feel the same. */
export function EnquiryForm({
  people,
  countries,
  values = {},
  mode,
  orgs,
}: {
  people: Person[];
  countries: string[];
  values?: EnquiryValues;
  mode: "create" | "edit";
  /** Medcity Overseas staff pick the branch the enquiry belongs to. */
  orgs?: { id: string; name: string }[];
}) {
  const now = new Date();
  const years = [now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  return (
    <ActionForm
      action={mode === "create" ? createEnquiryAction : updateEnquiryAction}
      submitLabel={mode === "create" ? "Save enquiry" : "Save changes"}
      pendingLabel="Saving…"
    >
      {values.id && <input type="hidden" name="enquiryId" value={values.id} />}
      {orgs && orgs.length > 0 && (
        <SelectField label="Branch" name="orgId" required>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </SelectField>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" name="name" required autoComplete="off" defaultValue={values.name} />
        <TextField label="Mobile (WhatsApp)" name="phone" required placeholder="+91 98xxxxxxxx" defaultValue={values.phone} />
        <TextField label="Email" name="email" type="email" defaultValue={values.email ?? ""} hint="Optional" />
        <TextField label="Town or city" name="city" defaultValue={values.city ?? ""} />
        <SelectField label="How they reached us" name="source" defaultValue={values.source ?? "WALK_IN"}>
          {SOURCES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </SelectField>
        <SelectField label="Interested in" name="interestPathway" defaultValue={values.interestPathway ?? ""}>
          <option value="">Not decided</option>
          <option value="DEGREE">University degree</option>
          <option value="AUSBILDUNG">Ausbildung (Germany)</option>
          <option value="NURSING">Nurse registration</option>
        </SelectField>
        <SelectField label="Destination" name="interestCountry" defaultValue={values.interestCountry ?? ""}>
          <option value="">Not decided</option>
          {countries.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </SelectField>
        <SelectField label="Owner" name="assignedToId" defaultValue={values.assignedToId ?? ""}>
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>{p.deskLabel ? `${p.name} · ${p.deskLabel}` : p.name}</option>
          ))}
        </SelectField>
        <SelectField label="Intake month" name="intakeMonth" defaultValue={values.intakeMonth ?? ""}>
          <option value="">Not decided</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </SelectField>
        <SelectField label="Intake year" name="intakeYear" defaultValue={values.intakeYear ?? ""}>
          <option value="">Not decided</option>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </SelectField>
        <TextField label="Budget (lakhs)" name="budgetLakhs" type="number" step="0.5" min="0" defaultValue={values.budgetLakhs ?? ""} hint="Roughly what the family can fund" />
        <TextField label="Next follow up" name="nextFollowUpAt" type="date" defaultValue={isoDate(values.nextFollowUpAt)} hint="Leave empty to decide later" />
      </div>
      <TextareaField label="Notes" name="notes" rows={3} defaultValue={values.notes ?? ""} hint="What they asked for, in their words" />
    </ActionForm>
  );
}

/** One contact attempt: what happened, the stage after it, and the next date. */
export function FollowUpForm({ enquiryId, stage }: { enquiryId: string; stage: string }) {
  return (
    <ActionForm action={logFollowUpAction} submitLabel="Log follow up" pendingLabel="Saving…" resetOnSuccess>
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <Textarea name="body" rows={3} placeholder="Called, asked about Germany intakes, sending the fee structure." aria-label="What happened" />
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Stage after this
          <Select name="stage" defaultValue={stage} className="mt-1">
            {STAGES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </label>
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Next follow up
          <Input type="date" name="nextFollowUpAt" className="mt-1" />
        </label>
      </div>
    </ActionForm>
  );
}

export function LostForm({ enquiryId }: { enquiryId: string }) {
  return (
    <ActionForm action={markEnquiryLostAction} hideSubmit className="space-y-2">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <Textarea name="lostReason" rows={2} placeholder="Chose another consultant, budget, deferred to next year…" aria-label="Why this enquiry was lost" />
      <Button type="submit" variant="danger" size="sm">Close as lost</Button>
    </ActionForm>
  );
}
