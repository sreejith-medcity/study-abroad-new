"use client";

import { useState, type ReactNode } from "react";
import { Td } from "@/components/ui";

/**
 * One student in the queue: their row, and the rows for their waiting
 * documents, shown when the row is opened.
 *
 * The cells are drawn on the server and handed in, so the document rows keep
 * the same Check, Reassign and claim controls the queue always had. Only the
 * opening and closing happens here.
 */
export function StudentRows({
  studentId,
  studentName,
  count,
  summary,
  documents,
  defaultOpen = false,
}: {
  studentId: string;
  studentName: string;
  /** How many documents are under the row, for the button's words. */
  count: number;
  /** The student row's cells, without the last one that holds the button. */
  summary: ReactNode;
  /** One <tr> per waiting document. */
  documents: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <tbody data-student={studentId} data-open={open ? "true" : "false"}>
      <tr className={open ? "bg-surface-2/60" : undefined}>
        {summary}
        <Td className="text-right">
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} the ${count === 1 ? "document" : `${count} documents`} waiting for ${studentName}`}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-brand-600 hover:underline"
          >
            <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            {open ? "Hide" : "Show"}
          </button>
        </Td>
      </tr>
      {open && documents}
    </tbody>
  );
}
