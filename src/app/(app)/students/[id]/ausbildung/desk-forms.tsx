"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Field, Select, Textarea } from "@/components/ui";
import { handOverToDeskAction, setMentorAction } from "@/server/ausbildung-actions";

/**
 * The branch's one button at the end of document collection: hand the file to
 * the documentation desk. Shown as the reason instead while the paper is not
 * in, so what is missing is read off the screen rather than found by trying.
 */
export function HandToDesk({ studentId, ready, why }: { studentId: string; ready: boolean; why: string | null }) {
  const [open, setOpen] = useState(false);
  if (!ready) {
    return (
      <p className="text-sm text-warn-700" data-handover-blocked>
        {why}
      </p>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white" data-hand-to-desk>
        Hand to the documentation desk
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Hand to the documentation desk"
        description="The desk names a mentor, who prepares and translates the documents and carries the file from here. You and the branch head are told who it is."
      >
        <ActionForm action={handOverToDeskAction} submitLabel="Hand it over" pendingLabel="Handing over…">
          <input type="hidden" name="studentId" value={studentId} />
          <Field label="Anything the desk should know" htmlFor={`hand-note-${studentId}`} hint="The German level the student is at, a field they have their heart set on, anything odd about the file. Optional.">
            <Textarea id={`hand-note-${studentId}`} name="note" rows={3} />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

export type MentorChoice = { id: string; name: string; deskLabel: string | null };

/** The desk names the mentor, or changes who it is. One select and one button. */
export function MentorForm({ studentId, current, officers }: { studentId: string; current: string | null; officers: MentorChoice[] }) {
  if (officers.length === 0) {
    return <p className="text-sm text-muted">No documentation officer has an active account, so there is nobody to name as mentor.</p>;
  }
  return (
    <ActionForm action={setMentorAction} submitLabel={current ? "Change the mentor" : "Set the mentor"} pendingLabel="Saving…" submitVariant="secondary" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      <Field label="Mentor" htmlFor={`mentor-${studentId}`}>
        <Select id={`mentor-${studentId}`} name="mentorId" defaultValue={current ?? ""} className="w-64">
          <option value="">Pick a documentation officer</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.deskLabel ? ` (${o.deskLabel})` : ""}
            </option>
          ))}
        </Select>
        <FieldError name="mentorId" />
      </Field>
    </ActionForm>
  );
}
