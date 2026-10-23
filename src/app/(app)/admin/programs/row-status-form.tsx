"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Select } from "@/components/ui";
import { refusalText } from "@/lib/publish-rules";
import { setProgramStatusAction, type RowStatusState } from "./actions";

/**
 * One row's status control on the Programs list. When setting a course live
 * is refused, the reason stays beside the row with a link to the course, and
 * React resets the select to the status the course still has.
 */
export function RowStatusForm({ programId, name, status }: { programId: string; name: string; status: string }) {
  const [state, action, pending] = useActionState<RowStatusState, FormData>(setProgramStatusAction, {});
  const refused = state.problems?.length ? state.problems : null;
  return (
    <div className="space-y-1">
      <form action={action} className="flex gap-1">
        <input type="hidden" name="programId" value={programId} />
        <Select name="status" defaultValue={status} aria-label={`Status of ${name}`} className="w-28 py-1 text-xs">
          <option>LIVE</option><option>DRAFT</option><option>ARCHIVED</option>
        </Select>
        <Button variant="quiet" className="px-2 py-1 text-xs" disabled={pending}>Set</Button>
      </form>
      {refused && (
        <p role="alert" className="max-w-56 text-xs text-stop-700" data-status-refused={refused.join(" ")} data-answer={state.at}>
          {refusalText(refused)}{" "}
          <Link prefetch={false} href={`/admin/programs/${programId}`} className="font-medium underline">Open the course to add what is missing</Link>
        </p>
      )}
      {state.error && (
        <p role="alert" className="max-w-56 text-xs text-stop-700" data-status-error data-answer={state.at}>
          {state.error}
        </p>
      )}
    </div>
  );
}
