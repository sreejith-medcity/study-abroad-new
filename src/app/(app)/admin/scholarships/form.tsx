"use client";

import { ActionForm } from "@/components/action-form";
import { TextField, TextareaField } from "@/components/fields";
import { Checkbox, Field } from "@/components/ui";
import { addScholarshipAction } from "./actions";

const LEVELS: [string, string][] = [
  ["UG", "Bachelor's"],
  ["PG", "Master's"],
  ["PG_DIPLOMA", "PG diploma"],
  ["UG_DIPLOMA", "Diploma"],
  ["PHD", "PhD"],
  ["CERTIFICATE", "Certificate"],
  ["VOCATIONAL", "Ausbildung"],
];

export function ScholarshipForm({ universities }: { universities: string[] }) {
  return (
    <ActionForm action={addScholarshipAction} submitLabel="Add scholarship" resetOnSuccess>
      <TextField label="University" name="university" required list="scholarship-universities" autoComplete="off" hint="Start typing and pick from the list" />
      <datalist id="scholarship-universities">
        {universities.map((u) => <option key={u} value={u} />)}
      </datalist>
      <TextField label="Scholarship" name="name" required placeholder="For example: International Merit Scholarship" />
      <TextField label="Amount, as the university words it" name="amount" required placeholder="For example: 20% of first-year tuition" />
      <TextField label="Official page" name="url" required type="url" placeholder="https://" />
      <TextField label="Deadline" name="deadline" type="date" hint="Leave blank if it is open all year" />
      <TextareaField label="Who can get it" name="eligibility" rows={2} placeholder="For example: offer holders with 75% or more in the qualifying degree" />
      <Field label="Levels" htmlFor="level-UG" hint="None ticked means every level">
        <div className="grid grid-cols-2 gap-1.5">
          {LEVELS.map(([v, l]) => <Checkbox key={v} id={`level-${v}`} name="level" value={v} label={l} />)}
        </div>
      </Field>
    </ActionForm>
  );
}
