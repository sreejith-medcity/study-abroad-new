"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Modal } from "@/components/modal";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { UploadForm } from "../documents/upload";
import { CLAIM_MINUTES, claimHeld, OWED_BY_LABEL, STAGES, stageLabel } from "@/lib/journey";
import {
  acceptItemAction,
  addChecklistItemAction,
  claimItemAction,
  markAskedAction,
  needAgainAction,
  notNeededAction,
  rejectItemAction,
  releaseItemAction,
  removeChecklistItemAction,
  setStageAction,
} from "@/server/documentation-actions";
import type { ChecklistState, JourneyStage, OwedBy, RequirementSource } from "@/db/schema";

type Item = {
  id: string;
  studentId: string;
  label: string;
  state: ChecklistState;
  typeCode: string;
  source: RequirementSource;
  version: number;
  validityMonths: number | null;
  issuedOn: string | null;
  guidance: string | null;
  fileName: string | null;
  documentId: string | null;
  claimedById: string | null;
  claimedAt: string | null;
};

/** A plain form that posts one field and nothing else. */
function Quiet({ action, children, ...fields }: { action: (fd: FormData) => Promise<void>; children: React.ReactNode } & Record<string, unknown>) {
  return (
    <form action={action} className="inline">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      {children}
    </form>
  );
}

const link = "text-[13px] font-medium text-brand-600 hover:underline";

export function ItemActions({ item, reasons, canProcess, userId }: { item: Item; reasons: { code: string; label: string }[]; canProcess: boolean; userId: string }) {
  const [open, setOpen] = useState<null | "ask" | "check" | "skip" | "upload">(null);
  const heldByOther = item.claimedById != null && item.claimedById !== userId && claimHeld(item.claimedAt);
  const waiting = item.state === "UPLOADED" || item.state === "IN_REVIEW";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 whitespace-nowrap">
      {item.state === "NOT_NEEDED" ? (
        <Quiet action={needAgainAction} itemId={item.id}>
          <button type="submit" className={link}>Needed after all</button>
        </Quiet>
      ) : (
        <>
          {waiting && canProcess && (
            <button type="button" className={link} onClick={() => setOpen("check")} disabled={heldByOther} title={heldByOther ? "Somebody else is checking this" : undefined}>
              {heldByOther ? "Being checked" : "Check"}
            </button>
          )}
          {!waiting && item.state !== "ACCEPTED" && (
            <button type="button" className={link} onClick={() => setOpen("ask")}>
              {item.state === "ASKED" || item.state === "REJECTED" ? "Chase" : "Ask"}
            </button>
          )}
          <button type="button" className={link} onClick={() => setOpen("upload")}>Upload</button>
          {item.state !== "ACCEPTED" && (
            <button type="button" className="text-[13px] text-muted hover:text-ink" onClick={() => setOpen("skip")}>Not needed</button>
          )}
          {item.source === "STUDENT" && item.version === 0 && (
            <Quiet action={removeChecklistItemAction} itemId={item.id}>
              <button type="submit" className="text-[13px] text-muted hover:text-ink">Remove</button>
            </Quiet>
          )}
        </>
      )}

      <Modal open={open === "ask"} onClose={() => setOpen(null)} title={`Ask for ${item.label}`} description="Records the request and the day it is wanted by. The message itself goes out from the file.">
        <ActionForm action={markAskedAction} submitLabel="Record the request">
          <input type="hidden" name="itemId" value={item.id} />
          <Field label="Wanted by" htmlFor={`due-${item.id}`} hint="Leave it empty to keep whatever is already on the row.">
            <Input id={`due-${item.id}`} type="date" name="dueOn" />
          </Field>
          <Field label="Asked on" htmlFor={`channel-${item.id}`}>
            <Select id={`channel-${item.id}`} name="channel" defaultValue="WhatsApp">
              <option>WhatsApp</option>
              <option>Portal</option>
              <option>Phone</option>
              <option>In person</option>
              <option>Email</option>
            </Select>
          </Field>
        </ActionForm>
      </Modal>

      <Modal open={open === "check"} onClose={() => setOpen(null)} title={`Checking ${item.label}`} description={item.guidance ?? "No rule recorded for this document yet."} className="max-w-2xl">
        <div className="space-y-4">
          {item.fileName && item.documentId ? (
            <p className="text-[13px]">
              File: <a href={`/api/documents/${item.documentId}`} className="font-medium text-brand-600 hover:underline">{item.fileName}</a> {item.version > 0 && <span className="text-muted">v{item.version}</span>}
            </p>
          ) : (
            <p className="text-[13px] text-muted">No file on the row. Accepting it records the decision without one.</p>
          )}
          {!heldByOther && (
            <Quiet action={claimItemAction} itemId={item.id}>
              <button type="submit" className={link}>Claim it for {CLAIM_MINUTES} minutes</button>
            </Quiet>
          )}
          {item.claimedById === userId && (
            <Quiet action={releaseItemAction} itemId={item.id}>
              <button type="submit" className="ml-3 text-[13px] text-muted hover:text-ink">Let it go</button>
            </Quiet>
          )}
          <div className="rounded-lg border border-line p-3">
            <p className="mb-2 font-medium">Accept it</p>
            <ActionForm action={acceptItemAction} submitLabel="Accept">
              <input type="hidden" name="itemId" value={item.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Date on the document" htmlFor={`issued-${item.id}`}>
                  <Input id={`issued-${item.id}`} type="date" name="issuedOn" defaultValue={item.issuedOn ?? ""} />
                </Field>
                <Field label="Good for, in months" htmlFor={`months-${item.id}`} hint="Leave empty where the document carries its own expiry.">
                  <Input id={`months-${item.id}`} name="validityMonths" inputMode="numeric" defaultValue={item.validityMonths ?? ""} />
                  <FieldError name="validityMonths" />
                </Field>
                <Field label="Or the date it runs out" htmlFor={`valid-${item.id}`}>
                  <Input id={`valid-${item.id}`} type="date" name="validTo" />
                </Field>
              </div>
            </ActionForm>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="mb-2 font-medium">Send it back</p>
            <ActionForm action={rejectItemAction} submitLabel="Reject" submitVariant="secondary">
              <input type="hidden" name="itemId" value={item.id} />
              <Field label="Reason" htmlFor={`reason-${item.id}`} hint="The student reads this word for word." required>
                <Select id={`reason-${item.id}`} name="reasonCode" defaultValue="">
                  <option value="" disabled>Pick a reason</option>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </Select>
                <FieldError name="reasonCode" />
              </Field>
              <Field label="Anything to add" htmlFor={`note-${item.id}`} hint="Said plainly, so the student can act on it.">
                <Textarea id={`note-${item.id}`} name="reason" rows={2} />
              </Field>
            </ActionForm>
          </div>
        </div>
      </Modal>

      <Modal open={open === "skip"} onClose={() => setOpen(null)} title={`${item.label} is not needed`} description="It stays on the list with the reason, so nobody asks again.">
        <ActionForm action={notNeededAction} submitLabel="Mark not needed">
          <input type="hidden" name="itemId" value={item.id} />
          <Field label="Why not" htmlFor={`skip-${item.id}`} required>
            <Textarea id={`skip-${item.id}`} name="reason" rows={2} />
            <FieldError name="reason" />
          </Field>
        </ActionForm>
      </Modal>

      <Modal open={open === "upload"} onClose={() => setOpen(null)} title={`Upload ${item.label}`} description="The file joins the documentation team's queue. Nobody marks their own document good.">
        <UploadForm studentId={item.studentId} types={[]} defaultType={item.typeCode} />
      </Modal>
    </div>
  );
}

/** Moves the file on, and says what is in the way when it will not move. */
export function StageMover({ studentId, stage, canOverride, missing }: { studentId: string; stage: JourneyStage; canOverride: boolean; missing: string[] }) {
  return (
    <ActionForm action={setStageAction} submitLabel="Move the stage" className="space-y-2">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Stage" htmlFor={`stage-${studentId}`}>
          <Select id={`stage-${studentId}`} name="stage" defaultValue={stage} className="w-auto">
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.number}. {s.label}</option>
            ))}
          </Select>
        </Field>
        {canOverride && missing.length > 0 && (
          <Field label="Reason for letting it through" htmlFor={`why-${studentId}`} hint={`Logged on the file. Missing: ${missing.join(", ")}`}>
            <Input id={`why-${studentId}`} name="reason" className="min-w-[18rem]" />
            <FieldError name="reason" />
          </Field>
        )}
      </div>
      <p className="text-xs text-muted">The stage is only held back by required documents. {stageLabel(stage)} is where the file sits now.</p>
    </ActionForm>
  );
}

/** One document this student alone needs. */
export function AddItem({ studentId, types, stage }: { studentId: string; types: { code: string; label: string }[]; stage: JourneyStage }) {
  const owed: OwedBy[] = ["STUDENT", "MEDCITY", "UNIVERSITY", "VENDOR"];
  if (types.length === 0) return <p className="text-muted">Every document type is already on this student&rsquo;s list.</p>;
  return (
    <ActionForm action={addChecklistItemAction} submitLabel="Add it" resetOnSuccess>
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Document" htmlFor={`add-type-${studentId}`} required>
          <Select id={`add-type-${studentId}`} name="typeCode" defaultValue="">
            <option value="" disabled>Choose a document</option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </Select>
          <FieldError name="typeCode" />
        </Field>
        <Field label="Stage" htmlFor={`add-stage-${studentId}`}>
          <Select id={`add-stage-${studentId}`} name="stage" defaultValue={stage}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>{s.number}. {s.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Owed by" htmlFor={`add-owed-${studentId}`}>
          <Select id={`add-owed-${studentId}`} name="owedBy" defaultValue="STUDENT">
            {owed.map((o) => (
              <option key={o} value={o}>{OWED_BY_LABEL[o]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Wanted by" htmlFor={`add-due-${studentId}`}>
          <Input id={`add-due-${studentId}`} type="date" name="dueOn" />
        </Field>
      </div>
      <Field label="Why this student needs it" htmlFor={`add-note-${studentId}`} required>
        <Input id={`add-note-${studentId}`} name="note" placeholder="Gap of 14 months between the degree and now" />
        <FieldError name="note" />
      </Field>
      <Checkbox name="required" defaultChecked label="Holds the stage until it is in" />
    </ActionForm>
  );
}
