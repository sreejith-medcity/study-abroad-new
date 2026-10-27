"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Select } from "@/components/ui";
import { reassignItemAction } from "@/server/documentation-actions";

export type Officer = { id: string; name: string; deskLabel: string | null };

/**
 * Moving one document to another officer, or back to the pool. On a document
 * nobody holds it gives it to an officer, which is how the team leader hands
 * out the pool now that an officer works only their own files.
 *
 * Opened rather than always shown: a select on every row of a long queue reads
 * as a thing to do, and moving somebody's work is not a thing to do often.
 */
export function Reassign({ itemId, holder, officers }: { itemId: string; holder: string | null; officers: Officer[] }) {
  const [open, setOpen] = useState(false);
  const verb = holder ? "Move it" : "Give it to somebody";
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="ml-1 text-xs font-medium text-brand-600 hover:underline">
        {verb}
      </button>
    );
  return (
    <div className="mt-1">
      <ActionForm action={reassignItemAction} submitLabel={verb} pendingLabel="Saving…" submitVariant="secondary">
        <input type="hidden" name="itemId" value={itemId} />
        <Select name="toId" aria-label="Move this document to" defaultValue="">
          <option value="">{holder ? "Back in the pool" : "Nobody yet"}</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.deskLabel ?? o.name}
            </option>
          ))}
        </Select>
        {holder && <p className="text-xs text-muted">Held by {holder}. The move is recorded with both names.</p>}
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
          Cancel
        </button>
      </ActionForm>
    </div>
  );
}
