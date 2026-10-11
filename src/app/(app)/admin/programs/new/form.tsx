"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Combobox, type PickOption } from "@/components/combobox";
import { Alert, Card, Field, Input, Select } from "@/components/ui";
import { PICK_LEVELS } from "@/lib/aims";
import { createProgramAction } from "../actions";

export function NewProgramForm({ countries }: { countries: { code: string; name: string }[] }) {
  const [country, setCountry] = useState("");
  const [university, setUniversity] = useState<PickOption | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <ActionForm action={createProgramAction} submitLabel="Add the course" pendingLabel="Adding…">
      <Card className="space-y-4 p-5">
        <Field label="Country" htmlFor="countryCode" required={adding} hint="Narrows the university search, and says where a new university sits.">
          <Select id="countryCode" name="countryCode" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Choose a country</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <FieldError name="countryCode" />
        </Field>

        {adding ? (
          <Field label="University" htmlFor="newUniversity" required hint="Its full official name. Check the list first, so the catalogue does not end up with two spellings of one university.">
            <Input id="newUniversity" name="newUniversity" placeholder="Teesside University" />
            <FieldError name="newUniversity" />
            <button type="button" onClick={() => setAdding(false)} className="mt-1 text-[13px] font-medium text-brand-700 hover:underline">
              Search the ones already here instead
            </button>
          </Field>
        ) : (
          <Field label="University" htmlFor="university-pick" hint="Type a few letters. Not there? Add it below.">
            <Combobox
              name="universityId"
              label="University"
              endpoint="/api/pick/universities"
              params={country ? { country } : undefined}
              placeholder="Type a university name"
              emptyText="No university here matches that."
              onPick={setUniversity}
            />
            <FieldError name="universityId" />
            {!university && (
              <button type="button" onClick={() => setAdding(true)} className="mt-1 text-[13px] font-medium text-brand-700 hover:underline">
                It is not in the list, add it
              </button>
            )}
          </Field>
        )}

        <Field label="Campus city" htmlFor="city" hint="Where this course is taught. Optional.">
          <Input id="city" name="city" placeholder="Middlesbrough" />
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <Field label="Course name" htmlFor="name" required hint="Exactly as the institution writes it, so it matches what the student has been reading.">
          <Input id="name" name="name" placeholder="MSc Aviation Management" />
          <FieldError name="name" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Level" htmlFor="level" required>
            <Select id="level" name="level" defaultValue="PG">
              {PICK_LEVELS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </Select>
            <FieldError name="level" />
          </Field>
          <Field label="Pathway" htmlFor="pathway" required hint="Which journey a file on this course follows.">
            <Select id="pathway" name="pathway" defaultValue="DEGREE">
              <option value="DEGREE">University degree</option>
              <option value="AUSBILDUNG">Ausbildung (Germany)</option>
              <option value="NURSING">Nurse registration</option>
            </Select>
            <FieldError name="pathway" />
          </Field>
          <Field label="Study area" htmlFor="studyArea" hint="A short subject phrase, for the filters.">
            <Input id="studyArea" name="studyArea" placeholder="Aviation" />
          </Field>
          <Field label="Duration in months" htmlFor="durationMonths">
            <Input id="durationMonths" name="durationMonths" inputMode="numeric" placeholder="12" />
            <FieldError name="durationMonths" />
          </Field>
        </div>
        <Field label="Course page" htmlFor="programUrl" hint="The institution's own page for it. Whoever fills in the fees next will need it.">
          <Input id="programUrl" name="programUrl" placeholder="https://" />
          <FieldError name="programUrl" />
        </Field>
      </Card>

      <Alert tone="info" title="Fees and requirements come next">
        This saves the course as a draft and opens it, where the fees, intakes, English requirements and documents are filled in. Leave anything the
        institution does not state empty: an empty field reads as &ldquo;Not recorded&rdquo;, which is true, and a guessed one is not.
      </Alert>
    </ActionForm>
  );
}
