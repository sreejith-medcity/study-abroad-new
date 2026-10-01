"use client";

import { deleteRateCardAction } from "@/server/income-actions";

/** Removes a rate nobody has priced a line from yet. */
export function DeleteRate({ rateCardId }: { rateCardId: string }) {
  return (
    <form action={deleteRateCardAction} className="inline">
      <input type="hidden" name="rateCardId" value={rateCardId} />
      <button type="submit" className="text-[13px] text-muted hover:text-ink">Remove</button>
    </form>
  );
}
