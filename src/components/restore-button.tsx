"use client";

import { useActionState, useEffect, useState, type FormEvent } from "react";
import type { FormState } from "@/lib/form-state";
import { restoreCatalogueChangeAction } from "@/server/catalogue-history-actions";
import { Button } from "./ui";
import { toast } from "./toast";

/**
 * Puts back one field, or one whole save, from a change history card. The
 * answer is a toast when it worked; a refusal, or a restore that had to leave
 * some fields alone, stays beside the button, because it says what has to
 * change first and a toast would be gone before it is read.
 *
 * A restore starts the edit form on the page afresh, so it is refused while
 * that form holds changes nobody has saved (ActionForm marks it data-unsaved).
 */
export function RestoreButton({
  changeId,
  batchId,
  entity,
  entityId,
  label = "Restore",
  title,
}: {
  changeId?: string;
  batchId?: string;
  entity: "program" | "university";
  entityId: string;
  label?: string;
  title?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(restoreCatalogueChangeAction, {});
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (state.ok && !state.keep) toast(state.ok);
  }, [state]);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    const unsaved = document.querySelector("form[data-unsaved]") != null;
    setBlocked(unsaved);
    // Stopping the submit event stops the form action as well.
    if (unsaved) e.preventDefault();
  }
  const message = blocked ? "Save or undo your changes first" : state.error;
  return (
    <form action={action} onSubmit={onSubmit} className="shrink-0 text-right">
      {changeId && <input type="hidden" name="changeId" value={changeId} />}
      {batchId && <input type="hidden" name="batchId" value={batchId} />}
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="entityId" value={entityId} />
      <Button type="submit" variant="quiet" size="sm" disabled={pending} title={title} aria-label={title}>
        {pending ? "Restoring…" : label}
      </Button>
      {message ? (
        <p role="alert" className="max-w-56 text-left text-xs text-stop-500">
          {message}
        </p>
      ) : (
        state.ok &&
        state.keep && (
          <p role="status" className="max-w-56 text-left text-xs text-ink">
            {state.ok}
          </p>
        )
      )}
    </form>
  );
}
