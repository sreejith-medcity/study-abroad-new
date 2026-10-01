"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Chip, Field, Input, Select, Textarea } from "@/components/ui";
import { DESK_STAGE_LABEL, DESK_STAGE_MEANS, OUTCOME_LABEL, OUTCOME_GROUP } from "@/lib/desk";
import {
  chooseRouteAction,
  handOverAction,
  recordSubmissionAction,
  recordVendorUpdateAction,
  returnToBranchAction,
} from "@/server/desk-actions";
import type { DeskStage, VendorOutcome } from "@/db/schema";

export type RouteChoice = { id: string; code: string; name: string; colour: string; commission: string | null; offerIn: string; applicationFee: string; asksFor: string | null; interview: boolean; stale: boolean };
export type StatusChoice = { id: string; label: string; group: string; requiresReason: boolean };

const OUTCOMES = Object.keys(OUTCOME_LABEL) as VendorOutcome[];

export function DeskStageChip({ stage, assumed }: { stage: DeskStage; assumed: boolean }) {
  const tone = stage === "RETURNED" ? "bad" : stage === "SUBMITTED" ? "ok" : stage === "READY" ? "warn" : stage === "CHOSEN" ? "info" : "neutral";
  return (
    <span className="inline-flex items-center gap-1.5" title={DESK_STAGE_MEANS[stage]}>
      <Chip tone={tone}>{DESK_STAGE_LABEL[stage]}</Chip>
      {assumed && <span className="text-[11px] text-muted">worked out from the status, not recorded at the time</span>}
    </span>
  );
}

/** The branch's one button: hand it to the desk, once the paper is in. */
export function HandOver({ applicationId, ready, why }: { applicationId: string; ready: boolean; why: string | null }) {
  const [open, setOpen] = useState(false);
  if (!ready) {
    return <span className="text-[13px] text-amber-700">{why}</span>;
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-brand-600 px-3 py-1.5 text-[13px] font-medium text-white">
        Hand it to the Overseas desk
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Hand it to the Overseas desk"
        description="They choose which vendor it goes through, lodge it in that vendor's portal, and record whatever comes back. You will be told at each step."
      >
        <ActionForm action={handOverAction} submitLabel="Hand it over" pendingLabel="Handing over…">
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label="Anything the desk should know" htmlFor={`ho-${applicationId}`} hint="A deadline, a preference the student has, anything odd about the file. Optional.">
            <Textarea id={`ho-${applicationId}`} name="note" rows={3} />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}

/** The desk picks the road, from the routes recorded for that course. */
export function ChooseRoute({ applicationId, routes, current }: { applicationId: string; routes: RouteChoice[]; current: string | null }) {
  if (routes.length === 0) {
    return (
      <p className="text-[13px] text-amber-700">
        No route is recorded for this course, so there is nothing to choose from. Add one under Vendors and routes, or lodge it directly and record that.
      </p>
    );
  }
  return (
    <ActionForm action={chooseRouteAction} submitLabel={current ? "Change the route" : "Choose this route"} pendingLabel="Saving…">
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="space-y-2">
        {routes.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 hover:bg-ground/60">
            <input type="radio" name="routeId" value={r.id} defaultChecked={r.id === current} className="mt-1" />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: r.colour }}>{r.code}</span>
                <span className="font-medium">{r.name}</span>
                {r.stale && <Chip tone="warn">Terms not confirmed lately</Chip>}
              </span>
              <span className="mt-1 block text-xs text-muted">
                Commission {r.commission ?? "not recorded"} · offer in {r.offerIn} · application fee {r.applicationFee}
                {r.interview ? " · interview" : ""}
              </span>
              {r.asksFor && <span className="mt-0.5 block text-xs text-muted">Asks for: {r.asksFor}</span>}
            </span>
          </label>
        ))}
      </div>
      <FieldError name="routeId" />
    </ActionForm>
  );
}

/** Lodged in their portal, on the day it was actually lodged. */
export function RecordSubmission({ applicationId, reference, statuses, defaultStatusId }: { applicationId: string; reference: string | null; statuses: StatusChoice[]; defaultStatusId: string | null }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionForm action={recordSubmissionAction} submitLabel="It is lodged" pendingLabel="Saving…">
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Lodged on" htmlFor={`sub-${applicationId}`} hint="The day it went into their portal.">
          <Input id={`sub-${applicationId}`} type="date" name="submittedOn" defaultValue={today} max={today} />
          <FieldError name="submittedOn" />
        </Field>
        <Field label="Their reference" htmlFor={`ref-${applicationId}`} hint="The number their portal gave it.">
          <Input id={`ref-${applicationId}`} name="vendorReference" defaultValue={reference ?? ""} />
        </Field>
        <Field label="Move the status to" htmlFor={`st-${applicationId}`} hint="Leave it alone if you would rather move it yourself.">
          <Select id={`st-${applicationId}`} name="statusId" defaultValue={defaultStatusId ?? ""}>
            <option value="">Leave the status as it is</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </Select>
        </Field>
      </div>
    </ActionForm>
  );
}

/**
 * What the vendor said. The date is theirs, not ours, because a turnaround
 * figure built on when somebody typed it in is a number nobody should trust.
 */
export function RecordUpdate({ applicationId, statuses }: { applicationId: string; statuses: StatusChoice[] }) {
  const firstFor = (o: VendorOutcome) => {
    const group = OUTCOME_GROUP[o];
    return group ? (statuses.find((s) => s.group === group)?.id ?? "") : "";
  };
  const [outcome, setOutcome] = useState<VendorOutcome>("ACKNOWLEDGED");
  // The status select is held in state rather than left to a default value: the
  // list of options changes with the outcome, and an uncontrolled select loses
  // its selection when that happens, which is how an update ends up moving
  // nothing without anybody noticing.
  const [statusId, setStatusId] = useState(() => firstFor("ACKNOWLEDGED"));
  const today = new Date().toISOString().slice(0, 10);
  const group = OUTCOME_GROUP[outcome];
  const suggested = group ? statuses.filter((s) => s.group === group) : [];
  const rest = statuses.filter((s) => !suggested.includes(s));
  const needsReason = statuses.some((s) => s.id === statusId && s.requiresReason);
  return (
    <ActionForm action={recordVendorUpdateAction} submitLabel="Record it" pendingLabel="Saving…">
      <input type="hidden" name="applicationId" value={applicationId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What they came back with" htmlFor={`out-${applicationId}`} required>
          <Select
            id={`out-${applicationId}`}
            name="outcome"
            value={outcome}
            onChange={(e) => {
              const next = e.target.value as VendorOutcome;
              setOutcome(next);
              setStatusId(firstFor(next));
            }}
          >
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
            ))}
          </Select>
          <FieldError name="outcome" />
        </Field>
        <Field label="The day they acted" htmlFor={`when-${applicationId}`} required hint="From their portal or their email, not today's date.">
          <Input id={`when-${applicationId}`} type="date" name="happenedOn" defaultValue={today} max={today} />
          <FieldError name="happenedOn" />
        </Field>
        <Field label="Move the status to" htmlFor={`ust-${applicationId}`} hint={suggested.length ? "Suggested from what they said." : "Nothing is suggested for this one."}>
          <Select id={`ust-${applicationId}`} name="statusId" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
            <option value="">Leave the status as it is</option>
            {suggested.length > 0 && (
              <optgroup label="Suggested">
                {suggested.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Everything else">
              {rest.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </optgroup>
          </Select>
        </Field>
      </div>
      <Field label="In their words" htmlFor={`note-${applicationId}`} hint="What the vendor actually said. The branch reads this.">
        <Textarea id={`note-${applicationId}`} name="note" rows={2} />
      </Field>
      {needsReason && (
        <Field label="Reason" htmlFor={`rsn-${applicationId}`} required hint="The status you picked needs one.">
          <Input id={`rsn-${applicationId}`} name="reason" />
        </Field>
      )}
    </ActionForm>
  );
}

/** Sent back to the branch, with the reason the counsellor reads. */
export function ReturnToBranch({ applicationId }: { applicationId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-[13px] text-muted hover:text-ink">
        Send it back to the branch
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Send it back" description="The reason goes to the counsellor and the branch owner, and stays on the application.">
        <ActionForm action={returnToBranchAction} submitLabel="Send it back" submitVariant="secondary">
          <input type="hidden" name="applicationId" value={applicationId} />
          <Field label="What has to be fixed" htmlFor={`ret-${applicationId}`} required>
            <Textarea id={`ret-${applicationId}`} name="reason" rows={3} />
            <FieldError name="reason" />
          </Field>
        </ActionForm>
      </Modal>
    </>
  );
}
