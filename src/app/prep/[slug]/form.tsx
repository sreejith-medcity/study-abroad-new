"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { submitPublicEnquiryAction } from "@/app/apply/[slug]/actions";

const CONSENT =
  "I agree to Medcity Overseas contacting me about studying or working abroad, and to their keeping the details I have given here for that purpose.";

export function PrepEnquiryForm({ slug, courses, preselect }: { slug: string; courses: { id: string; label: string }[]; preselect?: string }) {
  return (
    <ActionForm action={submitPublicEnquiryAction} submitLabel="Ask about this course" pendingLabel="Sending…">
      <input type="hidden" name="slug" value={slug} />
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <SelectField label="Course" name="prepCourse" defaultValue={preselect ?? ""} required>
        <option value="">Choose a course</option>
        {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Your name" name="name" required autoComplete="name" className="sm:col-span-2" />
        <TextField label="Mobile number" name="phone" required placeholder="+91 98xxxxxxxx" autoComplete="tel" />
        <TextField label="Email" name="email" type="email" autoComplete="email" hint="Optional" />
      </div>
      <TextareaField label="Anything you want us to know" name="message" rows={2} hint="Your target score, when your exam is, a question" />
      <div className="rounded-lg border border-line bg-surface-2/60 p-3.5">
        <label className="flex items-start gap-2.5 text-[13px] leading-relaxed">
          <input type="checkbox" name="consent" className="mt-0.5 size-4 shrink-0 accent-brand-600" />
          <span>{CONSENT}</span>
        </label>
        <FieldError name="consent" />
      </div>
    </ActionForm>
  );
}
