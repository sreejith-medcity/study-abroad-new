"use client";

import { useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { Button, Input, Select } from "@/components/ui";
import { MAX_SIGNUP_QUESTIONS, SIGNUP_KIND_LABEL } from "@/lib/signup-questions";
import { saveSignupQuestionsAction, saveStudentBrandAction, saveStudentNotificationsAction } from "@/server/student-platform";

export function StudentBrandForm({ name, color, hasLogo, orgId }: { name: string | null; color: string | null; hasLogo: boolean; orgId: string }) {
  const [useColor, setUseColor] = useState(!!color);
  const [value, setValue] = useState(color ?? "#0b6e4f");
  return (
    <ActionForm action={saveStudentBrandAction} submitLabel="Save portal look" pendingLabel="Saving…">
      <TextField id="sp-name" label="Name students see" name="portalName" defaultValue={name ?? ""} hint="Leave blank to show the branch's own name" />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="useColor" checked={useColor} onChange={(e) => setUseColor(e.target.checked)} className="size-4" /> Use our own colour
      </label>
      {useColor && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="sp-color" className="text-[13px] font-medium text-ink-soft">Colour</label>
            <div className="mt-1 flex items-center gap-2">
              <input type="color" aria-label="Pick a colour" value={value} onChange={(e) => setValue(e.target.value)} className="h-10 w-12 cursor-pointer rounded border border-line" />
              <Input id="sp-color" name="portalColor" value={value} onChange={(e) => setValue(e.target.value)} className="w-32" />
            </div>
            <FieldError name="portalColor" />
          </div>
          <span className="rounded-lg px-3 py-2 text-sm font-medium text-white" style={{ background: /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined }}>
            A button in your colour
          </span>
        </div>
      )}
      <div>
        <label htmlFor="sp-logo" className="text-[13px] font-medium text-ink-soft">{hasLogo ? "Replace the logo" : "Logo"}</label>
        <input id="sp-logo" type="file" name="logo" accept=".png,.jpg,.jpeg,.webp" className="mt-1 block text-xs" />
        <FieldError name="logo" />
        {hasLogo && (
          <div className="mt-2 flex items-center gap-3 text-[13px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/org-logo/${orgId}`} alt="Current logo" className="h-8 w-auto rounded border border-line" />
            <label className="flex items-center gap-1.5"><input type="checkbox" name="removeLogo" /> Remove the logo</label>
          </div>
        )}
      </div>
    </ActionForm>
  );
}

export function StudentNotificationsForm({ milestones, messages }: { milestones: boolean; messages: boolean }) {
  return (
    <ActionForm action={saveStudentNotificationsAction} submitLabel="Save notifications" submitVariant="secondary">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="milestones" defaultChecked={milestones} className="mt-0.5 size-4" />
        <span>Status milestones on WhatsApp<span className="block text-xs text-muted">Offer received, visa granted and the other big steps</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="messages" defaultChecked={messages} className="mt-0.5 size-4" />
        <span>Messages to the student on WhatsApp too<span className="block text-xs text-muted">Off, they only appear in the portal</span></span>
      </label>
    </ActionForm>
  );
}

type Q = { id: string; label: string; kind: "text" | "choice" | "yesno"; options: string[]; required: boolean };

export function SignupQuestionsForm({ questions }: { questions: Q[] }) {
  const [rows, setRows] = useState<(Q & { key: number })[]>(questions.map((q, i) => ({ ...q, key: i })));
  const [next, setNext] = useState(questions.length);
  const add = () => {
    setRows((r) => [...r, { key: next, id: "", label: "", kind: "text", options: [], required: false }]);
    setNext((n) => n + 1);
  };
  return (
    <ActionForm action={saveSignupQuestionsAction} submitLabel="Save questions">
      {rows.length === 0 && <p className="text-[13px] text-muted">The form asks name, mobile, email, town, interest, destination and start year. Add your own questions below.</p>}
      <ol className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.key} className="rounded-lg border border-line p-3">
            <input type="hidden" name={`q${i}_id`} value={r.id} />
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <label htmlFor={`q${i}-label`} className="text-[13px] font-medium text-ink-soft">Question {i + 1}</label>
                <Input id={`q${i}-label`} name={`q${i}_label`} defaultValue={r.label} placeholder="Your highest qualification" className="mt-1" />
                <FieldError name={`q${i}_label`} />
              </div>
              <div>
                <label htmlFor={`q${i}-kind`} className="text-[13px] font-medium text-ink-soft">Answer</label>
                <Select id={`q${i}-kind`} name={`q${i}_kind`} value={r.kind} onChange={(e) => setRows((all) => all.map((x) => (x.key === r.key ? { ...x, kind: e.target.value as Q["kind"] } : x)))} className="mt-1">
                  {Object.entries(SIGNUP_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
            </div>
            {r.kind === "choice" && (
              <div className="mt-2">
                <label htmlFor={`q${i}-options`} className="text-[13px] font-medium text-ink-soft">Options, separated by commas</label>
                <Input id={`q${i}-options`} name={`q${i}_options`} defaultValue={r.options.join(", ")} placeholder="12th, Diploma, Degree, Master's" className="mt-1" />
                <FieldError name={`q${i}_options`} />
              </div>
            )}
            <div className="mt-2 flex items-center justify-between">
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name={`q${i}_required`} defaultChecked={r.required} /> Must be answered</label>
              <Button type="button" variant="quiet" size="sm" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}>Remove question {i + 1}</Button>
            </div>
          </li>
        ))}
      </ol>
      {rows.length < MAX_SIGNUP_QUESTIONS && (
        <Button type="button" variant="secondary" size="sm" onClick={add}>Add a question</Button>
      )}
    </ActionForm>
  );
}
