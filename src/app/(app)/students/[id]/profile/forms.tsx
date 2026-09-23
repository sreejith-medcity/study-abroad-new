"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { BACKGROUND_QUESTIONS, CONTACT_RELATIONS, type BackgroundAnswers } from "@/lib/background";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { addAcademicAction, addContactAction, addTestAction, addWorkAction, invitePortalAction, requestEditAction, saveBackgroundAction, savePersonalAction } from "../../actions";

type Student = Record<string, unknown> & { id: string };
const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "string" && v ? v.slice(0, 10) : "");
const s = (v: unknown) => (v == null ? "" : String(v));

export function PersonalForm({ student, passportDisplay, disabled }: { student: Student; passportDisplay: string; disabled: boolean }) {
  return (
    <ActionForm action={savePersonalAction} submitLabel="Save personal details" hideSubmit={disabled}>
      <input type="hidden" name="studentId" value={student.id} />
      <fieldset disabled={disabled} className="space-y-5">
        <Section title="Personal information">
          <TextField label="First name" name="firstName" defaultValue={s(student.firstName)} required />
          <TextField label="Last name" name="lastName" defaultValue={s(student.lastName)} required />
          <TextField label="Date of birth" name="dateOfBirth" type="date" defaultValue={d(student.dateOfBirth)} />
          <SelectField label="Gender" name="gender" defaultValue={s(student.gender)}>
            <option value="">Select</option><option>Female</option><option>Male</option><option>Other</option>
          </SelectField>
          <SelectField label="Marital status" name="maritalStatus" defaultValue={s(student.maritalStatus)}>
            <option value="">Select</option><option>Single</option><option>Married</option><option>Divorced</option><option>Widowed</option>
          </SelectField>
          <TextField label="Nationality" name="nationality" defaultValue={s(student.nationality)} required />
          <TextField label="Other citizenship" name="otherCitizenship" defaultValue={s(student.otherCitizenship)} hint="Only if a citizen of a second country" />
          <TextField label="Living or studying in another country" name="livingInCountry" defaultValue={s(student.livingInCountry)} hint="Leave blank if living in India" />
          <TextField label="Email" name="email" type="email" defaultValue={s(student.email)} hint="Needed before the student can sign in to the portal" />
          <TextField label="Mobile (WhatsApp)" name="phone" defaultValue={s(student.phone)} required />
          <SelectField label="Language for messages" name="preferredLanguage" defaultValue={s(student.preferredLanguage)}>
            <option value="en">English</option><option value="ml">Malayalam</option>
          </SelectField>
          <label className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" name="whatsappOptIn" defaultChecked={Boolean(student.whatsappOptIn)} className="size-4" /> Send updates on WhatsApp
          </label>
        </Section>
        <Section title="Permanent address">
          <TextField label="Address line 1" name="addressLine1" defaultValue={s(student.addressLine1)} />
          <TextField label="Address line 2" name="addressLine2" defaultValue={s(student.addressLine2)} />
          <TextField label="City" name="city" defaultValue={s(student.city)} />
          <TextField label="State" name="state" defaultValue={s(student.state)} />
          <TextField label="Pincode" name="pincode" defaultValue={s(student.pincode)} />
          <MailingAddress same={student.mailingSameAsPermanent !== false} address={s(student.mailingAddress)} />
        </Section>
        <Section title="Passport">
          <TextField label="Passport number" name="passportNumber" defaultValue={passportDisplay} />
          <TextField label="Issue date" name="passportIssue" type="date" defaultValue={d(student.passportIssue)} />
          <TextField label="Expiry date" name="passportExpiry" type="date" defaultValue={d(student.passportExpiry)} />
          <TextField label="Issue country" name="passportIssueCountry" defaultValue={s(student.passportIssueCountry)} />
          <TextField label="City of birth" name="cityOfBirth" defaultValue={s(student.cityOfBirth)} />
        </Section>
        <Section title="Academic history summary">
          <TextField label="Backlogs" name="backlogs" type="number" min={0} defaultValue={s(student.backlogs)} />
          <TextField label="Study gap (years)" name="gapYears" type="number" min={0} defaultValue={s(student.gapYears)} />
        </Section>
      </fieldset>
    </ActionForm>
  );
}

function MailingAddress({ same: initial, address }: { same: boolean; address: string }) {
  const [same, setSame] = useState(initial);
  return (
    <div className="sm:col-span-2 lg:col-span-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="mailingSameAsPermanent" checked={same} onChange={(e) => setSame(e.target.checked)} className="size-4" />
        Mailing address is the same as the permanent address
      </label>
      {!same && (
        <div className="mt-3">
          <TextareaField label="Mailing address" name="mailingAddress" rows={2} defaultValue={address} />
        </div>
      )}
    </div>
  );
}

export function BackgroundForm({ studentId, answers, disabled }: { studentId: string; answers: BackgroundAnswers; disabled: boolean }) {
  const [yes, setYes] = useState<Record<string, boolean>>(Object.fromEntries(BACKGROUND_QUESTIONS.map((q) => [q.key, answers[q.key]?.answer === true])));
  return (
    <ActionForm action={saveBackgroundAction} submitLabel="Save background answers" hideSubmit={disabled} submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <fieldset disabled={disabled} className="space-y-4">
        {BACKGROUND_QUESTIONS.map((q) => {
          const a = answers[q.key];
          return (
            <div key={q.key} role="radiogroup" aria-label={q.text} className="rounded-lg border border-line p-3">
              <p className="text-sm font-medium">{q.text}</p>
              <div className="mt-2 flex gap-5 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name={`bg_${q.key}`} value="yes" defaultChecked={a?.answer === true} onChange={() => setYes((y) => ({ ...y, [q.key]: true }))} /> Yes
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name={`bg_${q.key}`} value="no" defaultChecked={a?.answer === false} onChange={() => setYes((y) => ({ ...y, [q.key]: false }))} /> No
                </label>
              </div>
              <FieldError name={`bg_${q.key}`} />
              {yes[q.key] && (
                <div className="mt-2">
                  <TextareaField label="Details" name={`bg_${q.key}_details`} rows={2} defaultValue={a?.details ?? ""} />
                </div>
              )}
            </div>
          );
        })}
      </fieldset>
    </ActionForm>
  );
}

export function ContactForm({ studentId }: { studentId: string }) {
  return (
    <ActionForm action={addContactAction} submitLabel="Add contact" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <SelectField label="Relation" name="relation" id="contact-relation" defaultValue="Father" required>
          {CONTACT_RELATIONS.map((r) => <option key={r}>{r}</option>)}
        </SelectField>
        <TextField label="Contact name" name="name" id="contact-name" required />
        <TextField label="Contact phone" name="phone" id="contact-phone" />
        <TextField label="Contact email" name="email" id="contact-email" type="email" />
        <label className="flex items-center gap-2 text-sm sm:col-span-4">
          <input type="checkbox" name="emergency" className="size-4" /> Emergency contact
        </label>
      </div>
    </ActionForm>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 font-semibold text-brand-700">{title}</h3>
      <div className="grid gap-4 border-l-4 border-brand-100 pl-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

type AcademicDefaults = { level?: string | null; institution?: string | null; course?: string | null; gradingSystem?: string | null; score?: number | null; yearCompleted?: number | null };

export function AcademicForm({ studentId, defaults = {}, idPrefix = "" }: { studentId: string; defaults?: AcademicDefaults; idPrefix?: string }) {
  return (
    <ActionForm action={addAcademicAction} submitLabel="Add qualification" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField id={`${idPrefix}level`} label="Level" name="level" defaultValue={defaults.level ?? "UG"} required>
          <option value="SCHOOL">Std. 12th / school</option><option value="UG_DIPLOMA">Diploma</option><option value="UG">Bachelor's</option>
          <option value="PG_DIPLOMA">PG diploma</option><option value="PG">Master's</option><option value="PHD">PhD</option>
        </SelectField>
        <TextField id={`${idPrefix}institution`} label="Institution" name="institution" defaultValue={defaults.institution ?? ""} required />
        <TextField id={`${idPrefix}course`} label="Course" name="course" defaultValue={defaults.course ?? ""} />
        <SelectField id={`${idPrefix}gradingSystem`} label="Grading" name="gradingSystem" defaultValue={defaults.gradingSystem ?? "percentage"}>
          <option value="percentage">Percentage</option><option value="cgpa10">CGPA out of 10</option><option value="cgpa4">GPA out of 4</option>
        </SelectField>
        <TextField id={`${idPrefix}score`} label="Score" name="score" type="number" step="0.01" defaultValue={defaults.score ?? ""} />
        <TextField id={`${idPrefix}yearCompleted`} label="Year completed" name="yearCompleted" type="number" defaultValue={defaults.yearCompleted ?? ""} />
      </div>
    </ActionForm>
  );
}

export function TestForm({ studentId, defaults = {}, idPrefix = "" }: { studentId: string; defaults?: { test?: string | null; overall?: string | null; takenOn?: string | null }; idPrefix?: string }) {
  return (
    <ActionForm action={addTestAction} submitLabel="Add test score" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField id={`${idPrefix}test`} label="Test" name="test" defaultValue={defaults.test ?? "IELTS"} required>
          <option>IELTS</option><option>PTE</option><option>OET</option><option value="TOEFL">TOEFL iBT</option><option value="DUOLINGO">Duolingo</option><option value="GERMAN">German (CEFR)</option><option>GRE</option><option>GMAT</option><option>SAT</option><option>ACT</option>
        </SelectField>
        <TextField id={`${idPrefix}overall`} label="Overall score / grade" name="overall" required placeholder="6.5, B, B1" defaultValue={defaults.overall ?? ""} />
        <TextField id={`${idPrefix}takenOn`} label="Test date" name="takenOn" type="date" defaultValue={defaults.takenOn ?? ""} />
      </div>
    </ActionForm>
  );
}

export function WorkForm({ studentId }: { studentId: string }) {
  return (
    <ActionForm action={addWorkAction} submitLabel="Add work experience" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField label="Employer" name="employer" required />
        <TextField label="Job title" name="title" required />
        <TextField label="Start date" name="startDate" type="date" required />
        <TextField label="End date" name="endDate" type="date" hint="Leave blank if current" />
      </div>
    </ActionForm>
  );
}

export function RequestEditForm({ studentId }: { studentId: string }) {
  return (
    <ActionForm action={requestEditAction} submitLabel="Send edit request" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <SelectField label="Section" name="section" defaultValue="Personal information">
          <option>Personal information</option><option>Address</option><option>Passport</option><option>Academic qualifications</option><option>Work experience</option><option>Tests</option><option>Background</option><option>Contacts</option>
        </SelectField>
        <TextareaField label="What needs to change?" name="message" rows={2} required />
      </div>
    </ActionForm>
  );
}

export function PortalInviteForm({ studentId, invited }: { studentId: string; invited: boolean }) {
  return (
    <ActionForm
      action={invitePortalAction}
      submitLabel={invited ? "Send a new password" : "Give portal access"}
      pendingLabel="Preparing…"
      submitVariant="secondary"
    >
      <input type="hidden" name="studentId" value={studentId} />
    </ActionForm>
  );
}
