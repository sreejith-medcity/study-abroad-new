import Link from "next/link";
import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, istDateTime } from "@/lib/format";
import { APP_ROLES, STUDENT_WORK_ROLES } from "@/lib/permissions";
import { GERMAN_LEVELS, MODULE_STATE_LABEL, toIstInput, type ModuleState } from "@/lib/ausbildung";
import {
  FEEDBACK_LABEL,
  FSJ_CHECKLISTS,
  FSJ_DEPARTMENTS,
  FSJ_EMAILS,
  FSJ_PROGRAMMES,
  FSJ_STEPS,
  FSJ_STEP_COUNT,
  FSJ_TRIGGERS,
  LANGUAGE_RESULT_LABEL,
  checklistOpen,
  daysBetween,
  emailDraft,
  feeGate,
  fsjDetailsMissing,
  fsjStepOf,
  handoverFrom,
  isFsjPathway,
  mayDo,
  ownersText,
  resolveRecipients,
  type DraftFacts,
  type FsjOp,
  type FsjPathway,
  type FsjTrigger,
} from "@/lib/fsj";
import { getStudentForUser } from "@/server/queries";
import { FSJ_PAYMENT_STAGES, stagePaymentWords } from "@/lib/fsj-fees";
import { currentFsjApplication, fsjContacts, fsjEventsOf, fsjStudentFacts, germanRecord } from "@/server/fsj";
import { stageGate, studentChecklist, studentContext } from "@/server/documentation";
import { Card, CardHeader, Checkbox, Chip, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { FieldError } from "@/components/action-form";
import { CopyEmail, StepForm } from "./forms";
import { ModuleForm } from "../ausbildung/forms";

export const metadata = { title: "FSJ / BFD" };
export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  LANGUAGE_ASSESSMENT: "Language assessment",
  DOCUMENTS_MISSING: "Documents / details missing",
  FEE_CHECK: "Payment check",
  INTERVIEW: "Interview",
  FEEDBACK: "Employer feedback",
  OFFER: "Offer and contract",
  VFS_SLOT: "VFS slot",
  VISA_SUBMITTED: "Visa submission",
  VISA_DECISION: "Visa decision",
  HANDOVER: "Hand-over",
  NOTICE: "Notice raised",
};

/**
 * The FSJ / BFD file: where it stands on the written process, the decision the
 * step in hand asks for, the emails the guide says to send at each trigger, and
 * every recorded moment. Each department sees the forms for its own steps; the
 * rest read.
 */
export default async function StudentFsjPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const [app, facts, contacts, modules] = await Promise.all([currentFsjApplication(id), fsjStudentFacts(id), fsjContacts(), germanRecord(id)]);
  const mayEditGerman = (STUDENT_WORK_ROLES as readonly string[]).includes(user.role);
  const programme: FsjPathway | null = app && isFsjPathway(app.pathway) ? app.pathway : isFsjPathway(student.preferredPathway) ? student.preferredPathway : null;
  const events = app ? await fsjEventsOf(app.id) : [];
  const step = fsjStepOf(app?.statusCode);
  const days = app?.statusSince ? daysBetween(new Date(app.statusSince), new Date()) : null;
  const may = (op: FsjOp, checklistStep?: number) => !!app && mayDo(op, user.role, { code: app.statusCode, checklistStep });
  const code = app?.statusCode ?? null;
  const fees = app ? feeGate({ registrationFeePaidOn: app.registrationFeePaidOn, applicationFeePaidOn: app.applicationFeePaidOn }) : null;
  const handover = handoverFrom(code);

  // What the branch's hand-over still waits on: the profile documents and the details, named.
  let handoverMissing: string[] = [];
  if (app && code === "DOCUMENT_COLLECTION" && may("handover")) {
    const rows = await studentChecklist(id);
    const ctx = rows.length ? await studentContext(id) : null;
    const gate = rows.length ? stageGate(rows, "PROFILE", ctx?.courseStart ?? null) : null;
    handoverMissing = [
      ...(gate ? gate.missing.map((m) => m.label) : []),
      ...fsjDetailsMissing({
        medcityId: student.medcityId,
        email: student.email,
        parentPhone: facts?.parentPhone,
        germanLevel: facts?.germanLevel,
        gapRecorded: !!facts?.gapRecorded,
        registeredOn: student.createdAt,
        counsellor: student.assignedToId,
        registrationFeePaidOn: app.registrationFeePaidOn,
      }),
    ];
  }

  const f = { studentId: id, applicationId: app?.id ?? "" };
  const lastAssessment = events.find((e) => e.kind === "LANGUAGE_ASSESSMENT") ?? null;

  return (
    <div className="space-y-5" data-fsj-tab>
      <Card data-fsj-process>
        <CardHeader
          title={programme ? `${programme}: ${FSJ_PROGRAMMES[programme].name}` : "FSJ / BFD"}
          subtitle={
            app
              ? step
                ? `Step ${step.step} of ${FSJ_STEP_COUNT}: ${step.title}. Owner: ${ownersText(step)}.`
                : `The application is ${app.statusLabel}, which the written process does not place on a step.`
              : "No open FSJ / BFD application yet. Start one from the Applications tab, on an FSJ or BFD course: the steps begin when it exists."
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
              {app?.handedOverAt && <Chip tone="info">With the desk since {fmtDate(app.handedOverAt)}</Chip>}
            </span>
          }
        />
        <ol className="flex flex-wrap gap-1.5 px-4 pb-3" aria-label="Departments in the written process">
          {FSJ_DEPARTMENTS.map((d, i) => (
            <li
              key={d.key}
              data-department={d.key}
              aria-current={step?.department === d.key ? "step" : undefined}
              className={cn("rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset", step?.department === d.key ? "bg-brand-600 text-white ring-brand-600" : "text-muted ring-line-strong")}
            >
              {i + 1}. {d.label}
            </li>
          ))}
        </ol>
        {app && (
          <p className="border-t border-line px-4 py-3 text-xs text-muted" data-fsj-status={app.statusCode}>
            Status: <span className="font-medium text-ink">{app.statusLabel}</span> since {fmtDate(app.statusSince)}. Application {app.ackNo}, {app.programName}.
          </p>
        )}
        {programme && (
          <dl className="grid gap-x-6 gap-y-1 border-t border-line px-4 py-3 text-sm sm:grid-cols-4" data-programme-facts>
            {FSJ_PROGRAMMES[programme].facts.map((x) => (
              <div key={x.label}>
                <dt className="text-2xs font-semibold uppercase tracking-wide text-muted">{x.label}</dt>
                <dd>{x.value}</dd>
              </div>
            ))}
            <p className="text-2xs text-muted sm:col-span-4">From Medcity&apos;s FSJ & BFD programme sheet. Shown for information; the portal checks nothing against it.</p>
          </dl>
        )}
      </Card>

      {/* Step 1 has the counsellor record the German details; the hand-over reads the level from here or from a German test on the profile. */}
      <Card data-fsj-german>
        <CardHeader title="German record" subtitle={`Current level: ${facts?.germanLevel ?? "Not recorded"}. Each level with the day it was finished; modules cleared go in the note on the profile's German test.`} />
        <ul className="divide-y divide-line">
          {GERMAN_LEVELS.map((level) => {
            const row = modules.find((m) => m.level === level);
            const state = (row?.state ?? "NOT_STARTED") as ModuleState;
            return (
              <li key={level} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2" data-module={level}>
                {mayEditGerman ? (
                  <ModuleForm studentId={id} level={level} state={state} completedOn={row?.completedOn ?? null} />
                ) : (
                  <span className="w-10 font-display text-lg font-semibold text-ink">{level}</span>
                )}
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
          <Card data-fsj-steps>
            <CardHeader title="The 18 steps" subtitle="Each step's owner, from the guide. Decision steps record their outcome below." />
            <ol className="divide-y divide-line">
              {FSJ_STEPS.map((s) => {
                const pos = !step ? "AHEAD" : s.step < step.step ? "DONE" : s.step === step.step ? "NOW" : "AHEAD";
                return (
                  <li key={s.step} data-step={s.step} data-position={pos} className={cn("flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-sm", pos === "NOW" && "bg-brand-50/60")}>
                    <span className={cn("w-6 shrink-0 text-right font-mono text-xs", pos === "DONE" ? "text-good-700" : pos === "NOW" ? "font-semibold text-brand-700" : "text-muted")}>{s.step}</span>
                    <span className={cn("font-medium", pos === "AHEAD" ? "text-muted" : "text-ink")}>{s.title}</span>
                    <span className="text-xs text-muted">{ownersText(s)}</span>
                    {s.handoverTo && <span className="text-xs text-muted">Then handed to the {FSJ_DEPARTMENTS.find((d) => d.key === s.handoverTo)?.label}.</span>}
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
          </Card>

          {/* What the step in hand asks for. */}
          <Card data-fsj-actions>
            <CardHeader title="Record this step" subtitle={step ? `${step.title}, recorded by ${ownersText(step)}.` : "Nothing to record at this status."} />
            <div className="space-y-5 px-4 pb-4">
              {code === "REGISTRATION" && may("registration") && (
                <StepForm op="registration" {...f} submitLabel="Record registration" className="grid gap-3 sm:grid-cols-2">
                  {app.feePlan.stages.registration ? (
                    <div className="space-y-1.5">
                      <p className="block text-2xs font-semibold uppercase tracking-wider text-muted">Registration fee</p>
                      <p className="text-sm" data-registration-fee={app.registrationFeePaidOn ? "paid" : "pending"}>
                        {stagePaymentWords(app.feePlan.stages.registration, fmtDate)}.
                      </p>
                      <p className="text-xs text-muted">From the student&rsquo;s fee invoices, on the Fees tab.</p>
                    </div>
                  ) : (
                    <Field label="Registration fee paid on" htmlFor="fsj-regfee">
                      <Input id="fsj-regfee" name="registrationFeePaidOn" type="date" defaultValue={app.registrationFeePaidOn ?? ""} />
                      <FieldError name="registrationFeePaidOn" />
                    </Field>
                  )}
                  <Field label="Consultancy agreement / declaration signed on" htmlFor="fsj-agreement">
                    <Input id="fsj-agreement" name="agreementSignedOn" type="date" defaultValue={app.agreementSignedOn ?? ""} />
                    <FieldError name="agreementSignedOn" />
                  </Field>
                </StepForm>
              )}

              {handover && may("handover") && (
                <div data-fsj-handover={handover.to}>
                  {handover.to === "DOCUMENTATION" && handoverMissing.length > 0 ? (
                    <p className="text-sm text-warn-700" data-handover-blocked>
                      Still needed before the hand-over: {handoverMissing.join(", ")}.
                    </p>
                  ) : (
                    <StepForm op="handover" {...f} submitLabel={handover.label} className="space-y-2">
                      <Field label="Anything the next department should know" htmlFor="fsj-handnote" hint="Optional.">
                        <Textarea id="fsj-handnote" name="note" rows={2} />
                      </Field>
                    </StepForm>
                  )}
                </div>
              )}

              {code === "DOCUMENT_CROSS_CHECK" && may("missing") && (
                <div className="grid gap-4 md:grid-cols-2">
                  <StepForm op="missing" {...f} submitLabel="Tell the counsellor" secondary className="space-y-2">
                    <Field label="Missing or unclear documents and details" htmlFor="fsj-missing">
                      <Textarea id="fsj-missing" name="missing" rows={3} placeholder="Which documents or details, and what is wrong with them" />
                      <FieldError name="missing" />
                    </Field>
                  </StepForm>
                  <StepForm op="crosscheck" {...f} submitLabel="Cross-check complete" />
                </div>
              )}

              {code && ["LANGUAGE_ASSESSMENT", "LANGUAGE_IMPROVEMENT", "INTERVIEW_PREPARATION"].includes(code) && may("assessment") && (
                <StepForm op="assessment" {...f} submitLabel={app.languageResult ? "Record the re-assessment" : "Record the assessment"} className="grid gap-3 sm:grid-cols-3">
                  <Field label="Level assessed" htmlFor="fsj-level" hint="As the team judged it. The guide sets no minimum yet, so none is applied.">
                    <Input id="fsj-level" name="level" maxLength={60} placeholder="e.g. B1" />
                    <FieldError name="level" />
                  </Field>
                  <Field label="Score / communication sufficient?" htmlFor="fsj-result">
                    <Select id="fsj-result" name="result" defaultValue="">
                      <option value="">Pick one</option>
                      <option value="SUFFICIENT">{LANGUAGE_RESULT_LABEL.SUFFICIENT}</option>
                      <option value="NOT_SUFFICIENT">{LANGUAGE_RESULT_LABEL.NOT_SUFFICIENT}</option>
                    </Select>
                    <FieldError name="result" />
                  </Field>
                  <Field label="Assessed on" htmlFor="fsj-assessed">
                    <Input id="fsj-assessed" name="assessedOn" type="date" />
                  </Field>
                  <div className="sm:col-span-3">
                    <Field label="Recommendation" htmlFor="fsj-recommend" hint="Goes in the assessment report email. Optional.">
                      <Textarea id="fsj-recommend" name="note" rows={2} />
                    </Field>
                  </div>
                </StepForm>
              )}

              {code && ["PAYMENT_CHECK", "APPLICATION_ON_HOLD"].includes(code) && may("feecheck") && (
                <div className="space-y-2">
                  <p className="text-sm" data-fee-gate={fees?.clear ? "clear" : "blocked"}>
                    {fees?.clear ? "Both fees are marked paid." : `Not yet marked paid: ${fees?.missing.join(", ")}. The application does not start until both are in.`}
                  </p>
                  <StepForm op="feecheck" {...f} submitLabel={fees?.clear ? "Start the application" : "Run the payment check"} />
                </div>
              )}

              {code && ["INTERVIEW_PREPARATION", "SECOND_ROUND", "INTERVIEW_SCHEDULED"].includes(code) && may("interview") && (
                <StepForm
                  op="interview"
                  {...f}
                  submitLabel={code === "INTERVIEW_SCHEDULED" ? "Reschedule the interview" : code === "SECOND_ROUND" ? "Schedule the second round" : "Schedule the interview"}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <Field label="Organisation / employer" htmlFor="fsj-employer">
                    <Input id="fsj-employer" name="employer" defaultValue={code === "SECOND_ROUND" || code === "INTERVIEW_SCHEDULED" ? (app.employer ?? "") : ""} />
                    <FieldError name="employer" />
                  </Field>
                  <Field label="Date and time (IST)" htmlFor="fsj-at">
                    <Input id="fsj-at" name="interviewAt" type="datetime-local" defaultValue={code === "INTERVIEW_SCHEDULED" ? toIstInput(app.interviewAt) : ""} />
                    <FieldError name="interviewAt" />
                  </Field>
                  <Field label="Interview link" htmlFor="fsj-link">
                    <Input id="fsj-link" name="link" defaultValue={code === "INTERVIEW_SCHEDULED" ? (app.interviewLink ?? "") : ""} />
                  </Field>
                  <Field label="Note" htmlFor="fsj-inote" hint="A reschedule's reason, for one. Optional.">
                    <Input id="fsj-inote" name="note" />
                  </Field>
                  <Field label="Work responsibilities" htmlFor="fsj-resp">
                    <Textarea id="fsj-resp" name="responsibilities" rows={2} defaultValue={code !== "INTERVIEW_PREPARATION" ? (app.responsibilities ?? "") : ""} />
                  </Field>
                  <Field label="Employer requirements" htmlFor="fsj-req">
                    <Textarea id="fsj-req" name="requirements" rows={2} defaultValue={code !== "INTERVIEW_PREPARATION" ? (app.requirements ?? "") : ""} />
                  </Field>
                </StepForm>
              )}

              {code === "INTERVIEW_SCHEDULED" && may("attended") && <StepForm op="attended" {...f} submitLabel="Interview attended" secondary />}

              {code && ["INTERVIEW_SCHEDULED", "INTERVIEW_ATTENDED"].includes(code) && may("feedback") && (
                <StepForm op="feedback" {...f} submitLabel="Record the feedback" className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Feedback from ${app.employer ?? "the employer"}`} htmlFor="fsj-outcome">
                    <Select id="fsj-outcome" name="outcome" defaultValue="">
                      <option value="">Pick one</option>
                      {(Object.keys(FEEDBACK_LABEL) as (keyof typeof FEEDBACK_LABEL)[]).map((k) => (
                        <option key={k} value={k}>
                          {FEEDBACK_LABEL[k]}
                        </option>
                      ))}
                    </Select>
                    <FieldError name="outcome" />
                  </Field>
                  <Field label="The employer's feedback" htmlFor="fsj-fnote" hint="Needed when not selected: it is shared with the counsellor and the candidate.">
                    <Textarea id="fsj-fnote" name="note" rows={2} />
                    <FieldError name="note" />
                  </Field>
                </StepForm>
              )}

              {code && ["EMPLOYER_CONFIRMED", "OFFER_RECEIVED", "CONTRACT_SIGNED"].includes(code) && may("offer") && (
                <StepForm op="offer" {...f} submitLabel="Save the offer and contract" className="grid gap-3 sm:grid-cols-2">
                  <Field label="Offer letter / contract issued on" htmlFor="fsj-offer">
                    <Input id="fsj-offer" name="offerOn" type="date" defaultValue={app.offerOn ?? ""} />
                  </Field>
                  <Field label="Contract signed and returned on" htmlFor="fsj-contract" hint="With the declaration of acceptance.">
                    <Input id="fsj-contract" name="contractSignedOn" type="date" defaultValue={app.contractSignedOn ?? ""} />
                  </Field>
                </StepForm>
              )}

              {code && ["VFS_SLOT_BOOKING", "PRE_VISA_DOCUMENTS"].includes(code) && may("vfs") && (
                <StepForm op="vfs" {...f} submitLabel="Save the VFS slot" className="flex flex-wrap items-end gap-3">
                  <Field label="VFS slot date" htmlFor="fsj-vfs">
                    <Input id="fsj-vfs" name="vfsSlotOn" type="date" defaultValue={app.vfsSlotOn ?? ""} />
                    <FieldError name="vfsSlotOn" />
                  </Field>
                </StepForm>
              )}

              {code && ["PRE_VISA_DOCUMENTS", "VISA_RESUBMISSION"].includes(code) && may("visaReady") && (
                <div className="space-y-2">
                  <p className="text-sm" data-pre-visa={app.preVisaPaymentOn ? "paid" : "pending"}>
                    {app.feePlan.stages.preVisa
                      ? `Pre-visa payment, from the fee invoices: ${stagePaymentWords(app.feePlan.stages.preVisa, fmtDate)}. It is verified before submission.`
                      : app.preVisaPaymentOn
                        ? `Pre-visa payment received on ${fmtDate(app.preVisaPaymentOn)}.`
                        : "The pre-visa payment is not marked received. It is verified before submission."}
                    {code === "VISA_RESUBMISSION" && app.visaReason ? ` Refused for: ${app.visaReason}.` : ""}
                  </p>
                  <StepForm op="visaReady" {...f} submitLabel="Visa file ready for VFS" secondary />
                </div>
              )}

              {code === "VISA_FILED" && may("visaSubmitted") && (
                <StepForm op="visaSubmitted" {...f} submitLabel="Submitted at VFS" className="flex flex-wrap items-end gap-3">
                  <Field label="Submitted on (biometrics and documents)" htmlFor="fsj-submitted">
                    <Input id="fsj-submitted" name="submittedOn" type="date" />
                  </Field>
                </StepForm>
              )}

              {code && ["VISA_FILED", "VISA_PROCESSING"].includes(code) && may("visaDecision") && (
                <StepForm op="visaDecision" {...f} submitLabel="Record the visa decision" className="grid gap-3 sm:grid-cols-2">
                  <Field label="Visa outcome" htmlFor="fsj-visa">
                    <Select id="fsj-visa" name="outcome" defaultValue="">
                      <option value="">Pick one</option>
                      <option value="APPROVED">Approved</option>
                      <option value="REJECTED">Rejected</option>
                    </Select>
                    <FieldError name="outcome" />
                  </Field>
                  <Field label="Decided on" htmlFor="fsj-decided">
                    <Input id="fsj-decided" name="decidedOn" type="date" />
                  </Field>
                  <Field label="Reason for the refusal" htmlFor="fsj-reason" hint="Needed when rejected.">
                    <Textarea id="fsj-reason" name="reason" rows={2} />
                    <FieldError name="reason" />
                  </Field>
                  <div className="self-center">
                    <Checkbox name="employerStillWilling" value="yes" label="The employer still wants the candidate (correct the file and resubmit)" />
                  </div>
                </StepForm>
              )}

              {code === "VISA_RECEIVED" && may("approval") && (
                <StepForm op="approval" {...f} submitLabel="Save the visa approval" className="grid gap-3 sm:grid-cols-3">
                  <Field label="Joining date confirmed" htmlFor="fsj-joining">
                    <Input id="fsj-joining" name="joiningOn" type="date" defaultValue={app.joiningOn ?? ""} />
                  </Field>
                  {FSJ_CHECKLISTS[15].map((i) => (
                    <div key={i.key} className="self-center">
                      <Checkbox name="done" value={i.key} defaultChecked={app.done.includes(i.key)} label={i.label} />
                    </div>
                  ))}
                </StepForm>
              )}

              {code === "PRE_DEPARTURE" && may("departure") && (
                <StepForm op="departure" {...f} submitLabel="Record the departure" className="flex flex-wrap items-end gap-3">
                  <Field label="Travelled to Germany on" htmlFor="fsj-departed">
                    <Input id="fsj-departed" name="departedOn" type="date" defaultValue={app.departedOn ?? ""} />
                    <FieldError name="departedOn" />
                  </Field>
                </StepForm>
              )}

              {[16, 17, 18].map((n) =>
                checklistOpen(n, code) && may("checklist", n) ? (
                  <StepForm key={n} op="checklist" {...f} submitLabel={`Save step ${n}`} secondary className="space-y-2">
                    <input type="hidden" name="step" value={n} />
                    <p className="text-sm font-semibold text-ink">
                      Step {n}: {FSJ_STEPS.find((s) => s.step === n)?.title}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {FSJ_CHECKLISTS[n].map((i) => (
                        <Checkbox key={i.key} name="done" value={i.key} defaultChecked={app.done.includes(i.key)} label={i.label} />
                      ))}
                    </div>
                  </StepForm>
                ) : null,
              )}

              {!step && <p className="text-sm text-muted">This status is not one of the guide&apos;s steps.</p>}
            </div>
          </Card>

          {/* Where each decision stands, read by everybody. */}
          <Card data-fsj-decisions>
            <CardHeader title="Decisions and dates" />
            <dl className="grid gap-x-8 gap-y-3 px-4 pb-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Fact label="Language assessment" data="language">
                {app.languageResult ? `${app.languageLevel ?? "Level not recorded"}: ${app.languageResult === "SUFFICIENT" ? "sufficient" : "not sufficient"} (${fmtDate(app.languageAssessedOn)})` : "Not recorded"}
              </Fact>
              <Fact label="Application started" data="started">
                {app.applicationStartedOn ? fmtDate(app.applicationStartedOn) : fees?.clear ? "Fees in; waiting for the payment check" : "Not yet: fees pending"}
              </Fact>
              <Fact label="Interview" data="interview">
                {app.employer ? `${app.employer}${app.interviewAt ? `, ${istDateTime(app.interviewAt)}` : ""}` : "Not recorded"}
              </Fact>
              <Fact label="Employer feedback" data="feedback">
                {app.feedback ? FEEDBACK_LABEL[app.feedback] : "Not recorded"}
              </Fact>
              <Fact label="Offer / contract" data="offer">
                {app.offerOn ? `Offer ${fmtDate(app.offerOn)}${app.contractSignedOn ? `, signed ${fmtDate(app.contractSignedOn)}` : ""}` : "Not recorded"}
              </Fact>
              <Fact label="VFS slot" data="vfs">
                {app.vfsSlotOn ? fmtDate(app.vfsSlotOn) : "Not recorded"}
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

          {/* The payment stages. */}
          <Card data-fsj-payments data-fee-plan={app.feePlan.planned ? "yes" : "no"}>
            <CardHeader
              title="Payments"
              subtitle={
                app.feePlan.planned
                  ? "The stages the guide names. Where the student's fee plan has a stage, it is read from their fee invoices on the Fees tab; any other stage is marked here."
                  : "The stages the guide names. The student has no fee plan for the FSJ / BFD steps, so each payment is marked here; with a fee plan the stages are read from the fee invoices."
              }
            />
            <div className="space-y-3 px-4 pb-4">
              {app.feePlan.planned && (
                <dl className="grid gap-3 text-sm sm:grid-cols-4">
                  {FSJ_PAYMENT_STAGES.filter((s) => app.feePlan.stages[s.key]).map((s) => (
                    <div key={s.key} data-payment-stage={s.key} data-payment-source="invoices" data-paid={app[s.field] ? "yes" : "no"}>
                      <dt className="text-2xs font-semibold uppercase tracking-wide text-muted">{s.label}</dt>
                      <dd className="text-ink">{stagePaymentWords(app.feePlan.stages[s.key]!, fmtDate)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-2xs font-semibold uppercase tracking-wide text-muted">Fee invoices</dt>
                    <dd>
                      <Link href={`/students/${id}/fees`} className="text-brand-700 underline-offset-2 hover:underline">
                        Open the Fees tab
                      </Link>
                    </dd>
                  </div>
                </dl>
              )}
              {FSJ_PAYMENT_STAGES.some((s) => app.paymentSource[s.key] === "MARKED") &&
                (may("payments") ? (
                  <StepForm op="payments" {...f} submitLabel="Save payments" secondary className="grid gap-3 sm:grid-cols-4">
                    {app.paymentSource.registration === "MARKED" && (
                      <Field label="Registration fee paid on" htmlFor="fsj-p-reg">
                        <Input id="fsj-p-reg" name="registrationFeePaidOn" type="date" defaultValue={app.registrationFeePaidOn ?? ""} />
                      </Field>
                    )}
                    {app.paymentSource.application === "MARKED" && (
                      <Field label="Application fee paid on" htmlFor="fsj-p-app">
                        <Input id="fsj-p-app" name="applicationFeePaidOn" type="date" defaultValue={app.applicationFeePaidOn ?? ""} />
                      </Field>
                    )}
                    {app.paymentSource.offer === "MARKED" && (
                      <Field label="Offer-letter stage payment on" htmlFor="fsj-p-offer">
                        <Input id="fsj-p-offer" name="offerPaymentOn" type="date" defaultValue={app.offerPaymentOn ?? ""} />
                      </Field>
                    )}
                    {app.paymentSource.preVisa === "MARKED" && (
                      <Field label="Pre-visa payment on" htmlFor="fsj-p-visa">
                        <Input id="fsj-p-visa" name="preVisaPaymentOn" type="date" defaultValue={app.preVisaPaymentOn ?? ""} />
                      </Field>
                    )}
                  </StepForm>
                ) : (
                  <dl className="grid gap-3 text-sm sm:grid-cols-4">
                    {FSJ_PAYMENT_STAGES.filter((s) => app.paymentSource[s.key] === "MARKED").map((s) => (
                      <Fact key={s.key} label={s.label}>
                        {app[s.field] ? fmtDate(app[s.field]!) : "Not recorded"}
                      </Fact>
                    ))}
                  </dl>
                ))}
            </div>
          </Card>

          <EmailMatrix
            app={app}
            stepNow={step?.step ?? 0}
            events={events}
            contacts={contacts.rows.map((r) => r.email).filter((e): e is string => !!e)}
            facts={{
              pathway: app.pathway,
              student: fullName(student),
              medcityId: student.medcityId,
              email: student.email,
              phone: student.phone,
              parentPhone: facts?.parentPhone ?? null,
              germanLevel: facts?.germanLevel ?? null,
              gap: facts?.gap ?? null,
              registeredOn: fmtDate(student.createdAt),
              branch: facts?.branch ?? null,
              counsellor: facts?.counsellor?.name ?? null,
              registrationFeePaidOn: app.registrationFeePaidOn ? fmtDate(app.registrationFeePaidOn) : null,
              missing: events.find((e) => e.kind === "DOCUMENTS_MISSING")?.detail ?? null,
              level: app.languageLevel,
              result: app.languageResult,
              note: lastAssessment?.detail ?? null,
              employer: app.employer,
              interviewAt: app.interviewAt ? istDateTime(app.interviewAt) : null,
              link: app.interviewLink,
              responsibilities: app.responsibilities,
              requirements: app.requirements,
              feesMissing: fees?.missing ?? [],
              joiningOn: app.joiningOn ? fmtDate(app.joiningOn) : null,
              decidedOn: app.visaDecision === "GRANTED" && app.visaDecisionOn ? fmtDate(app.visaDecisionOn) : null,
            }}
            people={{ candidate: student.email, counsellor: facts?.counsellor?.email ?? null, branchHeads: (facts?.heads ?? []).map((h) => h.email).filter((e): e is string => !!e) }}
          />

          <Card data-fsj-history>
            <CardHeader title="Recorded on this file" subtitle="Every assessment, interview, feedback, visa submission, hand-over and notice, newest first. Status moves are on the Applications tab and in the History tab." />
            {events.length ? (
              <ol className="divide-y divide-line">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-2 text-sm" data-event={e.kind} data-outcome={e.outcome ?? ""}>
                    <span className="font-medium text-ink">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                    <span className="text-muted"> · step {e.step}</span>
                    {e.outcome && <span> · {outcomeText(e.kind, e.outcome)}</span>}
                    {e.level && <span> · level {e.level}</span>}
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
        The guide is still to confirm the minimum language level for interview eligibility and the handling of a candidate the employer does not select; the portal stores the level as
        entered and follows the drafted handling. <Link href="/fsj" className="font-medium text-brand-600 hover:underline">All FSJ / BFD files</Link>
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

function outcomeText(kind: string, outcome: string) {
  const map: Record<string, string> = {
    SUFFICIENT: "sufficient",
    NOT_SUFFICIENT: "not sufficient",
    PAID: "both fees paid, application started",
    PENDING: "fee pending, application on hold",
    FIRST: kind === "VISA_SUBMITTED" ? "first submission" : "first interview",
    RESCHEDULED: "rescheduled",
    SECOND_ROUND: kind === "FEEDBACK" ? "second round" : "second-round interview",
    POSITIVE: "positive",
    NOT_SELECTED: "not selected",
    ISSUED: "offer issued",
    SIGNED: "contract signed",
    RESUBMITTED: "resubmitted",
    APPROVED: "approved",
    REJECTED: "rejected",
    DOCUMENTATION: "to the Documentation Department",
    VISA: "to the Visa Team",
    TRAVEL: "to the Travel Desk",
  };
  if (kind === "NOTICE") return FSJ_EMAILS[outcome as FsjTrigger]?.label ?? outcome;
  return map[outcome] ?? outcome;
}

/**
 * Section 3 of the guide, on the file: each trigger, who the guide says to
 * email and copy (resolved to addresses where the file has them), whether the
 * notice was raised, and the text to copy. The portal sends no email.
 */
function EmailMatrix({
  app,
  stepNow,
  events,
  contacts,
  facts,
  people,
}: {
  app: { id: string };
  stepNow: number;
  events: { kind: string; outcome: string | null; createdAt: Date }[];
  contacts: string[];
  facts: DraftFacts;
  people: { candidate: string | null; counsellor: string | null; branchHeads: string[] };
}) {
  return (
    <Card data-fsj-emails={app.id}>
      <CardHeader
        title="Emails the guide asks for"
        subtitle="The portal does not send email. Each trigger raises a notice here for the people named; send the email yourself from your own mail, using the text below."
      />
      <ul className="divide-y divide-line">
        {FSJ_TRIGGERS.map((t) => {
          const m = FSJ_EMAILS[t];
          const to = resolveRecipients(m.to, people, contacts);
          const cc = resolveRecipients(m.cc, people, contacts);
          const raised = events.find((e) => e.kind === "NOTICE" && e.outcome === t);
          const draft = emailDraft(t, facts, { to: to.emails, cc: cc.emails });
          const reached = m.step <= stepNow;
          return (
            <li key={t} className={cn("space-y-1.5 px-4 py-3 text-sm", !reached && !raised && "opacity-70")} data-email={t}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="font-medium text-ink">Step {m.step}: {m.label}</span>
                  <span className="text-muted"> · {m.content}</span>
                </p>
                <span className="flex items-center gap-2">
                  {raised ? <Chip tone="info">Notice raised {fmtDate(raised.createdAt)}</Chip> : <Chip tone="neutral">{reached ? "No notice yet" : "Later step"}</Chip>}
                  <CopyEmail text={draft.text} trigger={t} />
                </span>
              </div>
              <p className="text-xs text-ink-soft" data-email-to>
                To: {to.emails.join("; ") || "Not recorded"}
                {"  "}Cc: {cc.emails.join("; ") || "None"}
              </p>
              {[...to.unknown, ...cc.unknown].length > 0 && <p className="text-xs text-warn-700">No email on record for {[...new Set([...to.unknown, ...cc.unknown])].join(", ")}.</p>}
              <details>
                <summary className="cursor-pointer text-xs text-brand-600">Show the email text</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs" data-email-text>
                  {draft.text}
                </pre>
              </details>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
