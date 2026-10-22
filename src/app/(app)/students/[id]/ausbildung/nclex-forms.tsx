"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, FieldError } from "@/components/action-form";
import { Alert, Button, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { toast } from "@/components/toast";
import { UPLOAD_ACCEPT, refusalFromStatus, sizeRefusal } from "@/lib/uploads";
import { NCLEX_STATES } from "@/lib/nclex";
import { saveNclexCaseAction, saveNclexResultAction, saveNclexStepAction } from "@/server/nclex-actions";

/** One step: Completed or Pending, and the day it was done. */
export function NclexStepForm({ studentId, step, label, completed, completedOn }: { studentId: string; step: string; label: string; completed: boolean; completedOn: string | null }) {
  return (
    <ActionForm action={saveNclexStepAction} submitLabel="Save" submitVariant="secondary" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="step" value={step} />
      <Select name="completed" defaultValue={completed ? "1" : "0"} className="w-36" aria-label={`${label}: completed or pending`}>
        <option value="0">Pending</option>
        <option value="1">Completed</option>
      </Select>
      <Input name="completedOn" type="date" defaultValue={completedOn ?? ""} className="w-40" aria-label={`${label}: completed on`} title="The day it was done" />
    </ActionForm>
  );
}

/**
 * The file a step carries, put on the student's documents and linked to the
 * step. Posted to the same route every other document goes through, so the
 * size limits and the refusals read the same.
 */
export function NclexStepUpload({ studentId, step, label }: { studentId: string; step: string; label: string }) {
  const [error, setError] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (percent !== null) return;
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file to upload.");
    const tooBig = sizeRefusal(file);
    if (tooBig) return setError(tooBig);
    setError(null);
    setPercent(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads/document");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setPercent(Math.round((ev.loaded / ev.total) * 95));
    xhr.onload = () => {
      setPercent(null);
      let said: { ok?: string; error?: string } | null = null;
      try {
        said = JSON.parse(xhr.responseText) as { ok?: string; error?: string };
      } catch {
        said = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && said?.ok) {
        form.current?.reset();
        toast(said.ok);
        router.refresh();
        return;
      }
      setError(said?.error ?? refusalFromStatus(xhr.status, file.size));
    };
    xhr.onerror = () => {
      setPercent(null);
      setError(refusalFromStatus(0, file.size));
    };
    xhr.send(fd);
  }

  return (
    <form ref={form} onSubmit={send} className="flex flex-wrap items-center gap-2" noValidate>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="typeCode" value="OTHER" />
      <input type="hidden" name="label" value={`NCLEX-RN: ${label}`} />
      <input type="hidden" name="nclexStep" value={step} />
      <Input type="file" name="file" accept={UPLOAD_ACCEPT} aria-label={`File for ${label}`} className="w-64 py-1 text-xs" />
      <Button type="submit" size="sm" variant="secondary" disabled={percent !== null}>
        {percent !== null ? `Uploading ${percent}%` : "Upload"}
      </Button>
      {error && <Alert tone="bad">{error}</Alert>}
    </form>
  );
}

/** The board state, with the fee the placement sheet gives for it, and the payment link sent. */
export function NclexCaseForm({ studentId, boardState, paymentLink, note }: { studentId: string; boardState: string | null; paymentLink: string | null; note: string | null }) {
  const [state, setState] = useState(boardState ?? "");
  const fee = NCLEX_STATES.find((s) => s.code === state)?.feeUsd;
  return (
    <ActionForm action={saveNclexCaseAction} submitLabel="Save state and link" submitVariant="secondary">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <Field label="Board state" htmlFor="nc-state" hint={fee ? `Fee for ${NCLEX_STATES.find((s) => s.code === state)?.name}: $${fee}` : "Florida, Texas and Illinois $485; New York $425."}>
          <Select id="nc-state" name="boardState" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">Not chosen yet</option>
            {NCLEX_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name} (${s.feeUsd})
              </option>
            ))}
          </Select>
          <FieldError name="boardState" />
        </Field>
        <Field label="Payment link sent" htmlFor="nc-link">
          <Input id="nc-link" name="paymentLink" type="url" defaultValue={paymentLink ?? ""} placeholder="https://" />
          <FieldError name="paymentLink" />
        </Field>
      </div>
      <Field label="Note" htmlFor="nc-note">
        <Textarea id="nc-note" name="note" rows={2} defaultValue={note ?? ""} />
      </Field>
    </ActionForm>
  );
}

/** The result, which decides the step after it. */
export function NclexResultForm({ studentId, result, resultOn }: { studentId: string; result: string | null; resultOn: string | null }) {
  return (
    <ActionForm action={saveNclexResultAction} submitLabel="Save result" submitVariant="secondary" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="studentId" value={studentId} />
      <Field label="NCLEX-RN result" htmlFor="nc-result">
        <Select id="nc-result" name="result" defaultValue={result ?? ""} className={cn("w-40")}>
          <option value="">Not in yet</option>
          <option value="PASS">Pass</option>
          <option value="FAIL">Fail</option>
        </Select>
      </Field>
      <Field label="On" htmlFor="nc-result-on">
        <Input id="nc-result-on" name="resultOn" type="date" defaultValue={resultOn ?? ""} className="w-40" />
      </Field>
    </ActionForm>
  );
}
