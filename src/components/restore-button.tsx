"use client";

import { useActionState, useEffect } from "react";
import type { FormState } from "@/lib/form-state";
import { restoreCatalogueChangeAction } from "@/server/catalogue-history-actions";
import { Button } from "./ui";
import { toast } from "./toast";

/**
 * Puts back one field, or one whole save, from a change history card. The
 * answer is a toast when it worked; a refusal stays beside the button, because
 * it says what has to change first and a toast would be gone before it is read.
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
  useEffect(() => {
    if (state.ok) toast(state.ok);
  }, [state]);
  return (
    <form action={action} className="shrink-0 text-right">
      {changeId && <input type="hidden" name="changeId" value={changeId} />}
      {batchId && <input type="hidden" name="batchId" value={batchId} />}
      <input type="hidden" name="entity" value={entity} />
      <input type="hidden" name="entityId" value={entityId} />
      <Button type="submit" variant="quiet" size="sm" disabled={pending} title={title} aria-label={title}>
        {pending ? "Restoring…" : label}
      </Button>
      {state.error && (
        <p role="alert" className="max-w-56 text-left text-xs text-stop-500">
          {state.error}
        </p>
      )}
    </form>
  );
}
