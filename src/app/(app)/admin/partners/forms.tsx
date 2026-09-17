"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField } from "@/components/fields";
import { addUserAction, invitePartnerAction } from "./actions";

export function InvitePartnerForm() {
  return (
    <ActionForm action={invitePartnerAction} submitLabel="Create partner" resetOnSuccess>
      <TextField label="Organisation name" name="orgName" required />
      <div className="grid grid-cols-2 gap-3">
        <SelectField label="Type" name="type" defaultValue="SUB_AGENT"><option value="BRANCH">Medcity branch</option><option value="SUB_AGENT">Sub-agent</option></SelectField>
        <SelectField label="Tier" name="tier" defaultValue="SILVER"><option>SILVER</option><option>GOLD</option><option>ELITE</option><option>PLATINUM</option></SelectField>
      </div>
      <TextField label="City" name="city" />
      <TextField label="Owner name" name="ownerName" required />
      <TextField label="Owner email" name="ownerEmail" type="email" required />
      <TextField label="Owner phone" name="ownerPhone" />
    </ActionForm>
  );
}

export function AddUserForm({ orgId, hq }: { orgId: string; hq: boolean }) {
  return (
    <ActionForm action={addUserAction} submitLabel="Add user" resetOnSuccess submitVariant="secondary">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <TextField label="Name" name="name" required />
        <TextField label="Email" name="email" type="email" required />
        <TextField label="Desk label" name="deskLabel" placeholder={hq ? "UK Desk" : "UK Documentation"} />
        <SelectField label="Role" name="role" defaultValue={hq ? "ADMIN" : "COUNSELLOR"}>
          {hq ? <><option value="ADMIN">Admin</option><option value="MANAGEMENT">Management</option></> : <><option value="COUNSELLOR">Counsellor</option><option value="PARTNER">Partner owner</option></>}
        </SelectField>
      </div>
    </ActionForm>
  );
}
