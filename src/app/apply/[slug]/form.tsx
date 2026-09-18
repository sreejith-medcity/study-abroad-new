"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { submitPublicEnquiryAction } from "./actions";

const CONSENT =
  "I agree to Medcity Overseas contacting me about studying or working abroad, and to their keeping the details I have given here for that purpose.";

export function PublicEnquiryForm({ slug, countries }: { slug: string; countries: string[] }) {
  const year = new Date().getFullYear();
  return (
    <ActionForm action={submitPublicEnquiryAction} submitLabel="Send my details" pendingLabel="Sending…">
      <input type="hidden" name="slug" value={slug} />
      {/* Honeypot: hidden from people, tempting to bots. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Your name" name="name" required autoComplete="name" className="sm:col-span-2" />
        <TextField label="Mobile number" name="phone" required placeholder="+91 98xxxxxxxx" autoComplete="tel" hint="We will call or message you on WhatsApp" />
        <TextField label="Email" name="email" type="email" autoComplete="email" hint="Optional" />
        <TextField label="Town or city" name="city" autoComplete="address-level2" />
        <SelectField label="What interests you" name="interestPathway" defaultValue="">
          <option value="">Not sure yet</option>
          <option value="DEGREE">A university degree abroad</option>
          <option value="AUSBILDUNG">Ausbildung in Germany</option>
          <option value="NURSING">Nurse registration abroad</option>
        </SelectField>
        <SelectField label="Where you would like to go" name="interestCountry" defaultValue="">
          <option value="">Not sure yet</option>
          {countries.map((c) => (
            <option key={c}>{c}</option>
          ))}
          <option value="Other">Somewhere else</option>
        </SelectField>
        <SelectField label="When you want to start" name="intakeYear" defaultValue="">
          <option value="">Not sure yet</option>
          <option value={year}>{year}</option>
          <option value={year + 1}>{year + 1}</option>
          <option value={year + 2}>{year + 2}</option>
        </SelectField>
      </div>

      <TextareaField label="Anything you want us to know" name="message" rows={3} hint="Your qualification, your IELTS score, a question" />

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
