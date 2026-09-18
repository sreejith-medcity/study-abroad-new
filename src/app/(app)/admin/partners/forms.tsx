"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { Button, Input, Select } from "@/components/ui";
import { addUserAction, changeRoleAction, invitePartnerAction, resetPasswordAction, setTitleAction } from "./actions";

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

/** Which roles may be handed out where, with a line each on what they mean. */
export const HQ_ROLE_OPTIONS = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "MANAGEMENT"] as const;
export const PARTNER_ROLE_OPTIONS = ["PARTNER", "COUNSELLOR"] as const;

const TITLE_SUGGESTIONS: Record<string, string> = {
  SUPER_ADMIN: "Platform owner",
  OPS_MANAGER: "Operations",
  ADMIN: "UK desk",
  DOCUMENTATION: "Documentation",
  MANAGEMENT: "Management",
  PARTNER: "Branch head",
  COUNSELLOR: "Ausbildung counsellor",
};

export function AddUserForm({
  orgId,
  hq,
  canCreateStaff,
  canCreateSuperAdmin,
  roleLabel,
  roleBlurb,
}: {
  orgId: string;
  hq: boolean;
  canCreateStaff: boolean;
  canCreateSuperAdmin: boolean;
  roleLabel: Record<string, string>;
  roleBlurb: Record<string, string>;
}) {
  const options = hq ? HQ_ROLE_OPTIONS : PARTNER_ROLE_OPTIONS;
  const [role, setRole] = useState<string>(hq ? (canCreateStaff ? "ADMIN" : "MANAGEMENT") : "COUNSELLOR");
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
      </div>
      <p className="rounded-lg bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-muted">{roleBlurb[role]}</p>
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
  roleLabel,
  canSetSuperAdmin,
}: {
  userId: string;
  role: string;
  hq: boolean;
  roleLabel: Record<string, string>;
  canSetSuperAdmin: boolean;
}) {
  const options = hq ? HQ_ROLE_OPTIONS : PARTNER_ROLE_OPTIONS;
  return (
    <ActionForm action={changeRoleAction} hideSubmit className="space-y-1.5">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-1.5">
        <label htmlFor={`role-${userId}`} className="sr-only">Change role</label>
        <Select id={`role-${userId}`} name="role" aria-label="Change role" defaultValue={role} className="w-44 py-1.5 text-[13px]">
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

/** The free-text job title beside someone's name, edited in place. */
export function TitleForm({ userId, title }: { userId: string; title: string | null }) {
  return (
    <ActionForm action={setTitleAction} hideSubmit className="space-y-1.5">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-1.5">
        <label htmlFor={`title-${userId}`} className="sr-only">Job title</label>
        <Input
          id={`title-${userId}`}
          name="deskLabel"
          defaultValue={title ?? ""}
          placeholder="Job title"
          aria-label="Job title"
          className="w-40 py-1.5 text-[13px]"
        />
        <Button type="submit" variant="quiet" size="sm">Save title</Button>
      </div>
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
