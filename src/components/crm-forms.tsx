"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Checkbox, Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { CHANNEL_LABEL, OUTCOME_LABEL, suggestedFollowUp, TASK_KIND_LABEL } from "@/lib/crm";
import { finishTaskAction, logContactAction, pushTaskAction, reopenTaskAction, saveTaskAction } from "@/server/task-actions";
import type { ContactChannel, ContactOutcome, TaskKind } from "@/db/schema";

export type Person = { id: string; name: string; deskLabel: string | null; role: string };

const KINDS = Object.keys(TASK_KIND_LABEL) as TaskKind[];
const CHANNELS = Object.keys(CHANNEL_LABEL) as ContactChannel[];
const OUTCOMES = Object.keys(OUTCOME_LABEL) as ContactOutcome[];
const label = (p: Person) => `${p.deskLabel ?? p.name}`;

/** A task somebody puts on a desk. */
export function TaskForm({
  people,
  defaultAssignee,
  studentId,
  applicationId,
  compact,
  onDone,
  task,
}: {
  people: Person[];
  defaultAssignee: string;
  studentId?: string;
  applicationId?: string;
  compact?: boolean;
  onDone?: () => void;
  task?: { id: string; title: string; detail: string | null; dueOn: string; kind: TaskKind; assignedToId: string };
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={saveTaskAction} submitLabel={task ? "Save" : "Add the task"} resetOnSuccess={!task} className={compact ? "space-y-2" : undefined}>
      {task && <input type="hidden" name="taskId" value={task.id} />}
      {studentId && <input type="hidden" name="studentId" value={studentId} />}
      {applicationId && <input type="hidden" name="applicationId" value={applicationId} />}
      <Field label="What has to be done" htmlFor={`t-title-${task?.id ?? "new"}`} required>
        <Input id={`t-title-${task?.id ?? "new"}`} name="title" defaultValue={task?.title ?? ""} placeholder="Call about the bank statement" />
        <FieldError name="title" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Due" htmlFor={`t-due-${task?.id ?? "new"}`} required>
          <Input id={`t-due-${task?.id ?? "new"}`} type="date" name="dueOn" defaultValue={task?.dueOn ?? today} />
          <FieldError name="dueOn" />
        </Field>
        <Field label="About" htmlFor={`t-kind-${task?.id ?? "new"}`}>
          <Select id={`t-kind-${task?.id ?? "new"}`} name="kind" defaultValue={task?.kind ?? "FOLLOW_UP"}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{TASK_KIND_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
        <Field label="For" htmlFor={`t-who-${task?.id ?? "new"}`} required>
          <Select id={`t-who-${task?.id ?? "new"}`} name="assignedToId" defaultValue={task?.assignedToId ?? defaultAssignee}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{label(p)}</option>
            ))}
          </Select>
          <FieldError name="assignedToId" />
        </Field>
      </div>
      {!compact && (
        <Field label="Anything more" htmlFor={`t-detail-${task?.id ?? "new"}`}>
          <Textarea id={`t-detail-${task?.id ?? "new"}`} name="detail" rows={2} defaultValue={task?.detail ?? ""} />
        </Field>
      )}
      {onDone && (
        <button type="button" onClick={onDone} className="text-[13px] text-muted hover:text-ink">Close</button>
      )}
    </ActionForm>
  );
}

/** Tick it off, push it out, or put it back. */
export function TaskRowActions({ task, done }: { task: { id: string }; done: boolean }) {
  const [open, setOpen] = useState(false);
  if (done) {
    return (
      <form action={reopenTaskAction} className="inline">
        <input type="hidden" name="taskId" value={task.id} />
        <button type="submit" className="text-[13px] text-muted hover:text-ink">Put it back</button>
      </form>
    );
  }
  return (
    <span className="flex flex-wrap items-center justify-end gap-3 whitespace-nowrap">
      <form action={finishTaskAction} className="inline">
        <input type="hidden" name="taskId" value={task.id} />
        <button type="submit" className="text-[13px] font-medium text-brand-600 hover:underline">Done</button>
      </form>
      <form action={pushTaskAction} className="inline">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="days" value="1" />
        <button type="submit" className="text-[13px] text-muted hover:text-ink">Tomorrow</button>
      </form>
      <form action={pushTaskAction} className="inline">
        <input type="hidden" name="taskId" value={task.id} />
        <input type="hidden" name="days" value="7" />
        <button type="submit" className="text-[13px] text-muted hover:text-ink">Next week</button>
      </form>
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-muted hover:text-ink">Note</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Finish it with a note" description="The note is for whoever reads the file next.">
        <form action={finishTaskAction} className="space-y-3">
          <input type="hidden" name="taskId" value={task.id} />
          <Field label="What happened" htmlFor={`done-${task.id}`}>
            <Input id={`done-${task.id}`} name="doneNote" />
          </Field>
          <button type="submit" className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">Done</button>
        </form>
      </Modal>
    </span>
  );
}

/**
 * A conversation, in two clicks. The outcome suggests when to look again, which
 * the counsellor can change: they know whether this family needs two days or
 * two weeks.
 */
export function LogContact({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<ContactOutcome>("REACHED");
  const [next, setNext] = useState<string>(() => suggestedFollowUp("REACHED") ?? "");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink">
        Log a call
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Log a conversation with ${studentName}`} description="Two clicks. The next action goes on somebody's desk by itself." className="max-w-xl">
        <ActionForm action={logContactAction} submitLabel="Log it" resetOnSuccess>
          <input type="hidden" name="studentId" value={studentId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How" htmlFor={`c-ch-${studentId}`}>
              <Select id={`c-ch-${studentId}`} name="channel" defaultValue="CALL">
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
                ))}
              </Select>
            </Field>
            <Field label="What came of it" htmlFor={`c-out-${studentId}`} required>
              <Select
                id={`c-out-${studentId}`}
                name="outcome"
                value={outcome}
                onChange={(e) => {
                  const o = e.target.value as ContactOutcome;
                  setOutcome(o);
                  setNext(suggestedFollowUp(o) ?? "");
                }}
              >
                {OUTCOMES.map((o) => (
                  <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                ))}
              </Select>
              <FieldError name="outcome" />
            </Field>
          </div>
          <Checkbox name="inbound" label="They called us" />
          <Field label="Anything worth keeping" htmlFor={`c-note-${studentId}`}>
            <Textarea id={`c-note-${studentId}`} name="note" rows={2} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Look again on" htmlFor={`c-next-${studentId}`} hint={next ? "Suggested from what came of it." : "Nothing is suggested for this one."}>
              <Input id={`c-next-${studentId}`} type="date" name="nextActionOn" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="And do what" htmlFor={`c-nn-${studentId}`} hint="Becomes the task's own title.">
              <Input id={`c-nn-${studentId}`} name="nextActionNote" placeholder="Chase the bank statement" />
            </Field>
          </div>
          {!next && <Chip tone="warn">No follow-up will be raised</Chip>}
        </ActionForm>
      </Modal>
    </>
  );
}

/** The task form, folded away until somebody wants it. */
export function AddTask({ people, defaultAssignee, studentId, applicationId }: { people: Person[]; defaultAssignee: string; studentId?: string; applicationId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">
        Add a task
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a task" description="On a day, for a person. It shows up on their My day until it is done." className="max-w-xl">
        <TaskForm people={people} defaultAssignee={defaultAssignee} studentId={studentId} applicationId={applicationId} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
