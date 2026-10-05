"use client";

import { ActionForm } from "@/components/action-form";
import { Checkbox, Field, Input } from "@/components/ui";
import { buildPackAction } from "@/server/documentation-actions";
import { STATE_LABEL } from "@/lib/journey";
import type { ChecklistState } from "@/db/schema";

export type PackCandidate = { itemId: string; label: string; state: string; fileName: string | null; bytes: number | null };

const mb = (bytes: number | null) => (bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : "size not recorded");

export function PackForm({ applicationId, disabled, candidates }: { applicationId: string; disabled: boolean; candidates: PackCandidate[] }) {
  return (
    <ActionForm action={buildPackAction} submitLabel="Build and download" pendingLabel="Packing…">
      <input type="hidden" name="applicationId" value={applicationId} />
      {candidates.length > 0 && (
        <fieldset className="rounded-lg border border-line bg-surface-2/40 p-3">
          <legend className="px-1 text-[13px] font-medium text-brand-700">Send something the desk has not accepted</legend>
          <p className="mb-2 text-xs text-muted">
            These stay out unless you say otherwise. Tick one only when the vendor has asked for it as it stands: the front sheet marks it as not
            checked, so nobody at the other end reads it as accepted.
          </p>
          <div className="space-y-1.5">
            {candidates.map((c) => (
              <Checkbox
                key={c.itemId}
                name="include"
                value={c.itemId}
                label={`${c.label} · ${STATE_LABEL[c.state as ChecklistState] ?? c.state} · ${mb(c.bytes)}`}
              />
            ))}
          </div>
        </fieldset>
      )}
      <Field label="A note for the record" htmlFor="pack-note" hint="Why it went now, or what was agreed about anything missing. Kept on the file, not in the folder.">
        <Input id="pack-note" name="note" disabled={disabled} placeholder="Sent to KC with the bank statement to follow" />
      </Field>
    </ActionForm>
  );
}
