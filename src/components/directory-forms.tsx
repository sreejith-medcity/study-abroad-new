"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { createPromotionAction, saveQuickLinkAction, saveTeamContactAction } from "@/server/directory";

type Contact = { id: string; area: string; name: string; title: string | null; phone: string | null; email: string | null; whatsapp: boolean; level: number; hours: string | null; sortOrder: number };

export function TeamContactForm({ values }: { values?: Contact }) {
  const v = values;
  const f = (k: string) => `tc-${v?.id ?? "new"}-${k}`;
  return (
    <ActionForm action={saveTeamContactAction} submitLabel={v ? "Save contact" : "Add contact"} resetOnSuccess={!v}>
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={f("area")} label="Handles" name="area" defaultValue={v?.area} required placeholder="UK admissions, Visa, Commission" />
        <TextField id={f("name")} label="Name" name="name" defaultValue={v?.name} required />
        <TextField id={f("title")} label="Title" name="title" defaultValue={v?.title ?? ""} />
        <SelectField id={f("level")} label="Level" name="level" defaultValue={String(v?.level ?? 1)}>
          <option value="1">First call</option>
          <option value="2">Escalate to</option>
          <option value="3">Final escalation</option>
        </SelectField>
        <TextField id={f("phone")} label="Phone" name="phone" defaultValue={v?.phone ?? ""} />
        <TextField id={f("email")} label="Email" name="email" type="email" defaultValue={v?.email ?? ""} />
        <TextField id={f("hours")} label="Hours" name="hours" defaultValue={v?.hours ?? ""} placeholder="Mon to Sat, 9.30 to 6 IST" />
        <TextField id={f("sort")} label="Order" name="sortOrder" type="number" min={0} max={999} defaultValue={String(v?.sortOrder ?? 100)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="whatsapp" defaultChecked={v?.whatsapp} className="size-4" /> Reachable on WhatsApp
        </label>
      </div>
    </ActionForm>
  );
}

export function QuickLinkForm() {
  return (
    <ActionForm action={saveQuickLinkAction} submitLabel="Add link" resetOnSuccess submitVariant="secondary">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="ql-label" label="Link name" name="label" required />
        <TextField id="ql-url" label="Address" name="url" required placeholder="https://" />
        <TextField id="ql-note" label="What it is for" name="note" />
        <TextField id="ql-sort" label="Order" name="sortOrder" type="number" min={0} max={999} defaultValue="100" />
      </div>
    </ActionForm>
  );
}

export function PromotionForm({ countries }: { countries: { code: string; name: string }[] }) {
  return (
    <ActionForm action={createPromotionAction} submitLabel="Publish scheme" resetOnSuccess>
      <TextField id="pr-title" label="Title" name="title" required />
      <TextField id="pr-summary" label="In one line" name="summary" required placeholder="₹10,000 extra per UK January visa" />
      <TextareaField id="pr-terms" label="Terms" name="terms" rows={5} required hint="Who qualifies, what counts, when and how it is paid" />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="pr-start" label="Starts" name="startsOn" type="date" required />
        <TextField id="pr-end" label="Ends" name="endsOn" type="date" required />
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Destinations it covers (none means all)</legend>
        <div className="grid grid-cols-2 gap-1 text-[13px]">
          {countries.map((c) => (
            <label key={c.code} className="flex items-center gap-2"><input type="checkbox" name="country" value={c.code} className="accent-brand-600" /> {c.name}</label>
          ))}
        </div>
      </fieldset>
    </ActionForm>
  );
}
