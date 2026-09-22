"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { BULLETIN_KINDS, BULLETIN_LABEL } from "@/lib/bulletins";
import { createBulletinAction } from "@/server/bulletins";

export function BulletinForm({ countries }: { countries: { code: string; name: string }[] }) {
  return (
    <ActionForm action={createBulletinAction} submitLabel="Publish" resetOnSuccess>
      <Field label="What it is" htmlFor="bl-kind" required>
        <Select id="bl-kind" name="kind" defaultValue="">
          <option value="">Choose</option>
          {BULLETIN_KINDS.map((k) => <option key={k} value={k}>{BULLETIN_LABEL[k]}</option>)}
        </Select>
        <FieldError name="kind" />
      </Field>
      <Field label="Title" htmlFor="bl-title" required>
        <Input id="bl-title" name="title" />
        <FieldError name="title" />
      </Field>
      <Field label="Details" htmlFor="bl-body" required>
        <Textarea id="bl-body" name="body" rows={5} />
        <FieldError name="body" />
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Countries it concerns</legend>
        <div className="grid grid-cols-2 gap-1 text-[13px]">
          {countries.map((c) => (
            <label key={c.code} className="flex items-center gap-2"><input type="checkbox" name="country" value={c.code} className="accent-brand-600" /> {c.name}</label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="University (optional)" htmlFor="bl-uni" hint="As named in the catalogue">
          <Input id="bl-uni" name="university" />
          <FieldError name="university" />
        </Field>
        <Field label="Intakes (optional)" htmlFor="bl-intakes">
          <Input id="bl-intakes" name="intakes" placeholder="Jan and May 2027" />
        </Field>
        <Field label="Button label (optional)" htmlFor="bl-cta">
          <Input id="bl-cta" name="ctaLabel" placeholder="Register" />
        </Field>
        <Field label="Button link" htmlFor="bl-url">
          <Input id="bl-url" name="ctaUrl" placeholder="https:// or /events" />
          <FieldError name="ctaUrl" />
        </Field>
      </div>
    </ActionForm>
  );
}
