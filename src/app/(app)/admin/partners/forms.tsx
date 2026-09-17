"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { Button, Select } from "@/components/ui";
import { addUserAction, changeRoleAction, invitePartnerAction, resetPasswordAction } from "./actions";

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

export function AddUserForm({ orgId, hq, canCreateStaff }: { orgId: string; hq: boolean; canCreateStaff: boolean }) {
  return (
    <ActionForm action={addUserAction} submitLabel="Add user" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField label="Name" name="name" required />
        <TextField label="Email" name="email" type="email" required />
        <TextField label="Desk label" name="deskLabel" placeholder={hq ? "UK Desk" : "UK Documentation"} />
        <SelectField label="Role" name="role" defaultValue={hq ? "ADMIN" : "COUNSELLOR"}>
          {hq ? (
            <>
              <option value="ADMIN" disabled={!canCreateStaff}>Admin</option>
              <option value="MANAGEMENT">Management (read-only)</option>
              <option value="SUPER_ADMIN" disabled={!canCreateStaff}>Super admin</option>
            </>
          ) : (
            <>
              <option value="COUNSELLOR">Counsellor</option>
              <option value="PARTNER">Partner owner</option>
            </>
          )}
        </SelectField>
      </div>
      {hq && !canCreateStaff && <p className="text-xs text-muted">Only a super admin can create Admin or Super admin accounts.</p>}
    </ActionForm>
  );
}

export function RoleForm({ userId, role, hq }: { userId: string; role: string; hq: boolean }) {
  return (
    <ActionForm action={changeRoleAction} hideSubmit className="space-y-1.5">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-1.5">
        <label htmlFor={`role-${userId}`} className="sr-only">Change role</label>
        <Select id={`role-${userId}`} name="role" aria-label="Change role" defaultValue={role} className="w-40 py-1.5 text-[13px]">
          {hq ? (
            <>
              <option value="SUPER_ADMIN">Super admin</option>
              <option value="ADMIN">Overseas admin</option>
              <option value="MANAGEMENT">Management</option>
            </>
          ) : (
            <>
              <option value="PARTNER">Partner owner</option>
              <option value="COUNSELLOR">Counsellor</option>
            </>
          )}
        </Select>
        <Button type="submit" variant="quiet" size="sm">Set role</Button>
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
