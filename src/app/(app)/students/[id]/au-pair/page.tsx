import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, intakeLabel, istDateTime } from "@/lib/format";
import { APP_ROLES, STUDENT_WORK_ROLES } from "@/lib/permissions";
import { GERMAN_LEVELS, MODULE_STATE_LABEL, toIstInput, type ModuleState } from "@/lib/ausbildung";
import {
  AFTER_REFUSAL_LABEL,
  APPOINTMENT_AT,
  AU_PAIR_CHECKLISTS,
  AU_PAIR_FACTS,
  AU_PAIR_PLATFORMS,
  AU_PAIR_PRE_VISA,
  AU_PAIR_PROFILE_DOCUMENTS,
  AU_PAIR_STAGES,
  AU_PAIR_STEPS,
  AU_PAIR_STEP_COUNT,
  AU_PAIR_TEAMS,
  AU_PAIR_TEAM_LABEL,
  CONTRACT_AT,
  FAMILY_OUTCOME_LABEL,
  HOST_FAMILY_AT,
  MOCK_RESULT_LABEL,
  auPairChecklistOpen,
  auPairDetailsMissing,
  auPairHandoverFrom,
  auPairStepOf,
  auPairVisaGate,
  daysBetween,
  listMissing,
  mayDoAuPair,
  registrationDraft,
  type AfterRefusal,
  type AuPairOp,
} from "@/lib/au-pair";
import { getStudentForUser } from "@/server/queries";
import { fsjEventsOf, fsjStudentFacts, germanRecord } from "@/server/fsj";
import { FAMILY_WITHDRAWN, auPairContacts, auPairMentor, auPairVisaFacts, currentAuPairApplication, docStates, mentorChoices, openInvoices, auPairGateAppOf } from "@/server/au-pair";
import { feeAccess } from "@/server/student-fees";
import { Card, CardHeader, Checkbox, Chip, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { FieldError } from "@/components/action-form";
import { AuPairForm } from "./forms";
import { CopyEmail } from "../fsj/forms";
import { ModuleForm } from "../ausbildung/forms";

export const metadata = { title: "Au pair" };
export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  MENTOR: "Mentor",
  MOCK_INTERVIEW: "Mock interview",
  PROFILE_SUBMITTED: "Profile submitted",
  HOST_FAMILY: "Host family found",
  INTERVIEW: "Host family interview",
  FEEDBACK: "Interview outcome",
  CONTRACT: "Contract",
  FEE_CHECK: "Payment verification",
  APPOINTMENT: "Visa appointment",
  VISA_SUBMITTED: "Visa submission",
  FOLLOW_UP: "Follow-up",
  VISA_DECISION: "Visa decision",
  HANDOVER: "Hand-over",
  NOTICE: "Notice raised",
};

const OUTCOME_TEXT: Record<string, string> = {
  ASSIGNED: "assigned",
  CHANGED: "changed",
  READY: "ready",
  NEEDS_WORK: "more preparation needed",
  FIRST: "first",
  RESCHEDULED: "rescheduled",
  SELECTED: "selected",
  NOT_SELECTED: "not selected, back to interview preparation",
  TERMS: "terms verified",
  SIGNED: "signed by the candidate",
  VERIFIED: "all applicable payments completed",
  BOOKED: "booked",
  REBOOKED: "booked again",
  RESUBMITTED: "applied again",
  UPDATE: "update",
  DOCUMENTS_REQUESTED: "more documents asked for",
  APPROVED: "approved",
  REJECTED: "refused",
  [FAMILY_WITHDRAWN]: "refused; the host family withdrew, back to interview preparation",
  HAPPY_CALL: "happy call made",
  REGISTERED: "registration email to send",
  DOCUMENTATION: "to the Documentation Department",
  PLACEMENT: "to the Placement Team",
  VISA: "to the Visa Team",
  TRAVEL: "to the Travel Desk",
};

/**
 * The Au pair file: where it stands on the written process, the step in
 * hand's form for the team that owns it, the two document lists, the
 * registration email the branch sends, and every recorded moment. Each team
 * sees the forms for its own steps; the rest read.
 */
export default async function StudentAuPairPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const [app, facts, contacts, modules, mentor, docs] = await Promise.all([currentAuPairApplication(id), fsjStudentFacts(id), auPairContacts(), germanRecord(id), auPairMentor(id), docStates(id)]);
  const mayEditGerman = (STUDENT_WORK_ROLES as readonly string[]).includes(user.role);
  const events = app ? await fsjEventsOf(app.id) : [];
  const step = auPairStepOf(app?.statusCode);
  const code = app?.statusCode ?? null;
  const days = app?.statusSince ? daysBetween(new Date(app.statusSince), new Date()) : null;
  const may = (op: AuPairOp, checklistStep?: number) => !!app && mayDoAuPair(op, user.role, { code, checklistStep });
  const feeRight = (await feeAccess(user)).act;
  const handover = auPairHandoverFrom(code);
  const mentors = app && code && (auPairStepOf(code)?.step ?? 0) >= 4 && may("mentor") ? await mentorChoices() : [];
  const lastMock = events.find((e) => e.kind === "MOCK_INTERVIEW") ?? null;
  const visaFacts = app && code === "PRE_VISA_DOCUMENTS" ? await auPairVisaFacts(auPairGateAppOf(app), { sync: false }) : null;
  const visaMissing = visaFacts ? auPairVisaGate(visaFacts).missing : [];
  const invoices = app && code === "PRE_VISA_DOCUMENTS" && feeRight ? await openInvoices(id) : [];
  const handoverMissing =
    app && code === "DOCUMENT_COLLECTION"
      ? [
          ...listMissing(AU_PAIR_PROFILE_DOCUMENTS, docs),
          ...auPairDetailsMissing({
            medcityId: student.medcityId,
            email: student.email,
            germanLevel: facts?.germanLevel,
            counsellor: student.assignedToId,
            registrationFeePaidOn: app.registrationFeePaidOn,
            agreementSignedOn: app.agreementSignedOn,
          }),
        ]
      : [];
  const f = { studentId: id, applicationId: app?.id ?? "" };
  const done = app?.done ?? [];
  const ticksFor = (n: number) =>
    AU_PAIR_CHECKLISTS[n].map((i) => <Checkbox key={i.key} name="done" value={i.key} defaultChecked={done.includes(i.key)} label={i.label} />);

  // The registration email (step 2): to the Au pair address, the branch head in copy.
  const to = contacts.rows.map((r) => r.email).filter((e): e is string => !!e);
  const cc = (facts?.heads ?? []).map((h) => h.email).filter((e): e is string => !!e);
  const draft = registrationDraft(
    {
      student: fullName(student),
      medcityId: student.medcityId,
      email: student.email,
      phone: student.phone,
      germanLevel: facts?.germanLevel ?? null,
      branch: facts?.branch ?? null,
      counsellor: facts?.counsellor?.name ?? null,
      registeredOn: fmtDate(student.createdAt),
      registrationFeePaidOn: app?.registrationFeePaidOn ? fmtDate(app.registrationFeePaidOn) : null,
      agreementSignedOn: app?.agreementSignedOn ? fmtDate(app.agreementSignedOn) : null,
      intake: app ? intakeLabel(app.intakeMonth, app.intakeYear) : null,
    },
    { to, cc },
  );
  const registeredNotice = events.find((e) => e.kind === "NOTICE" && e.outcome === "REGISTERED");
  const docState = (codes: string[]) => {
    const rows = codes.map((c) => docs.find((d) => d.typeCode === c));
    if (rows.every((r) => r && (r.state === "ACCEPTED" || r.state === "NOT_NEEDED"))) return "in";
    if (rows.some((r) => r && ["UPLOADED", "IN_REVIEW", "ACCEPTED"].includes(r.state))) return "partly";
    return rows.some((r) => r) ? "owed" : "not on the list";
  };

  return (
    <div className="space-y-5" data-au-pair-tab>
      <Card data-au-pair-process>
        <CardHeader
          title="Au pair: Germany"
          subtitle={
            app
              ? step
                ? `Step ${step.step} of ${AU_PAIR_STEP_COUNT}: ${step.title}. Owner: ${AU_PAIR_TEAM_LABEL[step.team]}.`
                : `The application is ${app.statusLabel}, which the written process does not place on a step.`
              : "No open Au pair application yet. Start one from the Applications tab, on an Au pair course: the steps begin when it exists."
          }
          action={
            <span className="flex flex-wrap items-center gap-2">
              {app && days != null && (
                <Chip tone="neutral">
                  <span data-days-at-step>
                    {days} {days === 1 ? "day" : "days"} at this step
                  </span>
                </Chip>
              )}
              {mentor && <Chip tone="info">Mentor: {mentor.name}</Chip>}
              {app?.handedOverAt && <Chip tone="info">With the desk since {fmtDate(app.handedOverAt)}</Chip>}
            </span>
          }
        />
        <ol className="flex flex-wrap gap-1.5 px-4 pb-3" aria-label="Teams in the written process">
          {AU_PAIR_TEAMS.map((d, i) => (
            <li
              key={d.key}
              data-team={d.key}
              aria-current={step?.team === d.key ? "step" : undefined}
              className={cn("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset", step?.team === d.key ? "bg-brand-600 text-white ring-brand-600" : "text-muted ring-line-strong")}
            >
              {i + 1}. {d.label}
            </li>
          ))}
        </ol>
        {app && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted" data-au-pair-status={app.statusCode}>
            Status: <span className="font-medium text-ink">{app.statusLabel}</span> since {fmtDate(app.statusSince)}. Application {app.ackNo}, {app.programName}, {intakeLabel(app.intakeMonth, app.intakeYear)}.
          </p>
        )}
        <dl className="grid gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-sm sm:grid-cols-4" data-programme-facts>
          {AU_PAIR_FACTS.map((x) => (
            <div key={x.label}>
              <dt className="text-2xs font-semibold uppercase tracking-wide text-muted">{x.label}</dt>
              <dd>{x.value}</dd>
            </div>
          ))}
          <p className="text-2xs text-muted sm:col-span-4">From the Au pair process guide. Shown for information; the portal checks nothing against it.</p>
        </dl>
      </Card>

      {/* Step 1 collects the German details; the hand-over reads the level from here or from a German test on the profile. */}
      <Card data-au-pair-german>
        <CardHeader title="German record" subtitle={`Current level: ${facts?.germanLevel ?? "Not recorded"}. Each level with the day it was finished; module-wise certificates go on the Documents tab.`} />
        <ul className="divide-y divide-line">
          {GERMAN_LEVELS.map((level) => {
            const row = modules.find((m) => m.level === level);
            const state = (row?.state ?? "NOT_STARTED") as ModuleState;
            return (
              <li key={level} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2" data-module={level}>
                {mayEditGerman ? <ModuleForm studentId={id} level={level} state={state} completedOn={row?.completedOn ?? null} /> : <span className="w-10 font-display text-lg font-semibold text-ink">{level}</span>}
                <Chip tone={state === "COMPLETED" ? "ok" : state === "IN_PROGRESS" ? "warn" : "neutral"}>
                  {MODULE_STATE_LABEL[state]}
                  {row?.completedOn ? ` on ${fmtDate(row.completedOn)}` : ""}
                </Chip>
              </li>
            );
          })}
        </ul>
      </Card>

      {app && (
        <>
          <Card data-au-pair-steps>
            <CardHeader title="The 15 steps" subtitle="In the guide's five stages, each with its responsible team." />
            {AU_PAIR_STAGES.map((stage, si) => (
              <div key={stage}>
                <p className="border-t border-line bg-surface-2 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
                  Stage {si + 1}: {stage}
                </p>
                <ol className="divide-y divide-line">
                  {AU_PAIR_STEPS.filter((s) => s.stage === si + 1).map((s) => {
                    const pos = !step ? "AHEAD" : s.step < step.step ? "DONE" : s.step === step.step ? "NOW" : "AHEAD";
                    return (
                      <li key={s.step} data-step={s.step} data-position={pos} className={cn("flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm", pos === "NOW" && "bg-brand-50/60")}>
                        <span className={cn("w-6 shrink-0 text-right font-mono text-xs", pos === "DONE" ? "text-good-700" : pos === "NOW" ? "font-semibold text-brand-700" : "text-muted")}>{s.step}</span>
                        <span className={cn("font-medium", pos === "AHEAD" ? "text-muted" : "text-ink")}>{s.title}</span>
                        <span className="text-xs text-muted">{AU_PAIR_TEAM_LABEL[s.team]}</span>
                        {s.handoverTo && <span className="text-xs text-muted">Then handed to the {AU_PAIR_TEAM_LABEL[s.handoverTo]}.</span>}
                        {pos === "NOW" && (
                          <ul className="mt-1 w-full list-disc space-y-0.5 pl-12 text-xs text-ink-soft">
                            {s.tasks.map((t) => (
                              <li key={t}>{t}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </Card>

          <Card data-au-pair-actions>
            <CardHeader title="Record this step" subtitle={step ? `${step.title}, recorded by the ${AU_PAIR_TEAM_LABEL[step.team]}.` : "Nothing to record at this status."} />
            <div className="space-y-5 px-4 pb-4">
              {code === "ASSESSMENT" && may("counselling") && (
                <div className="grid gap-4 md:grid-cols-2">
                  <AuPairForm op="counselling" {...f} submitLabel="Save the counselling" secondary className="space-y-2">
                    <div className="grid gap-2">{ticksFor(1)}</div>
                  </AuPairForm>
                  <AuPairForm op="counselling" {...f} submitLabel="The candidate decides to proceed" className="space-y-2">
                    <input type="hidden" name="proceed" value="1" />
                    <p className="text-sm text-ink-soft">Once every counselling point above is covered and saved, record the decision: the file moves to registration.</p>
                    {AU_PAIR_CHECKLISTS[1].map((i) => (done.includes(i.key) ? <input key={i.key} type="hidden" name="done" value={i.key} /> : null))}
                  </AuPairForm>
                </div>
              )}

              {code === "REGISTRATION" && may("registration") && (
                <AuPairForm op="registration" {...f} submitLabel="Record registration" className="grid gap-3 sm:grid-cols-2">
                  {feeRight ? (
                    <Field label="Registration fee (or one-time fee) paid on" htmlFor="ap-regfee">
                      <Input id="ap-regfee" name="registrationFeePaidOn" type="date" defaultValue={app.registrationFeePaidOn ?? ""} />
                      <FieldError name="registrationFeePaidOn" />
                    </Field>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="block text-2xs font-semibold uppercase tracking-wider text-muted">Registration fee</p>
                      <p className="text-sm" data-registration-fee={app.registrationFeePaidOn ? "paid" : "pending"}>
                        {app.registrationFeePaidOn ? `Marked paid on ${fmtDate(app.registrationFeePaidOn)}.` : "Not marked paid yet."}
                      </p>
                      <p className="text-xs text-muted">Marked by someone with the Collect fees right, as on the Fees tab.</p>
                    </div>
                  )}
                  <Field label="Consultancy agreement and declaration form signed on" htmlFor="ap-agreement">
                    <Input id="ap-agreement" name="agreementSignedOn" type="date" defaultValue={app.agreementSignedOn ?? ""} />
                    <FieldError name="agreementSignedOn" />
                  </Field>
                  <div className="grid gap-2 sm:col-span-2">
                    {ticksFor(2)}
                    <FieldError name="done" />
                  </div>
                </AuPairForm>
              )}

              {handover && may("handover") && (
                <div data-au-pair-handover={handover.to}>
                  {handover.to === "DOCUMENTATION" && handoverMissing.length > 0 ? (
                    <p className="text-sm text-warn-700" data-handover-blocked>
                      Still needed before the hand-over: {handoverMissing.join(", ")}.
                    </p>
                  ) : (
                    <AuPairForm op="handover" {...f} submitLabel={handover.label} className="space-y-2">
                      <Field label="Anything the next team should know" htmlFor="ap-handnote" hint="Optional.">
                        <Textarea id="ap-handnote" name="note" rows={2} />
                      </Field>
                    </AuPairForm>
                  )}
                </div>
              )}

              {mentors.length > 0 && (
                <AuPairForm op="mentor" {...f} submitLabel={mentor ? "Change the mentor" : "Assign the mentor"} secondary={code !== "MENTOR_ASSIGNMENT"} className="flex flex-wrap items-end gap-3">
                  <Field label="Mentor" htmlFor="ap-mentor" hint="A documentation officer. The counsellor is told who, to tell the candidate.">
                    <Select id="ap-mentor" name="mentorId" defaultValue={mentor?.id ?? ""}>
                      <option value="">Pick one</option>
                      {mentors.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </Select>
                    <FieldError name="mentorId" />
                  </Field>
                </AuPairForm>
              )}

              {code === "INTERVIEW_PREPARATION" && may("mock") && (
                <AuPairForm op="mock" {...f} submitLabel="Record the mock interview" secondary className="grid gap-3 sm:grid-cols-3">
                  <Field label="Readiness" htmlFor="ap-mock">
                    <Select id="ap-mock" name="result" defaultValue="">
                      <option value="">Pick one</option>
                      <option value="READY">{MOCK_RESULT_LABEL.READY}</option>
                      <option value="NEEDS_WORK">{MOCK_RESULT_LABEL.NEEDS_WORK}</option>
                    </Select>
                    <FieldError name="result" />
                  </Field>
                  <Field label="Held on" htmlFor="ap-mockon">
                    <Input id="ap-mockon" name="on" type="date" />
                  </Field>
                  <div className="space-y-2 self-center">{ticksFor(5)}</div>
                  <div className="sm:col-span-3">
                    <Field label="Areas for improvement and feedback" htmlFor="ap-mockfb">
                      <Textarea id="ap-mockfb" name="feedback" rows={2} />
                      <FieldError name="feedback" />
                    </Field>
                  </div>
                </AuPairForm>
              )}

              {code === "INTERVIEW_PREPARATION" && may("profile") && (
                <AuPairForm op="profile" {...f} submitLabel="Submit the profile to host families" className="grid gap-3 sm:grid-cols-2">
                  <p className="text-sm text-ink-soft sm:col-span-2" data-last-mock={lastMock?.outcome ?? ""}>
                    {lastMock ? `Latest mock interview: ${OUTCOME_TEXT[lastMock.outcome ?? ""] ?? lastMock.outcome}, ${fmtDate(lastMock.on ?? lastMock.createdAt)}.` : "No mock interview recorded yet."} The profile goes out after a mock interview with the candidate ready, and only with the candidate&apos;s consent.
                  </p>
                  <Field label="Candidate consented on" htmlFor="ap-consent">
                    <Input id="ap-consent" name="consentOn" type="date" defaultValue={app.consentOn ?? ""} />
                    <FieldError name="consentOn" />
                  </Field>
                  <div className="self-center">
                    <Checkbox name="done" value="ap6.updated" defaultChecked={done.includes("ap6.updated")} label={AU_PAIR_CHECKLISTS[6][0].label} />
                    <FieldError name="done" />
                  </div>
                </AuPairForm>
              )}

              {code && HOST_FAMILY_AT.includes(code) && may("hostFamily") && (
                <AuPairForm op="hostFamily" {...f} submitLabel={code === "HOST_FAMILY_FOUND" ? "Update the host family" : "Record the interested host family"} className="grid gap-3 sm:grid-cols-3">
                  <Field label="Host family" htmlFor="ap-family">
                    <Input id="ap-family" name="family" defaultValue={app.hostFamily ?? ""} />
                    <FieldError name="family" />
                  </Field>
                  <Field label="Found on" htmlFor="ap-platform">
                    <Select id="ap-platform" name="platform" defaultValue={app.platform?.startsWith("Other") ? "Other" : (app.platform ?? "")}>
                      <option value="">Pick one</option>
                      {AU_PAIR_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                    <FieldError name="platform" />
                  </Field>
                  <Field label="Other platform" htmlFor="ap-platform-other" hint="When found elsewhere.">
                    <Input id="ap-platform-other" name="platformOther" defaultValue={app.platform?.startsWith("Other: ") ? app.platform.slice(7) : ""} />
                  </Field>
                  <div className="grid gap-2 sm:col-span-3">{AU_PAIR_CHECKLISTS[6].slice(1).map((i) => <Checkbox key={i.key} name="done" value={i.key} defaultChecked={done.includes(i.key)} label={i.label} />)}</div>
                  <input type="hidden" name="done" value={done.includes("ap6.updated") ? "ap6.updated" : ""} />
                  <div className="sm:col-span-3">
                    <Field label="Note" htmlFor="ap-family-note" hint="What the family is looking for, for one. Optional.">
                      <Textarea id="ap-family-note" name="note" rows={2} />
                    </Field>
                  </div>
                </AuPairForm>
              )}

              {code === "FAMILY_INTERVIEW" && may("interview") && (
                <AuPairForm op="interview" {...f} submitLabel={app.interviewAt ? "Reschedule the interview" : "Schedule the interview"} className="grid gap-3 sm:grid-cols-3">
                  <p className="text-sm text-ink-soft sm:col-span-3">Online interview with {app.hostFamily ?? "the host family"}.</p>
                  <Field label="Date and time (IST)" htmlFor="ap-at">
                    <Input id="ap-at" name="interviewAt" type="datetime-local" defaultValue={toIstInput(app.interviewAt)} />
                    <FieldError name="interviewAt" />
                  </Field>
                  <Field label="Interview link" htmlFor="ap-link">
                    <Input id="ap-link" name="link" defaultValue={app.interviewLink ?? ""} />
                  </Field>
                  <Field label="Note" htmlFor="ap-inote" hint="A reschedule's reason, for one. Optional.">
                    <Input id="ap-inote" name="note" />
                  </Field>
                </AuPairForm>
              )}

              {code === "FAMILY_INTERVIEW" && app.interviewAt && may("outcome") && (
                <AuPairForm op="outcome" {...f} submitLabel="Record the outcome" className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Outcome with ${app.hostFamily ?? "the host family"}`} htmlFor="ap-outcome">
                    <Select id="ap-outcome" name="outcome" defaultValue="">
                      <option value="">Pick one</option>
                      <option value="SELECTED">{FAMILY_OUTCOME_LABEL.SELECTED}</option>
                      <option value="NOT_SELECTED">{FAMILY_OUTCOME_LABEL.NOT_SELECTED}</option>
                    </Select>
                    <FieldError name="outcome" />
                  </Field>
                  <Field label="The family's feedback" htmlFor="ap-onote" hint="Needed when not selected: the mentor prepares the next round from it.">
                    <Textarea id="ap-onote" name="note" rows={2} />
                    <FieldError name="note" />
                  </Field>
                </AuPairForm>
              )}

              {code && CONTRACT_AT.includes(code) && may("contract") && (
                <AuPairForm op="contract" {...f} submitLabel="Save the contract" className="grid gap-3 sm:grid-cols-4">
                  <Field label="Pocket money (euros a month)" htmlFor="ap-pocket">
                    <Input id="ap-pocket" name="pocketMoney" inputMode="numeric" defaultValue={app.pocketMoney ?? ""} />
                    <FieldError name="pocketMoney" />
                  </Field>
                  <Field label="Working hours a week" htmlFor="ap-hours">
                    <Input id="ap-hours" name="weeklyHours" inputMode="numeric" defaultValue={app.weeklyHours ?? ""} />
                    <FieldError name="weeklyHours" />
                  </Field>
                  <Field label="Duration (months)" htmlFor="ap-duration">
                    <Input id="ap-duration" name="durationMonths" inputMode="numeric" defaultValue={app.durationMonths ?? ""} />
                    <FieldError name="durationMonths" />
                  </Field>
                  <Field label="Signed by the candidate on" htmlFor="ap-signed">
                    <Input id="ap-signed" name="signedOn" type="date" defaultValue={app.contractSignedOn ?? ""} />
                  </Field>
                  <div className="grid gap-2 sm:col-span-4">
                    {ticksFor(8)}
                    <FieldError name="done" />
                  </div>
                </AuPairForm>
              )}

              {code === "PRE_VISA_DOCUMENTS" && (
                <div className="space-y-3" data-visa-gate={visaMissing.length ? "blocked" : "clear"}>
                  <p className={cn("text-sm", visaMissing.length ? "text-warn-700" : "text-muted")}>
                    {visaMissing.length ? `Still needed before the appointment: ${visaMissing.join(", ")}.` : "The payments are verified, the contract is signed and the pre-visa documents are in."}
                    {app.visaReason ? ` Refused before for: ${app.visaReason}.` : ""}
                  </p>
                  {may("payments") && feeRight ? (
                    <AuPairForm op="payments" {...f} submitLabel="Payments verified" secondary className="grid gap-3 sm:grid-cols-2">
                      <p className="text-sm text-ink-soft sm:col-span-2" data-open-invoices={invoices.length}>
                        {invoices.length
                          ? `Fee invoices still open: ${invoices.map((i) => `${i.number ?? "draft"} (${i.state === "WRITTEN_OFF" ? "written off" : i.state === "PART_PAID" ? "part paid" : "unpaid"})`).join(", ")}. Only the head office lets the file go on with these, giving the reason.`
                          : "No fee invoice is open on the Fees tab."}{" "}
                        Every applicable payment is completed before the appointment, as per company policy.
                      </p>
                      <Field label="Verified on" htmlFor="ap-verified">
                        <Input id="ap-verified" name="verifiedOn" type="date" defaultValue={app.paymentsVerifiedOn ?? ""} />
                        <FieldError name="verifiedOn" />
                      </Field>
                      {invoices.length > 0 && (
                        <Field label="Head office reason" htmlFor="ap-payreason">
                          <Textarea id="ap-payreason" name="reason" rows={2} />
                          <FieldError name="reason" />
                        </Field>
                      )}
                    </AuPairForm>
                  ) : (
                    <p className="text-sm" data-payments={app.paymentsVerifiedOn ? "verified" : "pending"}>
                      {app.paymentsVerifiedOn ? `Payments verified on ${fmtDate(app.paymentsVerifiedOn)}.` : "Payments not verified yet: the counsellor or branch head verifies them, with the Collect fees right."}
                    </p>
                  )}
                </div>
              )}

              {code && APPOINTMENT_AT.includes(code) && may("appointment") && (
                <AuPairForm op="appointment" {...f} submitLabel={code === "VISA_APPOINTMENT" ? "Change the appointment" : "Book the appointment"} secondary={code === "VISA_APPOINTMENT"} className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date and time (IST)" htmlFor="ap-appt">
                    <Input id="ap-appt" name="appointmentAt" type="datetime-local" defaultValue={toIstInput(app.appointmentAt)} />
                    <FieldError name="appointmentAt" />
                  </Field>
                  <Field label="Location" htmlFor="ap-place" hint="The German visa application centre, as the jurisdiction decides.">
                    <Input id="ap-place" name="place" defaultValue={app.appointmentPlace ?? ""} />
                    <FieldError name="place" />
                  </Field>
                </AuPairForm>
              )}

              {code === "VISA_APPOINTMENT" && may("submitted") && (
                <AuPairForm op="submitted" {...f} submitLabel="Submitted at the appointment" className="grid gap-3 sm:grid-cols-2">
                  <Field label="Submitted on" htmlFor="ap-submitted">
                    <Input id="ap-submitted" name="submittedOn" type="date" />
                  </Field>
                  <div className="grid gap-2">
                    {ticksFor(10)}
                    <FieldError name="done" />
                  </div>
                </AuPairForm>
              )}

              {code === "VISA_PROCESSING" && may("followUp") && (
                <AuPairForm op="followUp" {...f} submitLabel="Record the follow-up" secondary className="grid gap-3 sm:grid-cols-3">
                  <Field label="Kind" htmlFor="ap-fukind">
                    <Select id="ap-fukind" name="kind" defaultValue="UPDATE">
                      <option value="UPDATE">Status update</option>
                      <option value="DOCUMENTS">More documents asked for</option>
                    </Select>
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="What was learnt or asked for" htmlFor="ap-funote">
                      <Textarea id="ap-funote" name="note" rows={2} />
                      <FieldError name="note" />
                    </Field>
                  </div>
                </AuPairForm>
              )}

              {code === "VISA_PROCESSING" && may("visaDecision") && (
                <AuPairForm op="visaDecision" {...f} submitLabel="Record the visa decision" className="grid gap-3 sm:grid-cols-2">
                  <Field label="Visa outcome" htmlFor="ap-visa">
                    <Select id="ap-visa" name="outcome" defaultValue="">
                      <option value="">Pick one</option>
                      <option value="APPROVED">Approved</option>
                      <option value="REJECTED">Refused</option>
                    </Select>
                    <FieldError name="outcome" />
                  </Field>
                  <Field label="Decided on" htmlFor="ap-decided">
                    <Input id="ap-decided" name="decidedOn" type="date" />
                  </Field>
                  <Field label="Reason for the refusal" htmlFor="ap-reason" hint="Needed when refused.">
                    <Textarea id="ap-reason" name="reason" rows={2} />
                    <FieldError name="reason" />
                  </Field>
                  <Field label="When refused, what happens next" htmlFor="ap-after">
                    <Select id="ap-after" name="afterRefusal" defaultValue="">
                      <option value="">Pick one (when refused)</option>
                      {(Object.keys(AFTER_REFUSAL_LABEL) as AfterRefusal[]).map((k) => (
                        <option key={k} value={k}>
                          {AFTER_REFUSAL_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    <FieldError name="afterRefusal" />
                  </Field>
                </AuPairForm>
              )}

              {code === "VISA_RECEIVED" && may("approval") && (
                <AuPairForm op="approval" {...f} submitLabel="Save the visa approval" className="grid gap-3 sm:grid-cols-2">
                  <Field label="Expected joining date, confirmed with the host family" htmlFor="ap-joining">
                    <Input id="ap-joining" name="joiningOn" type="date" defaultValue={app.joiningOn ?? ""} />
                  </Field>
                  <div className="grid gap-2">{ticksFor(12)}</div>
                </AuPairForm>
              )}

              {code === "PRE_DEPARTURE" && may("departure") && (
                <AuPairForm op="departure" {...f} submitLabel="Record the departure" className="flex flex-wrap items-end gap-3">
                  <Field label="Travelled to Germany on" htmlFor="ap-departed">
                    <Input id="ap-departed" name="departedOn" type="date" defaultValue={app.departedOn ?? ""} />
                    <FieldError name="departedOn" />
                  </Field>
                </AuPairForm>
              )}

              {[13, 14, 15].map((n) =>
                auPairChecklistOpen(n, code) && may("checklist", n) ? (
                  <AuPairForm key={n} op="checklist" {...f} submitLabel={`Save step ${n}`} secondary className="space-y-2">
                    <input type="hidden" name="step" value={n} />
                    <p className="text-sm font-semibold text-ink">
                      Step {n}: {AU_PAIR_STEPS.find((s) => s.step === n)?.title}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">{ticksFor(n)}</div>
                    {n === 15 && (
                      <Field label="From the happy call" htmlFor="ap-happy" hint="How the candidate is settling in, the testimonial or references. Optional.">
                        <Textarea id="ap-happy" name="note" rows={2} />
                      </Field>
                    )}
                  </AuPairForm>
                ) : null,
              )}

              {!step && <p className="text-sm text-muted">This status is not one of the guide&apos;s steps.</p>}
            </div>
          </Card>

          <Card data-au-pair-decisions>
            <CardHeader title="Decisions and dates" />
            <dl className="grid gap-x-8 gap-y-3 px-4 pb-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Registration" data="registration">
                {app.agreementSignedOn ? `Agreement signed ${fmtDate(app.agreementSignedOn)}` : "Not recorded"}
                {app.registrationFeePaidOn ? `, fee paid ${fmtDate(app.registrationFeePaidOn)}` : ""}
              </Fact>
              <Fact label="Mentor" data="mentor">
                {mentor ? `${mentor.name}${mentor.phone ? `, ${mentor.phone}` : ""}` : "Not assigned"}
              </Fact>
              <Fact label="Profile consent" data="consent">
                {app.consentOn ? fmtDate(app.consentOn) : "Not recorded"}
              </Fact>
              <Fact label="Host family" data="family">
                {app.hostFamily ? `${app.hostFamily}${app.platform ? ` (${app.platform})` : ""}` : "Not recorded"}
              </Fact>
              <Fact label="Interview" data="interview">
                {app.interviewAt ? istDateTime(app.interviewAt) : "Not recorded"}
                {app.outcome === "POSITIVE" ? ", selected" : ""}
              </Fact>
              <Fact label="Contract" data="contract">
                {app.pocketMoney != null ? `${app.pocketMoney} euros a month, ${app.weeklyHours ?? "?"} hours a week, ${app.durationMonths ?? "?"} months` : "Not recorded"}
                {app.contractSignedOn ? `; signed ${fmtDate(app.contractSignedOn)}` : ""}
              </Fact>
              <Fact label="Payments verified" data="payments">
                {app.paymentsVerifiedOn ? fmtDate(app.paymentsVerifiedOn) : "Not yet"}
              </Fact>
              <Fact label="Visa appointment" data="appointment">
                {app.appointmentAt ? `${istDateTime(app.appointmentAt)}, ${app.appointmentPlace ?? "location not recorded"}` : "Not recorded"}
              </Fact>
              <Fact label="Visa" data="visa">
                {app.visaDecision === "GRANTED"
                  ? `Approved ${fmtDate(app.visaDecisionOn)}`
                  : app.visaDecision === "REFUSED"
                    ? `Refused ${fmtDate(app.visaDecisionOn)}: ${app.visaReason ?? "reason not recorded"}`
                    : app.visaLodgedOn
                      ? `Submitted ${fmtDate(app.visaLodgedOn)}`
                      : "Not recorded"}
              </Fact>
              <Fact label="Joining date" data="joining">
                {app.joiningOn ? fmtDate(app.joiningOn) : "Not recorded"}
              </Fact>
              <Fact label="Departed" data="departed">
                {app.departedOn ? fmtDate(app.departedOn) : "Not recorded"}
              </Fact>
            </dl>
          </Card>

          <Card data-au-pair-documents>
            <CardHeader title="Documents the guide lists" subtitle="Read from the Documentation tab, where they are asked for, uploaded and checked. Step 3's list holds the hand-over to documentation; step 9's required items hold the visa appointment." />
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
              {[
                { title: "Step 3: collected by the counsellor", list: AU_PAIR_PROFILE_DOCUMENTS, key: "profile" },
                { title: "Step 9: pre-visa documents", list: AU_PAIR_PRE_VISA, key: "pre-visa" },
              ].map((block) => (
                <div key={block.key} data-doc-list={block.key}>
                  <p className="mb-1 text-sm font-semibold text-ink">{block.title}</p>
                  <ul className="space-y-1 text-sm">
                    {block.list.map((d) => {
                      const st = docState(d.typeCodes);
                      return (
                        <li key={d.item} className="flex flex-wrap items-baseline justify-between gap-2" data-doc-item={d.typeCodes.join(",")} data-doc-state={st}>
                          <span>
                            {d.item}
                            {!d.required && <span className="text-xs text-muted"> (if applicable)</span>}
                          </span>
                          <Chip tone={st === "in" ? "ok" : st === "partly" ? "warn" : "neutral"}>{st === "in" ? "In" : st === "partly" ? "With us" : st === "owed" ? "Owed" : "Not on the list"}</Chip>
                        </li>
                      );
                    })}
                  </ul>
                  {block.key === "pre-visa" && <p className="mt-1 text-xs text-muted">Anything more the German authorities ask for is requested as &quot;Other&quot; on the Documentation tab.</p>}
                </div>
              ))}
            </div>
            <p className="px-4 pb-4 text-xs">
              <Link href={`/students/${id}/documentation`} className="font-medium text-brand-600 hover:underline">
                Open the Documentation tab
              </Link>
            </p>
          </Card>

          <Card data-au-pair-email>
            <CardHeader title="Step 2: the registration email" subtitle="The guide has the counsellor / branch team email the Documentation Team and tell them on WhatsApp. The portal does not send it: copy the text into your own mail." />
            <div className="space-y-1.5 px-4 pb-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="font-medium text-ink">Candidate registered</span>
                  <span className="text-muted"> · Sent by the counsellor / branch team</span>
                </p>
                <span className="flex items-center gap-2">
                  {registeredNotice ? <Chip tone="info">Notice raised {fmtDate(registeredNotice.createdAt)}</Chip> : <Chip tone="neutral">No notice yet</Chip>}
                  <CopyEmail text={draft.text} trigger="AU_PAIR_REGISTERED" />
                </span>
              </div>
              <p className="text-xs text-ink-soft" data-email-to>
                To: {to.join("; ") || "Not recorded"}
                {"  "}Cc: {cc.join("; ") || "None"}, and the concerned addresses as per the internal procedure.
              </p>
              {!cc.length && <p className="text-xs text-warn-700">No email on record for the branch head.</p>}
              <details>
                <summary className="cursor-pointer text-xs text-brand-600">Show the email text</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs" data-email-text>
                  {draft.text}
                </pre>
              </details>
              <p className="text-2xs text-muted">{contacts.fromList ? "The address is kept on the Contacts list." : "The guide's address, until the Contacts list carries it."}</p>
            </div>
          </Card>

          <Card data-au-pair-history>
            <CardHeader title="Recorded on this file" subtitle="Every mentor, mock interview, host family, interview round, contract, payment check, visa step, hand-over and notice, newest first. Status moves are on the Applications tab and in the History tab." />
            {events.length ? (
              <ol className="divide-y divide-line">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-2 text-sm" data-event={e.kind} data-outcome={e.outcome ?? ""}>
                    <span className="font-medium text-ink">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                    <span className="text-muted"> · step {e.step}</span>
                    {e.outcome && <span> · {OUTCOME_TEXT[e.outcome] ?? e.outcome}</span>}
                    {e.employer && <span> · {e.employer}</span>}
                    {e.at && <span> · {istDateTime(e.at)}</span>}
                    {e.on && <span> · {fmtDate(e.on)}</span>}
                    {e.detail && <span className="block text-xs text-ink-soft">{e.detail}</span>}
                    <span className="block text-2xs text-muted">
                      {istDateTime(e.createdAt)}
                      {e.by ? `, ${e.by}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted">Nothing recorded yet.</p>
            )}
          </Card>
        </>
      )}
      <p className="text-xs text-muted">
        <Link href="/au-pair" className="font-medium text-brand-600 hover:underline">
          All Au pair files
        </Link>
      </p>
    </div>
  );
}

function Fact({ label, children, data }: { label: string; children: ReactNode; data?: string }) {
  return (
    <div data-fact={data}>
      <dt className="text-2xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
