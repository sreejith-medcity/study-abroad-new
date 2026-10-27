"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import { CALL_OUTCOMES, CALL_OUTCOME_LABEL, type CallOutcome } from "@/lib/calling";

const variantFor = (o: CallOutcome) => (o === "INTERESTED" ? "primary" : o === "WRONG_NUMBER" || o === "ENROLLED_ELSEWHERE" || o === "NOT_INTERESTED" ? "quiet" : "secondary");

/**
 * The seven outcome buttons. While one press is being saved every button is
 * held, so a second tap cannot send the same call again; the server refuses a
 * repeat as well, for a second tab.
 */
export function OutcomeButtons() {
  const { pending, data } = useFormStatus();
  const sent = pending ? data?.get("outcome") : null;
  return (
    <div className="flex flex-wrap gap-2" aria-busy={pending || undefined}>
      {CALL_OUTCOMES.map((o) => (
        <Button key={o} type="submit" name="outcome" value={o} variant={variantFor(o)} size="sm" disabled={pending} data-outcome={o}>
          {sent === o ? "Saving…" : CALL_OUTCOME_LABEL[o]}
        </Button>
      ))}
    </div>
  );
}
