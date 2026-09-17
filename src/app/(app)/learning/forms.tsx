"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Checkbox, Field, Input } from "@/components/ui";
import { saveResourceAction } from "./actions";

const AUDIENCES: [string, string][] = [
  ["PARTNER", "Partner owners"],
  ["COUNSELLOR", "Counsellors"],
  ["ADMIN", "Overseas team"],
  ["MANAGEMENT", "Management"],
];

const KINDS: [string, string][] = [
  ["GUIDE", "Guide"],
  ["TEMPLATE", "Template"],
  ["POLICY", "Policy"],
  ["TRAINING", "Training"],
  ["MARKETING", "Marketing"],
  ["FAQ", "FAQ"],
];

export function ResourceForm({ countries }: { countries: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveResourceAction} submitLabel="Add to the library" pendingLabel="Saving…" resetOnSuccess>
      <TextField label="Title" name="title" required placeholder="UK student visa: document checklist" />
      <TextareaField label="Summary" name="summary" rows={2} hint="One or two lines, so people know what they are opening" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Kind" name="kind" defaultValue="GUIDE">
          {KINDS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </SelectField>
        <SelectField label="Pathway" name="pathway" defaultValue="">
          <option value="">Any pathway</option>
          <option value="DEGREE">Degree</option>
          <option value="AUSBILDUNG">Ausbildung</option>
          <option value="NURSING">Nurse registration</option>
        </SelectField>
        <SelectField label="Destination" name="countryId" defaultValue="">
          <option value="">Any destination</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </SelectField>
        <TextField label="Link" name="url" placeholder="https://…" hint="Use this instead of a file for a video or a page" />
      </div>
      <Field label="File" htmlFor="file" hint="PDF, JPG, PNG or WebP, up to 10 MB">
        <Input id="file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="py-1.5" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Who can see it</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {AUDIENCES.map(([value, label]) => (
            <Checkbox key={value} name={`audience_${value}`} label={label} defaultChecked={value === "PARTNER" || value === "COUNSELLOR"} />
          ))}
        </div>
      </fieldset>
    </ActionForm>
  );
}
