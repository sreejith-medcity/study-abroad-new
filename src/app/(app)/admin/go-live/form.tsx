"use client";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { clearDemoDataAction } from "./actions";

export function ClearForm({ total }: { total: number }) {
  // The form stays mounted once there is nothing left, because it is holding the
  // only account of what just happened. Replacing it would throw that away.
  return (
    <ActionForm
      action={clearDemoDataAction}
      submitLabel="Remove the sample data"
      pendingLabel="Removing…"
      hideSubmit={total === 0}
    >
      {total === 0 ? (
        <p className="text-[13px] text-muted">There is no sample data left to remove.</p>
      ) : (
        <TextField
          label="Type REMOVE to confirm"
          name="confirm"
          autoComplete="off"
          placeholder="REMOVE"
          hint="There is no undo. Everything listed above goes in one step."
        />
      )}
    </ActionForm>
  );
}
