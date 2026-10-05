"use client";

import { useActionState } from "react";
import { cn } from "@/components/ui";
import { setCapabilityAction } from "./actions";

/**
 * One box in the table.
 *
 * A tick, not a sentence. Seven columns of "Allowed" and "Not allowed" made
 * every row four lines tall and the table unreadable, which is the opposite of
 * what a matrix is for: you should be able to see the shape of it at a glance.
 */
export function CapabilityToggle({
  role,
  capability,
  allowed,
  moved,
  note,
}: {
  role: string;
  capability: string;
  allowed: boolean;
  moved: boolean;
  note?: string;
}) {
  const [state, submit, pending] = useActionState(setCapabilityAction, {});

  return (
    <form action={submit} className="inline-flex">
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="capability" value={capability} />
      <input type="hidden" name="allowed" value={allowed ? "0" : "1"} />
      <button
        type="submit"
        disabled={pending}
        title={`${allowed ? "Allowed" : "Not allowed"}${moved ? `. Changed${note ? ` by ${note}` : ""}` : ""}. Click to change.`}
        aria-label={`${allowed ? "Allowed" : "Not allowed"}: ${capability} for ${role}`}
        aria-pressed={allowed}
        className={cn(
          "relative grid size-7 place-items-center rounded-md ring-1 ring-inset transition disabled:opacity-50",
          allowed ? "bg-good-50 text-good-700 ring-good-500/30 hover:bg-good-100" : "bg-surface-2 text-muted ring-line hover:text-ink",
        )}
      >
        {allowed ? "✓" : "–"}
        {/* A dot, because a column of asterisks is easier to scan than a column
            of dates, and the date is a hover away. */}
        {moved && <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-brand-600" aria-hidden="true" />}
      </button>
      {state.error && <span className="sr-only">{state.error}</span>}
    </form>
  );
}
