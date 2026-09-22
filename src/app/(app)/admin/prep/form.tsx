"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { PREP_TESTS, PREP_TEST_LABEL } from "@/lib/prep";
import { createPrepCourseAction } from "@/server/prep";

export function PrepCourseForm() {
  return (
    <ActionForm action={createPrepCourseAction} submitLabel="Add course" resetOnSuccess>
      <SelectField id="pc-test" label="Test" name="test" defaultValue="" required>
        <option value="">Choose</option>
        {PREP_TESTS.map((t) => <option key={t} value={t}>{PREP_TEST_LABEL[t]}</option>)}
      </SelectField>
      <TextField id="pc-title" label="Course name" name="title" required placeholder="IELTS Academic, 6 weeks" />
      <TextareaField id="pc-summary" label="What it covers" name="summary" rows={3} required />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="pc-mode" label="Mode" name="mode" required placeholder="Online, or at the branch" />
        <TextField id="pc-weeks" label="Weeks" name="durationWeeks" type="number" min={1} max={52} />
        <TextField id="pc-fee" label="Fee (rupees)" name="feeInr" inputMode="numeric" hint="Blank shows 'Fee on request'" />
        <TextField id="pc-sort" label="Order" name="sortOrder" type="number" min={0} max={999} defaultValue="100" />
      </div>
    </ActionForm>
  );
}
