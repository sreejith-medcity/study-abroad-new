"use client";

import { ActionForm } from "@/components/action-form";
import { runJobNowAction } from "./actions";

/** One button per job. The outcome arrives as a toast and the table refreshes behind it. */
export function RunNow({ job }: { job: string }) {
  return (
    <div data-run-now={job}>
      <ActionForm action={runJobNowAction} submitLabel="Run now" pendingLabel="Running…" submitVariant="secondary" className="space-y-2">
        <input type="hidden" name="job" value={job} />
      </ActionForm>
    </div>
  );
}
