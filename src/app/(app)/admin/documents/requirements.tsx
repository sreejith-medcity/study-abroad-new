"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { OWED_BY_LABEL, STAGES } from "@/lib/journey";
import { addRejectionReasonAction, saveRequirementAction, setReasonActiveAction, setRequirementActiveAction } from "@/server/documentation-actions";
import type { JourneyStage, OwedBy, RequirementSource } from "@/db/schema";

export type Option = { id: string; name: string };
export type RequirementRow = {
  id: string;
  stage: JourneyStage;
  typeCode: string;
  label: string;
  source: RequirementSource;
  scope: string | null;
  countryId: string | null;
  vendorId: string | null;
  universityId: string | null;
  programId: string | null;
  required: boolean;
  owedBy: OwedBy;
  validityMonths: number | null;
  guidance: string | null;
  guidanceMl: string | null;
  sortOrder: number;
  active: boolean;
};

const OWED: OwedBy[] = ["STUDENT", "MEDCITY", "UNIVERSITY", "VENDOR"];

/** Adds a requirement, or changes the one passed in. */
export function RequirementForm({
  types,
  countries,
  vendors,
  universities,
  row,
  onDone,
}: {
  types: { code: string; label: string }[];
  countries: Option[];
  vendors: Option[];
  universities: Option[];
  row?: RequirementRow;
  onDone?: () => void;
}) {
  const [source, setSource] = useState<RequirementSource>(row?.source ?? "ALWAYS");
  const key = row?.id ?? "new";
  return (
    <ActionForm action={saveRequirementAction} submitLabel={row ? "Save" : "Add the requirement"} resetOnSuccess={!row}>
      {row && <input type="hidden" name="requirementId" value={row.id} />}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Stage" htmlFor={`stage-${key}`} required>
          <Select id={`stage-${key}`} name="stage" defaultValue={row?.stage ?? "PROFILE"}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.number}. {s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Document" htmlFor={`type-${key}`} required>
          <Select id={`type-${key}`} name="typeCode" defaultValue={row?.typeCode ?? ""}>
            <option value="" disabled>Choose a document</option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </Select>
          <FieldError name="typeCode" />
        </Field>
        <Field label="Who asks for it" htmlFor={`source-${key}`} required>
          <Select id={`source-${key}`} name="source" value={source} onChange={(e) => setSource(e.target.value as RequirementSource)}>
            <option value="ALWAYS">The stage, for everybody</option>
            <option value="DESTINATION">The destination</option>
            <option value="ROUTE">The route</option>
            <option value="UNIVERSITY">One university or course</option>
          </Select>
        </Field>
      </div>
      {source === "DESTINATION" && (
        <Field label="Destination" htmlFor={`country-${key}`} required>
          <Select id={`country-${key}`} name="countryId" defaultValue={row?.countryId ?? ""}>
            <option value="" disabled>Choose a destination</option>
            {countries.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <FieldError name="countryId" />
        </Field>
      )}
      {source === "ROUTE" && (
        <Field label="Vendor" htmlFor={`vendor-${key}`} required hint="Every application sent down this vendor's routes picks it up.">
          <Select id={`vendor-${key}`} name="vendorId" defaultValue={row?.vendorId ?? ""}>
            <option value="" disabled>Choose a vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </Select>
          <FieldError name="vendorId" />
        </Field>
      )}
      {source === "UNIVERSITY" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="University" htmlFor={`uni-${key}`} hint="Or leave it empty and give one course's id instead.">
            <Select id={`uni-${key}`} name="universityId" defaultValue={row?.universityId ?? ""}>
              <option value="">Any university</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
            <FieldError name="universityId" />
          </Field>
          <Field label="One course only" htmlFor={`program-${key}`} hint="The course's id, from its page. Leave empty for the whole university.">
            <Input id={`program-${key}`} name="programId" defaultValue={row?.programId ?? ""} />
          </Field>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Owed by" htmlFor={`owed-${key}`}>
          <Select id={`owed-${key}`} name="owedBy" defaultValue={row?.owedBy ?? "STUDENT"}>
            {OWED.map((o) => (
              <option key={o} value={o}>{OWED_BY_LABEL[o]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Good for, in months" htmlFor={`months-${key}`} hint="A TB test is six. Leave empty where the document carries its own expiry.">
          <Input id={`months-${key}`} name="validityMonths" inputMode="numeric" defaultValue={row?.validityMonths ?? ""} />
          <FieldError name="validityMonths" />
        </Field>
        <Field label="Order on the list" htmlFor={`order-${key}`}>
          <Input id={`order-${key}`} name="sortOrder" inputMode="numeric" defaultValue={row?.sortOrder ?? 100} />
          <FieldError name="sortOrder" />
        </Field>
      </div>
      <Field label="The rule, in the team's own words" htmlFor={`guidance-${key}`} hint="Shown beside the document while it is checked, and to the student when it is asked for.">
        <Textarea id={`guidance-${key}`} name="guidance" rows={2} defaultValue={row?.guidance ?? ""} />
      </Field>
      <Field label="The same rule in Malayalam" htmlFor={`guidance-ml-${key}`} hint="What a student reading the portal in Malayalam sees. Left empty, they get the English.">
        <Textarea id={`guidance-ml-${key}`} name="guidanceMl" rows={2} defaultValue={row?.guidanceMl ?? ""} />
      </Field>
      <div className="flex flex-wrap gap-4">
        <Checkbox name="required" defaultChecked={row ? row.required : true} label="Holds the stage until it is in" />
        <Checkbox name="active" defaultChecked={row ? row.active : true} label="In use" />
      </div>
      {onDone && (
        <button type="button" onClick={onDone} className="text-[13px] text-muted hover:text-ink">Close</button>
      )}
    </ActionForm>
  );
}

/** One row on the requirements list, with the form folded away until it is wanted. */
export function RequirementRowActions({ row, types, countries, vendors, universities }: { row: RequirementRow; types: { code: string; label: string }[]; countries: Option[]; vendors: Option[]; universities: Option[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-3">
        <button type="button" className="text-[13px] font-medium text-brand-600 hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Edit"}
        </button>
        <form action={setRequirementActiveAction} className="inline">
          <input type="hidden" name="requirementId" value={row.id} />
          <input type="hidden" name="active" value={row.active ? "0" : "1"} />
          <button type="submit" className="text-[13px] text-muted hover:text-ink">{row.active ? "Pause" : "Use again"}</button>
        </form>
      </div>
      {open && (
        <div className="mt-3 rounded-lg border border-line p-3 text-left">
          <RequirementForm row={row} types={types} countries={countries} vendors={vendors} universities={universities} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** The reasons the team sends a document back. The list grows; nothing is emptied. */
export function ReasonForm() {
  return (
    <ActionForm action={addRejectionReasonAction} submitLabel="Add the reason" resetOnSuccess>
      <Field label="The reason, as the student will read it" htmlFor="reason-label" required hint="Plain words they can act on: not clear enough, the period is too short.">
        <Input id="reason-label" name="label" />
        <FieldError name="label" />
      </Field>
    </ActionForm>
  );
}

export function ReasonToggle({ code, active }: { code: string; active: boolean }) {
  return (
    <form action={setReasonActiveAction} className="inline">
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <button type="submit" className="text-[13px] text-muted hover:text-ink">{active ? "Retire" : "Use again"}</button>
    </form>
  );
}
