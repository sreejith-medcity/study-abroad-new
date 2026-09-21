"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Checkbox, Field } from "@/components/ui";
import { MONTHS } from "@/lib/format";
import { updateProgramAction } from "../actions";

export type EditableProgram = {
  id: string;
  name: string;
  level: string;
  pathway: string;
  status: string;
  studyArea: string | null;
  campus: string | null;
  durationMonths: number | null;
  tuitionPerYear: number | null;
  applicationFee: number | null;
  initialDeposit: number | null;
  intakeMonths: number[];
  minIelts: number | null;
  minPte: number | null;
  minOetGrade: string | null;
  minGermanLevel: string | null;
  maxBacklogs: number | null;
  maxGapYears: number | null;
  moiAccepted: boolean;
  workRights: string;
  workRightsNote: string | null;
  requiredDocs: string[];
};

const v = (x: number | string | null) => (x == null ? "" : String(x));

export function ProgramEditForm({ program, currency, docs }: { program: EditableProgram; currency: string; docs: { code: string; label: string }[] }) {
  return (
    <ActionForm action={updateProgramAction} submitLabel="Save program" className="space-y-6">
      <input type="hidden" name="programId" value={program.id} />

      <Section title="Program">
        <div className="sm:col-span-2"><TextField label="Name" name="name" required defaultValue={program.name} /></div>
        <SelectField label="Level" name="level" required defaultValue={program.level}>
          <option value="UG">Bachelor&apos;s</option>
          <option value="PG">Master&apos;s</option>
          <option value="PG_DIPLOMA">PG diploma</option>
          <option value="UG_DIPLOMA">Diploma</option>
          <option value="PHD">PhD</option>
          <option value="VOCATIONAL">Vocational (Ausbildung)</option>
          <option value="REGISTRATION">Registration route</option>
          <option value="CERTIFICATE">Certificate</option>
          <option value="SCHOOL">School</option>
        </SelectField>
        <SelectField label="Pathway" name="pathway" required defaultValue={program.pathway}>
          <option value="DEGREE">Degree</option>
          <option value="AUSBILDUNG">Ausbildung</option>
          <option value="NURSING">Nurse registration</option>
        </SelectField>
        <TextField label="Study area" name="studyArea" defaultValue={v(program.studyArea)} />
        <TextField label="Campus" name="campus" defaultValue={v(program.campus)} hint="The town that teaches it, where the university has more than one" />
        <TextField label="Duration (months)" name="durationMonths" inputMode="numeric" defaultValue={v(program.durationMonths)} />
        <SelectField label="Status" name="status" required defaultValue={program.status} hint="Only live programs appear in partner search">
          <option value="LIVE">Live</option>
          <option value="DRAFT">Draft</option>
          <option value="ARCHIVED">Archived</option>
        </SelectField>
      </Section>

      <Section title={`Money (${currency})`} note="Leave a figure blank when the institution has not published it. Enter 0 only when it states there is no fee.">
        <TextField label="Tuition per year" name="tuitionPerYear" inputMode="numeric" defaultValue={v(program.tuitionPerYear)} />
        <TextField label="Application fee" name="applicationFee" inputMode="numeric" defaultValue={v(program.applicationFee)} />
        <TextField label="Deposit" name="initialDeposit" inputMode="numeric" defaultValue={v(program.initialDeposit)} />
      </Section>

      <Section title="Intakes">
        <div className="sm:col-span-2">
          <Field label="Intake months" htmlFor="intake-1">
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {MONTHS.map((m, i) => (
                <Checkbox key={m} id={`intake-${i + 1}`} name="intake" value={i + 1} label={m} defaultChecked={program.intakeMonths.includes(i + 1)} />
              ))}
            </div>
            <FieldError name="intake" />
          </Field>
        </div>
      </Section>

      <Section title="Entry requirements" note="Blank means the program sets no rule for it, so the eligibility check will not test it.">
        <TextField label="IELTS overall" name="minIelts" inputMode="decimal" defaultValue={v(program.minIelts)} />
        <TextField label="PTE Academic" name="minPte" inputMode="numeric" defaultValue={v(program.minPte)} />
        <TextField label="OET grade" name="minOetGrade" defaultValue={v(program.minOetGrade)} placeholder="A, B, C+…" />
        <TextField label="German level" name="minGermanLevel" defaultValue={v(program.minGermanLevel)} placeholder="A1 to C2" />
        <TextField label="Backlogs allowed" name="maxBacklogs" inputMode="numeric" defaultValue={v(program.maxBacklogs)} />
        <TextField label="Study gap allowed (years)" name="maxGapYears" inputMode="numeric" defaultValue={v(program.maxGapYears)} />
        <div className="sm:col-span-2">
          <Checkbox name="moiAccepted" label="Accepts a medium of instruction letter instead of an English test" defaultChecked={program.moiAccepted} />
        </div>
      </Section>

      <Section title="Post-study work" note="Mark eligible or not only with evidence, and say what the evidence is.">
        <SelectField label="Answer" name="workRights" defaultValue={program.workRights}>
          <option value="UNKNOWN">Not confirmed</option>
          <option value="ELIGIBLE">Eligible</option>
          <option value="INELIGIBLE">Not eligible</option>
        </SelectField>
        <div className="sm:col-span-2">
          <TextareaField label="Evidence" name="workRightsNote" rows={2} defaultValue={v(program.workRightsNote)} placeholder="For example: programme page states PGWP eligible" />
        </div>
      </Section>

      <Section title="Documents for the application">
        <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
          {docs.map((d) => (
            <Checkbox key={d.code} name="doc" value={d.code} label={d.label} defaultChecked={program.requiredDocs.includes(d.code)} />
          ))}
        </div>
      </Section>
    </ActionForm>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-display text-[15px] font-semibold text-ink">{title}</legend>
      {note && <p className="-mt-1 text-[13px] text-muted">{note}</p>}
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}
