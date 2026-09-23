"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { PROGRAM_TAGS, TAG_KEYS } from "@/lib/program-tags";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Checkbox, Field, Textarea } from "@/components/ui";
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
  minToefl: number | null;
  minDuolingo: number | null;
  minGre: number | null;
  minGmat: number | null;
  minSat: number | null;
  minAcademicPercent: number | null;
  minGermanLevel: string | null;
  maxBacklogs: number | null;
  maxGapYears: number | null;
  moiAccepted: boolean;
  feeWaiver: string | null;
  programUrl: string | null;
  minIeltsBand: number | null;
  entryRequirements: string | null;
  balanceDeposit: number | null;
  typicalScholarship: string | null;
  offerTatDays: number | null;
  tags: string[];
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
        <TextField label="Balance deposit" name="balanceDeposit" inputMode="numeric" defaultValue={v(program.balanceDeposit)} />
        <TextField label="Typical scholarship" name="typicalScholarship" defaultValue={v(program.typicalScholarship)} placeholder="As the institution words it: 'Up to 20% of first-year tuition'" />
        <TextField label="Offer in, days" name="offerTatDays" inputMode="numeric" defaultValue={v(program.offerTatDays)} placeholder="How long this institution has been taking to answer, from our own files" />
        <TextField label="Application fee waiver" name="feeWaiver" defaultValue={v(program.feeWaiver)} placeholder="Only if confirmed, in its terms: 'Waived for Medcity applicants until 30 June'" />
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
        <TextField label="IELTS lowest band" name="minIeltsBand" inputMode="decimal" defaultValue={v(program.minIeltsBand)} />
        <TextField label="TOEFL iBT" name="minToefl" inputMode="numeric" defaultValue={v(program.minToefl)} />
        <TextField label="Duolingo" name="minDuolingo" inputMode="numeric" defaultValue={v(program.minDuolingo)} />
        <TextField label="OET grade" name="minOetGrade" defaultValue={v(program.minOetGrade)} placeholder="A, B, C+…" />
        <TextField label="German level" name="minGermanLevel" defaultValue={v(program.minGermanLevel)} placeholder="A1 to C2" />
        <TextField label="Minimum marks in the qualifying study (%)" name="minAcademicPercent" inputMode="decimal" defaultValue={v(program.minAcademicPercent)} placeholder="12th for a bachelor's, bachelor's for a master's" />
        <TextField label="GRE (only if required)" name="minGre" inputMode="numeric" defaultValue={v(program.minGre)} />
        <TextField label="GMAT (only if required)" name="minGmat" inputMode="numeric" defaultValue={v(program.minGmat)} />
        <TextField label="SAT (only if required)" name="minSat" inputMode="numeric" defaultValue={v(program.minSat)} />
        <TextField label="Backlogs allowed" name="maxBacklogs" inputMode="numeric" defaultValue={v(program.maxBacklogs)} />
        <TextField label="Study gap allowed (years)" name="maxGapYears" inputMode="numeric" defaultValue={v(program.maxGapYears)} />
        <div className="sm:col-span-2">
          <Checkbox name="moiAccepted" label="Accepts a medium of instruction letter instead of an English test" defaultChecked={program.moiAccepted} />
        </div>
      </Section>

      <Section title="Program page and labels" note="Labels drive the quick filters in search. Set one only when the institution or experience with it bears it out.">
        <TextField label="Program page on the institution's site" name="programUrl" defaultValue={v(program.programUrl)} placeholder="https://" />
        <div className="sm:col-span-2">
          <Field label="Entry requirements, in the institution's words" htmlFor="entryRequirements">
            <Textarea id="entryRequirements" name="entryRequirements" rows={3} defaultValue={v(program.entryRequirements)} />
          </Field>
        </div>
        <div className="grid gap-1 sm:col-span-2 sm:grid-cols-2">
          {TAG_KEYS.map((t) => <Checkbox key={t} name="tag" value={t} label={PROGRAM_TAGS[t]} defaultChecked={program.tags.includes(t)} />)}
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
