"use client";

import { removeInvoiceLineAction } from "@/server/invoice-actions";

/** Takes one student off an invoice that has not gone out yet. */
export function RemoveLine({ lineId }: { lineId: string }) {
  return (
    <form action={removeInvoiceLineAction} className="inline">
      <input type="hidden" name="lineId" value={lineId} />
      <button type="submit" className="text-[13px] text-muted hover:text-ink">Take it off</button>
    </form>
  );
}
