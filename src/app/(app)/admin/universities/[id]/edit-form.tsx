"use client";

import { ActionForm } from "@/components/action-form";
import { TextField, TextareaField } from "@/components/fields";
import { Checkbox } from "@/components/ui";
import { factsText, type UniversityNow } from "@/lib/university-edit";
import { updateUniversityAction } from "../actions";

const v = (x: number | string | null) => (x == null ? "" : String(x));

export function UniversityEditForm({ university, country }: { university: UniversityNow & { id: string }; country: string }) {
  return (
    <ActionForm action={updateUniversityAction} submitLabel="Save university" className="space-y-6">
      <input type="hidden" name="universityId" value={university.id} />

      <Section title="University" note={`In ${country}. The country cannot be changed here.`}>
        <div className="sm:col-span-2"><TextField label="Name" name="name" required defaultValue={university.name} hint="The official name. No two universities in one country may share it." /></div>
        <TextField label="City" name="city" defaultValue={v(university.city)} />
        <TextField label="Website" name="website" type="url" defaultValue={v(university.website)} placeholder="https://" hint="Leave blank if it is not known" />
        <div className="sm:col-span-2">
          <Checkbox name="isPublic" label="Public institution" defaultChecked={university.isPublic} />
        </div>
      </Section>

      <Section title="Rankings" note="As published, for example 154, =154 or 601-650. Leave a ranking blank when the university is not in it.">
        <TextField label="QS ranking" name="qsRank" defaultValue={v(university.qsRank)} />
        <TextField label="QS edition year" name="qsYear" inputMode="numeric" defaultValue={v(university.qsYear)} placeholder="2026" />
        <TextField label="THE ranking" name="theRank" defaultValue={v(university.theRank)} />
        <TextField label="THE edition year" name="theYear" inputMode="numeric" defaultValue={v(university.theYear)} placeholder="2026" />
      </Section>

      <Section title="Profile" note="Plain text, shown to partners on the university page as written, line breaks included.">
        <div className="sm:col-span-2">
          <TextareaField label="About" name="about" rows={8} defaultValue={v(university.about)} />
        </div>
        <div className="sm:col-span-2">
          <TextareaField label="Facts" name="facts" rows={6} defaultValue={factsText(university.facts)} hint="One fact per line, kept as written: Established 1967, Campus in the city centre" />
        </div>
      </Section>
    </ActionForm>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-display text-base font-semibold text-ink">{title}</legend>
      {note && <p className="-mt-1 text-sm text-muted">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
