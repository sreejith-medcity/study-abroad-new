"use client";

import { useState } from "react";
import { ActionForm, type FormState } from "@/components/action-form";
import { Select } from "@/components/ui";

export type MoveBranchOption = {
  id: string;
  name: string;
  type: "BRANCH" | "SUB_AGENT";
  hasHead: boolean;
  people: { id: string; name: string; deskLabel: string | null }[];
};

/**
 * Moving a student, or a whole branch's students, to another branch. The
 * counsellor list follows the branch picked, because the counsellor has to
 * work where the student is going.
 */
export function StudentMoveForm({
  action,
  hidden,
  branches,
  keeps,
  submitLabel,
  what,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  branches: MoveBranchOption[];
  /** What stays as it was, said before anything is moved. */
  keeps: string;
  submitLabel: string;
  /** "this student" or "these students", for the sentences. */
  what: string;
}) {
  const [toId, setToId] = useState("");
  const [choice, setChoice] = useState("");
  const to = branches.find((b) => b.id === toId);
  const formId = Object.values(hidden).join("-");
  if (!branches.length) return <p className="text-sm text-muted">There is no other open branch to move {what} to.</p>;
  return (
    <ActionForm action={action} submitLabel={submitLabel} pendingLabel="Moving…" submitVariant="secondary" className="space-y-3">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="block text-2xs font-semibold uppercase tracking-wider text-muted" htmlFor={`move-to-${formId}`}>
        Branch they are going to
        <Select id={`move-to-${formId}`} name="toOrgId" value={toId} onChange={(e) => setToId(e.target.value)} className="mt-1 block w-64 py-1.5 text-sm normal-case tracking-normal">
          <option value="" disabled>Pick a branch</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
              {b.type === "SUB_AGENT" ? " (sub-agent)" : ""}
            </option>
          ))}
        </Select>
      </label>
      <fieldset className="space-y-1.5 text-sm">
        <legend className="text-2xs font-semibold uppercase tracking-wider text-muted">Counsellor there</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="choice" value="assign" checked={choice === "assign"} onChange={() => setChoice("assign")} className="accent-brand-600" />
          Give {what} to
          <Select
            name="counsellorId"
            defaultValue=""
            key={toId}
            disabled={choice !== "assign" || !to}
            aria-label="Counsellor at the new branch"
            className="w-56 py-1 text-sm"
          >
            <option value="" disabled>{to ? (to.people.length ? "Pick somebody" : "Nobody there can take students") : "Pick the branch first"}</option>
            {to?.people.map((p) => (
              <option key={p.id} value={p.id}>{p.deskLabel ?? p.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="choice" value="leave" checked={choice === "leave"} onChange={() => setChoice("leave")} className="accent-brand-600" />
          Leave unassigned for the branch head to hand out
        </label>
        {to && !to.hasHead && choice === "leave" && <p className="text-xs text-warn-700">{to.name} has no active branch head, so pick a counsellor there.</p>}
        <p className="text-2xs text-muted">A counsellor at the head office stays on when the students are left unassigned, because they can open the file at any branch.</p>
      </fieldset>
      <p className="text-xs text-muted">
        Applications, enquiries and open tasks go with {what}; documents and history stay on the file. People from the old branch are taken off the file,
        because they can no longer open it. {keeps}
      </p>
    </ActionForm>
  );
}
