"use client";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm() {
  return (
    <ActionForm action={changePasswordAction} submitLabel="Set new password" pendingLabel="Saving…">
      <TextField label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
      <TextField label="New password" name="newPassword" type="password" autoComplete="new-password" required hint="At least 12 characters, with upper and lower case and a number" />
      <TextField label="Repeat new password" name="confirmPassword" type="password" autoComplete="new-password" required />
    </ActionForm>
  );
}
