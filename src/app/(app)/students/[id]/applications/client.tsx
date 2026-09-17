"use client";

import { useMemo, useState } from "react";
import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Select, Textarea } from "@/components/ui";
import { addCommentAction, changeStatusAction, createApplicationAction } from "./actions";

type ProgramOption = {
  id: string;
  name: string;
  university: string;
  country: string;
  pathway: "DEGREE" | "AUSBILDUNG" | "NURSING";
  intakeMonths: number[];
  tuition: string;
  requirements: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ApplyForm({ studentId, programs, defaultPathway }: { studentId: string; programs: ProgramOption[]; defaultPathway: string }) {
  const [pathway, setPathway] = useState(defaultPathway);
  const [country, setCountry] = useState("");
  const [programId, setProgramId] = useState("");
  const countries = useMemo(() => [...new Set(programs.map((p) => p.country))].sort(), [programs]);
  const visible = programs.filter((p) => (!pathway || p.pathway === pathway) && (!country || p.country === country));
  const program = programs.find((p) => p.id === programId);

  const intakes = useMemo(() => {
    if (!program) return [];
    const now = new Date();
    const out: { value: string; label: string }[] = [];
    for (let y = now.getFullYear(); y <= now.getFullYear() + 2; y++) {
      for (const m of program.intakeMonths) {
        if (new Date(y, m - 1, 1) > now) out.push({ value: `${y}-${m}`, label: `${MONTHS[m - 1]} ${y}` });
      }
    }
    return out.sort((a, b) => (a.value < b.value ? -1 : 1));
  }, [program]);

  return (
    <ActionForm action={createApplicationAction} submitLabel="Create application" pendingLabel="Creating…">
      <input type="hidden" name="studentId" value={studentId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pathway" htmlFor="pathway">
          <Select id="pathway" value={pathway} onChange={(e) => { setPathway(e.target.value); setProgramId(""); }}>
            <option value="">All pathways</option>
            <option value="DEGREE">University degree</option>
            <option value="AUSBILDUNG">Ausbildung (Germany)</option>
            <option value="NURSING">Nurse registration</option>
          </Select>
        </Field>
        <Field label="Country" htmlFor="country">
          <Select id="country" value={country} onChange={(e) => { setCountry(e.target.value); setProgramId(""); }}>
            <option value="">All countries</option>
            {countries.map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={`Program (${visible.length})`} htmlFor="programId" required>
        <Select id="programId" name="programId" value={programId} onChange={(e) => setProgramId(e.target.value)}>
          <option value="">Choose a program</option>
          {visible.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.university}, {p.country}</option>)}
        </Select>
        <FieldError name="programId" />
      </Field>
      {program && (
        <div className="rounded-md border border-line bg-ground/60 p-3 text-sm">
          <p className="font-medium">{program.name}</p>
          <p className="text-muted">{program.university}, {program.country} · {program.tuition}</p>
          {program.requirements && <p className="mt-1 text-muted">Requirements: {program.requirements}</p>}
        </div>
      )}
      <Field label="Intake" htmlFor="intake" required>
        <Select id="intake" name="intake" disabled={!program} defaultValue="">
          <option value="">{program ? "Choose an intake" : "Choose a program first"}</option>
          {intakes.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
        </Select>
        <FieldError name="intake" />
      </Field>
      <p className="text-xs text-muted">Full program search with eligibility filters arrives in Phase 2.</p>
    </ActionForm>
  );
}

export function StatusForm({ applicationId, currentId, statuses }: { applicationId: string; currentId: string; statuses: { id: string; label: string; requiresReason: boolean; isMilestone: boolean }[] }) {
  const [selected, setSelected] = useState(currentId);
  const s = statuses.find((x) => x.id === selected);
  return (
    <ActionForm action={changeStatusAction} submitLabel="Update status" pendingLabel="Updating…">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Field label="Status" htmlFor={`status-${applicationId}`}>
        <Select id={`status-${applicationId}`} name="statusId" value={selected} onChange={(e) => setSelected(e.target.value)}>
          {statuses.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </Select>
      </Field>
      {s && selected !== currentId && (
        <Field label={s.requiresReason ? "Reason (required)" : "Note to partner (optional)"} htmlFor={`reason-${applicationId}`}>
          <Textarea id={`reason-${applicationId}`} name="reason" rows={2} required={s.requiresReason} />
        </Field>
      )}
      {s?.isMilestone && selected !== currentId && <p className="text-xs text-emerald-700">Milestone: the student gets a WhatsApp update.</p>}
    </ActionForm>
  );
}

export function CommentComposer({ applicationId, channel, whatsapp }: { applicationId: string; channel: "TEAM" | "STUDENT"; whatsapp: boolean }) {
  return (
    <ActionForm action={addCommentAction} submitLabel={channel === "STUDENT" && whatsapp ? "Send to student" : "Post comment"} pendingLabel="Sending…" resetOnSuccess>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="channel" value={channel} />
      <label htmlFor={`body-${channel}`} className="sr-only">Message</label>
      <Textarea id={`body-${channel}`} name="body" rows={3} placeholder={channel === "TEAM" ? "Message the Medcity Overseas team. The student can't see this." : "Message the student. They'll also get it on WhatsApp."} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <label htmlFor={`file-${channel}`}>Attach</label>
        <input id={`file-${channel}`} type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="text-xs" />
        <span>PDF or image, up to 10 MB</span>
      </div>
    </ActionForm>
  );
}
