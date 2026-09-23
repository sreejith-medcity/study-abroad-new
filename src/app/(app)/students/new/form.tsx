"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { createStudentAction } from "../actions";

export type StudentPrefill = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  preferredCountry?: string;
  preferredPathway?: string;
  enquiryId?: string;
};

export function NewStudentForm({
  counsellors,
  countries,
  prefill = {},
}: {
  counsellors: { id: string; name: string; deskLabel: string | null }[];
  countries: string[];
  prefill?: StudentPrefill;
}) {
  return (
    <ActionForm action={createStudentAction} submitLabel="Create student" pendingLabel="Creating…">
      {prefill.enquiryId && <input type="hidden" name="enquiryId" value={prefill.enquiryId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="First name" name="firstName" required autoComplete="off" defaultValue={prefill.firstName} />
        <TextField label="Last name" name="lastName" required autoComplete="off" defaultValue={prefill.lastName} />
        <TextField label="Email" name="email" type="email" hint="Needed for the student portal; leave it blank if they have none" defaultValue={prefill.email} />
        <TextField label="Mobile (WhatsApp)" name="phone" required placeholder="+91 98xxxxxxxx" hint="Status updates go to this number on WhatsApp" defaultValue={prefill.phone} />
        <SelectField label="Preferred country" name="preferredCountry" defaultValue={prefill.preferredCountry ?? ""}>
          <option value="">Not decided</option>
          {countries.map((c) => <option key={c}>{c}</option>)}
        </SelectField>
        <SelectField label="Pathway" name="preferredPathway" defaultValue={prefill.preferredPathway ?? ""}>
          <option value="">Not decided</option>
          <option value="DEGREE">University degree</option>
          <option value="AUSBILDUNG">Ausbildung (Germany)</option>
          <option value="NURSING">Nurse registration</option>
        </SelectField>
        <SelectField label="Assign to" name="assignedToId" defaultValue="">
          <option value="">Me / unassigned</option>
          {counsellors.map((c) => <option key={c.id} value={c.id}>{c.deskLabel ?? c.name}</option>)}
        </SelectField>
      </div>
      <div className="rounded-md border border-line bg-ground/60 p-3">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="consent" className="mt-0.5 size-4" />
          <span>
            The student has agreed to Medcity Overseas collecting and processing their personal data, including passport and academic documents, to assess eligibility and apply to institutions and employers on their behalf.
          </span>
        </label>
        <FieldError name="consent" />
      </div>
    </ActionForm>
  );
}
