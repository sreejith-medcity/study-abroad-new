"use client";

import { HQ_ROLE_OPTIONS, PARTNER_ROLE_OPTIONS } from "@/lib/permissions";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { Button, Select } from "@/components/ui";
import { addUserAction, changeRoleAction, editUserAction, invitePartnerAction, moveUserAction, resetPasswordAction } from "./actions";


export function InvitePartnerForm() {
  return (
    <ActionForm action={invitePartnerAction} submitLabel="Create partner" resetOnSuccess>
      <TextField label="Organisation name" name="orgName" required />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Type" name="type" defaultValue="SUB_AGENT">
          <option value="BRANCH">Medcity branch</option>
          <option value="SUB_AGENT">Sub-agent</option>
        </SelectField>
        <SelectField label="Tier" name="tier" defaultValue="SILVER">
          <option>SILVER</option>
          <option>GOLD</option>
          <option>ELITE</option>
          <option>PLATINUM</option>
        </SelectField>
      </div>
      <TextField label="City" name="city" />
      <TextField label="Owner name" name="ownerName" required />
      <TextField label="Owner email" name="ownerEmail" type="email" required />
      <TextField label="Owner phone" name="ownerPhone" />
    </ActionForm>
  );
}

// The lists themselves live in permissions.ts, next to the roles they mirror.
export { HQ_ROLE_OPTIONS, PARTNER_ROLE_OPTIONS };

const TITLE_SUGGESTIONS: Record<string, string> = {
  SUPER_ADMIN: "Platform owner",
  OPS_MANAGER: "Operations",
  ADMIN: "UK desk",
  DOCUMENTATION: "Documentation",
  MANAGEMENT: "Management",
  PARTNER: "Branch head",
  DESK_COUNSELLOR: "Overseas counselling",
  SENIOR_COUNSELLOR: "Senior counsellor",
  TRAINEE_COUNSELLOR: "Trainee",
  SUB_AGENT_COUNSELLOR: "Counsellor",
  COUNSELLOR: "Ausbildung counsellor",
};

/** The department picker, the same on adding and on editing. */
function DepartmentSelect({ id, departments, value }: { id: string; departments: string[]; value: string | null }) {
  // Somebody put in a department since taken off the list keeps it on
  // screen, so editing them does not quietly drop it.
  const options = value && !departments.includes(value) ? [value, ...departments] : departments;
  return (
    <SelectField id={id} label="Department" name="department" defaultValue={value ?? ""} aria-label="Department" hint="Kept in Settings, Platform">
      <option value="">None</option>
      {options.map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </SelectField>
  );
}

export function AddUserForm({
  orgId,
  hq,
  subAgent,
  canCreateStaff,
  canCreateSuperAdmin,
  roleLabel,
  roleBlurb,
  departments,
}: {
  orgId: string;
  hq: boolean;
  subAgent?: boolean;
  canCreateStaff: boolean;
  canCreateSuperAdmin: boolean;
  roleLabel: Record<string, string>;
  roleBlurb: Record<string, string>;
  departments: string[];
}) {
  // A sub-agent's own counsellor only makes sense inside a sub-agent firm, so a
  // branch is not offered it and a firm is not offered the branch's levels.
  const options = hq
    ? HQ_ROLE_OPTIONS
    : PARTNER_ROLE_OPTIONS.filter((r) => (subAgent ? r !== "COUNSELLOR" && r !== "SENIOR_COUNSELLOR" && r !== "TRAINEE_COUNSELLOR" : r !== "SUB_AGENT_COUNSELLOR"));
  const [role, setRole] = useState<string>(hq ? (canCreateStaff ? "ADMIN" : "MANAGEMENT") : subAgent ? "SUB_AGENT_COUNSELLOR" : "COUNSELLOR");
  const locked = (value: string) =>
    (!canCreateStaff && value !== "MANAGEMENT" && hq) || (value === "SUPER_ADMIN" && !canCreateSuperAdmin);

  return (
    <ActionForm action={addUserAction} submitLabel="Add user" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" name="name" required />
        <TextField label="Email" name="email" type="email" required />
        <SelectField label="Role" name="role" aria-label="Role for the new account" value={role} onChange={(e) => setRole(e.target.value)}>
          {options.map((value) => (
            <option key={value} value={value} disabled={locked(value)}>
              {roleLabel[value]}
              {locked(value) ? " (super admin only)" : ""}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Job title"
          name="deskLabel"
          aria-label="Job title for the new account"
          placeholder={TITLE_SUGGESTIONS[role] ?? "Optional"}
          hint="Free text, shown beside their name"
        />
        <DepartmentSelect id={`dept-new-${orgId}`} departments={departments} value={null} />
      </div>
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm leading-relaxed text-muted">{roleBlurb[role]}</p>
      {hq && !canCreateStaff && (
        <p className="text-xs text-muted">Only a super admin or an ops manager can create Medcity Overseas accounts.</p>
      )}
    </ActionForm>
  );
}

export function RoleForm({
  userId,
  role,
  hq,
  subAgent,
  roleLabel,
  canSetSuperAdmin,
}: {
  userId: string;
  role: string;
  hq: boolean;
  subAgent?: boolean;
  roleLabel: Record<string, string>;
  canSetSuperAdmin: boolean;
}) {
  // A sub-agent's own counsellor only makes sense inside a sub-agent firm, so a
  // branch is not offered it and a firm is not offered the branch's levels.
  const options = hq
    ? HQ_ROLE_OPTIONS
    : PARTNER_ROLE_OPTIONS.filter((r) => (subAgent ? r !== "COUNSELLOR" && r !== "SENIOR_COUNSELLOR" && r !== "TRAINEE_COUNSELLOR" : r !== "SUB_AGENT_COUNSELLOR"));
  return (
    <ActionForm action={changeRoleAction} hideSubmit className="space-y-1.5">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-1.5">
        <label htmlFor={`role-${userId}`} className="sr-only">Change role</label>
        <Select id={`role-${userId}`} name="role" aria-label="Change role" defaultValue={role} className="w-44 py-1.5 text-sm">
          {options.map((value) => (
            <option key={value} value={value} disabled={value === "SUPER_ADMIN" && !canSetSuperAdmin}>
              {roleLabel[value]}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="quiet" size="sm">Set role</Button>
      </div>
    </ActionForm>
  );
}

/** A person's name, sign-in email, job title and department, edited in place. */
export function EditPersonForm({
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
    <ActionForm action={editUserAction} submitLabel="Save details" submitVariant="secondary">
      <input type="hidden" name="userId" value={userId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`name-${userId}`} label="Name" name="name" defaultValue={name} required />
        <TextField id={`email-${userId}`} label="Sign-in email" name="email" type="email" defaultValue={email} required hint="Changing it signs them out; they sign in again with the new address" />
        <TextField id={`title-${userId}`} label="Job title" name="deskLabel" defaultValue={deskLabel ?? ""} placeholder="Job title" />
        <DepartmentSelect id={`dept-${userId}`} departments={departments} value={department} />
      </div>
    </ActionForm>
  );
}

export type MoveTarget = { id: string; name: string; type: "HQ" | "BRANCH" | "SUB_AGENT" };
export type Colleague = { id: string; name: string; deskLabel: string | null };

/**
 * Moving somebody to another branch. The students assigned to them stay at
 * the old branch, so the form says how many there are and makes the desk
 * choose what happens to them before anything moves.
 */
export function MovePersonForm({
  userId,
  name,
  orgName,
  students,
  targets,
  colleagues,
}: {
  userId: string;
  name: string;
  orgName: string;
  /** Students assigned to them at the branch they are leaving. */
  students: number;
  /** Organisations their role fits, other than the one they are at. */
  targets: MoveTarget[];
  /** People at the old branch who could take the students. */
  colleagues: Colleague[];
}) {
  const [choice, setChoice] = useState<"hand" | "leave">(colleagues.length ? "hand" : "leave");
  if (targets.length === 0) {
    return <p className="text-sm text-muted">There is no other organisation their role fits. Change their role first.</p>;
  }
  return (
    <ActionForm action={moveUserAction} submitLabel={`Move ${name}`} pendingLabel="Moving…" submitVariant="secondary">
      <input type="hidden" name="userId" value={userId} />
      <SelectField id={`move-to-${userId}`} label="Move to" name="toOrgId" aria-label="Move to">
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.type === "SUB_AGENT" ? " (sub-agent)" : ""}
          </option>
        ))}
      </SelectField>
      {students > 0 ? (
        <fieldset className="space-y-2 rounded-lg border border-line p-3" data-move-students={students}>
          <legend className="px-1 text-sm font-medium">
            {students} {students === 1 ? "student is" : "students are"} assigned to {name} at {orgName}
          </legend>
          <p className="text-xs text-muted">Students stay at {orgName}. A student never moves with a person.</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="studentsChoice" value="hand" checked={choice === "hand"} onChange={() => setChoice("hand")} disabled={!colleagues.length} className="mt-1" />
            <span>
              Hand them to a colleague at {orgName}
              {!colleagues.length && <span className="block text-xs text-muted">Nobody else at {orgName} can take them.</span>}
            </span>
          </label>
          {choice === "hand" && colleagues.length > 0 && (
            <div className="pl-6">
              <SelectField id={`hand-to-${userId}`} label="Colleague" name="handToId" aria-label="Hand students to">
                {colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.deskLabel ? ` (${c.deskLabel})` : ""}
                  </option>
                ))}
              </SelectField>
            </div>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="studentsChoice" value="leave" checked={choice === "leave"} onChange={() => setChoice("leave")} className="mt-1" />
            <span>Leave them unassigned at {orgName}, for somebody there to pick up</span>
          </label>
        </fieldset>
      ) : (
        <p className="text-xs text-muted">No students are assigned to {name} at {orgName}.</p>
      )}
      <p className="text-xs text-muted">
        {name} is taken off every file at {orgName} they are named on, signed out, and told. Their role stays the same.
      </p>
    </ActionForm>
  );
}

export function ResetPasswordForm({ userId, email }: { userId: string; email: string }) {
  return (
    <ActionForm action={resetPasswordAction} hideSubmit className="space-y-1.5">
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" variant="quiet" size="sm" title={`Issue a one-time password for ${email}`}>
        Reset password
      </Button>
    </ActionForm>
  );
}
