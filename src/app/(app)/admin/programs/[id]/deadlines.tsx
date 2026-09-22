"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select } from "@/components/ui";
import { MONTHS } from "@/lib/format";
import { saveDeadlineAction } from "./deadline-actions";

export function DeadlineForm({ programId, intakeMonths }: { programId: string; intakeMonths: number[] }) {
  const now = new Date();
  const months = intakeMonths.length ? intakeMonths : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const options: { value: string; label: string; order: number }[] = [];
  for (let y = now.getFullYear(); y <= now.getFullYear() + 2; y++) {
    for (const m of months) if (new Date(y, m, 0) >= now) options.push({ value: `${y}-${m}`, label: `${MONTHS[m - 1]} ${y}`, order: y * 100 + m });
  }
  options.sort((a, b) => a.order - b.order);
  return (
    <ActionForm action={saveDeadlineAction} submitLabel="Save deadline" submitVariant="secondary" resetOnSuccess>
      <input type="hidden" name="programId" value={programId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Intake" htmlFor="dl-intake" required>
          <Select id="dl-intake" name="intake" defaultValue="">
            <option value="">Choose</option>
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
          <FieldError name="intake" />
        </Field>
        <Field label="Last day to apply" htmlFor="dl-date" required>
          <Input id="dl-date" name="deadline" type="date" />
          <FieldError name="deadline" />
        </Field>
      </div>
      <Field label="Note (optional)" htmlFor="dl-note" hint="Where it is published, or a separate deadline for scholarships.">
        <Input id="dl-note" name="note" />
      </Field>
    </ActionForm>
  );
}
