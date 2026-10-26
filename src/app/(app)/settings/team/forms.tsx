"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { addCounsellorAction, editMemberAction, resetCounsellorPasswordAction } from "@/server/team";

function DepartmentSelect({ id, departments, value }: { id: string; departments: string[]; value: string | null }) {
  // Somebody put in a department since taken off the list keeps it on
  // screen, so editing them does not quietly drop it.
  const options = value && !departments.includes(value) ? [value, ...departments] : departments;
  return (
    <SelectField id={id} label="Department" name="department" defaultValue={value ?? ""} aria-label="Department">
      <option value="">None</option>
      {options.map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </SelectField>
  );
}

export function AddCounsellorForm({ departments }: { departments: string[] }) {
  return (
    <ActionForm action={addCounsellorAction} submitLabel="Add counsellor" pendingLabel="Adding…" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="tm-name" label="Name" name="name" required />
        <TextField id="tm-email" label="Email" name="email" type="email" required hint="They sign in with this" />
        <TextField id="tm-phone" label="Phone" name="phone" />
        <TextField id="tm-desk" label="Desk" name="deskLabel" placeholder="UK desk, Germany desk" />
        <DepartmentSelect id="tm-department" departments={departments} value={null} />
      </div>
    </ActionForm>
  );
}

export function ResetPasswordForm({ userId, name }: { userId: string; name: string }) {
  return (
    <ActionForm action={resetCounsellorPasswordAction} submitLabel={`New password for ${name}`} pendingLabel="Resetting…" submitVariant="secondary">
      <input type="hidden" name="userId" value={userId} />
    </ActionForm>
  );
}

/** A counsellor's name, sign-in email, desk and department, edited by the branch head. */
export function EditMemberForm({
  userId,
  name,
  email,
  deskLabel,
  department,
  departments,
}: {
  userId: string;
  name: string;
  email: string;
  deskLabel: string | null;
  department: string | null;
  departments: string[];
}) {
  return (
    <ActionForm action={editMemberAction} submitLabel="Save details" submitVariant="secondary">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`name-${userId}`} label="Name" name="name" defaultValue={name} required />
        <TextField id={`email-${userId}`} label="Sign-in email" name="email" type="email" defaultValue={email} required hint="Changing it signs them out; they sign in again with the new address" />
        <TextField id={`desk-${userId}`} label="Desk" name="deskLabel" defaultValue={deskLabel ?? ""} />
        <DepartmentSelect id={`dept-${userId}`} departments={departments} value={department} />
      </div>
    </ActionForm>
  );
}
