"use client";

import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { buildPackAction } from "@/server/documentation-actions";

export function PackForm({ applicationId, disabled }: { applicationId: string; disabled: boolean }) {
  return (
    <ActionForm action={buildPackAction} submitLabel="Build and download" pendingLabel="Packing…">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Field label="A note for the record" htmlFor="pack-note" hint="Why it went now, or what was agreed about anything missing. Kept on the file, not in the folder.">
        <Input id="pack-note" name="note" disabled={disabled} placeholder="Sent to KC with the bank statement to follow" />
      </Field>
    </ActionForm>
  );
}
