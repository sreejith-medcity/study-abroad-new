"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { addAcademicAction, addTestAction, addWorkAction, invitePortalAction, requestEditAction, savePersonalAction } from "../../actions";

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
          <TextField label="Email" name="email" type="email" defaultValue={s(student.email)} required />
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-3 font-semibold text-brand-700">{title}</h3>
      <div className="grid gap-4 border-l-4 border-brand-100 pl-4 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

export function AcademicForm({ studentId }: { studentId: string }) {
  return (
    <ActionForm action={addAcademicAction} submitLabel="Add qualification" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Level" name="level" defaultValue="UG" required>
          <option value="SCHOOL">Std. 12th / school</option><option value="UG_DIPLOMA">Diploma</option><option value="UG">Bachelor's</option>
          <option value="PG_DIPLOMA">PG diploma</option><option value="PG">Master's</option><option value="PHD">PhD</option>
        </SelectField>
        <TextField label="Institution" name="institution" required />
        <TextField label="Course" name="course" />
        <SelectField label="Grading" name="gradingSystem" defaultValue="percentage">
          <option value="percentage">Percentage</option><option value="cgpa10">CGPA out of 10</option><option value="cgpa4">GPA out of 4</option>
        </SelectField>
        <TextField label="Score" name="score" type="number" step="0.01" />
        <TextField label="Year completed" name="yearCompleted" type="number" />
      </div>
    </ActionForm>
  );
}

export function TestForm({ studentId }: { studentId: string }) {
  return (
    <ActionForm action={addTestAction} submitLabel="Add test score" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label="Test" name="test" defaultValue="IELTS" required>
          <option>IELTS</option><option>PTE</option><option>OET</option><option value="TOEFL">TOEFL iBT</option><option value="DUOLINGO">Duolingo</option><option value="GERMAN">German (CEFR)</option><option>GRE</option><option>GMAT</option><option>SAT</option>
        </SelectField>
        <TextField label="Overall score / grade" name="overall" required placeholder="6.5, B, B1" />
        <TextField label="Test date" name="takenOn" type="date" />
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
          <option>Personal information</option><option>Address</option><option>Passport</option><option>Academic qualifications</option><option>Work experience</option><option>Tests</option>
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
