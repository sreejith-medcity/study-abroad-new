"use client";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { addCounsellorAction, resetCounsellorPasswordAction, setDeskLabelAction } from "@/server/team";

export function AddCounsellorForm() {
  return (
    <ActionForm action={addCounsellorAction} submitLabel="Add counsellor" pendingLabel="Adding…" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id="tm-name" label="Name" name="name" required />
        <TextField id="tm-email" label="Email" name="email" type="email" required hint="They sign in with this" />
        <TextField id="tm-phone" label="Phone" name="phone" />
        <TextField id="tm-desk" label="Desk" name="deskLabel" placeholder="UK desk, Germany desk" />
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

export function DeskLabelForm({ userId, label }: { userId: string; label: string | null }) {
  return (
    <ActionForm action={setDeskLabelAction} submitLabel="Save desk" submitVariant="secondary">
      <input type="hidden" name="userId" value={userId} />
      <TextField id={`desk-${userId}`} label="Desk" name="deskLabel" defaultValue={label ?? ""} />
    </ActionForm>
  );
}
