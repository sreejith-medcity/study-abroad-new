"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { STUDENT_WORK_ROLES } from "@/lib/permissions";
import { fromIstInput, fullName, istDateTime } from "@/lib/format";
import type { FormState } from "@/lib/form-state";
import {
  ASSESSMENT_AT,
  FEEDBACK_AT,
  FEE_CHECK_AT,
  FSJ_CHECKLISTS,
  FSJ_DEPARTMENT_LABEL,
  FSJ_EMAILS,
  FSJ_TRAVEL_ROLES,
  FSJ_VISA_ROLES,
  OFFER_AT,
  VFS_AT,
  VISA_DECISION_AT,
  afterAssessment,
  afterChecklist,
  afterFeedback,
  afterOffer,
  afterVisaDecision,
  checklistOpen,
  feeGate,
  feeGateText,
  fsjDetailsMissing,
  fsjStepOf,
  handoverCheck,
  interviewCheck,
  mayDo,
  mergeChecklist,
  visaReadyCheck,
  type Feedback,
  type FsjOp,
  type FsjTrigger,
  type LanguageResult,
  type VisaOutcome,
} from "@/lib/fsj";
import { getStudentForUser } from "./queries";
import { changeStatus, StatusChangeError, tellDeskFsjArrived } from "./applications";
import { stageGate, studentChecklist, studentContext, syncChecklist } from "./documentation";
import { documentationIds, notifyUsers, partnerRecipients } from "./notify";
import { updateTracked } from "./record-history";
import { appendLedger } from "./ledger";
import { currentFsjApplication, fsjStudentFacts, notSelectedBy, roleIds, type FsjApplication } from "./fsj";

const OPS: FsjOp[] = ["registration", "payments", "handover", "missing", "crosscheck", "assessment", "feecheck", "interview", "attended", "feedback", "offer", "vfs", "visaReady", "visaSubmitted", "visaDecision", "approval", "checklist", "departure"];

const text = (v: FormDataEntryValue | null, max = 200) => {
  const t = String(v ?? "").trim().slice(0, max);
  return t || null;
};
/** A date box's value, or null; anything that is not a real date is refused rather than guessed at. */
const day = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : null;
};
const today = () => new Date().toISOString().slice(0, 10);
const bad = (field: string, message: string): FormState => ({ fieldErrors: { [field]: [message] }, error: message });

class Refused extends Error {}

/**
 * Every FSJ / BFD step recorded on the student's FSJ / BFD tab.
 *
 * One action, with the step in "op", because every step does the same things
 * in the same order: check the person may open the student and may record this
 * step, check the file is at a step where it can be recorded, write the fields
 * through updateTracked so the History tab has them, keep the moment in
 * fsj_events, move the status (through changeStatus, which applies the fee
 * gate), and tell the department that has the file next. The emails the guide
 * asks for are not sent: each trigger is a notice in the portal, and the tab
 * shows the addresses and the text to copy.
 */
export async function fsjStepAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  const student = await getStudentForUser(user, studentId);
  const op = String(fd.get("op") ?? "") as FsjOp;
  if (!OPS.includes(op)) return { error: "That step could not be recorded." };

  const app = await currentFsjApplication(studentId);
  if (!app) return { error: "There is no open FSJ / BFD application. Start one from the Applications tab, on an FSJ or BFD course." };
  const sentFor = String(fd.get("applicationId") ?? "");
  if (sentFor && sentFor !== app.id) return { error: "This file has a newer FSJ / BFD application than the page shows. Reload the page." };

  const checklistStep = op === "checklist" ? Number(fd.get("step")) : undefined;
  if (!mayDo(op, user.role, { code: app.statusCode, checklistStep })) {
    const owner = op === "checklist" ? fsjStepOf(FSJ_STEPS_AT[checklistStep ?? 0])?.department : (fsjStepOf(app.statusCode)?.department ?? null);
    return { error: `Your role does not record this step${owner ? `: it belongs to the ${FSJ_DEPARTMENT_LABEL[owner]}` : ""}.` };
  }

  const ctx = new Ctx(user.id, user, student, app);
  try {
    const result = await RUN[op](ctx, fd);
    revalidatePath(`/students/${studentId}`, "layout");
    revalidatePath("/fsj");
    return result;
  } catch (e) {
    if (e instanceof Refused || e instanceof StatusChangeError) {
      revalidatePath(`/students/${studentId}`, "layout");
      return { error: e.message };
    }
    throw e;
  }
}

/** A status code that sits on each checklist's step, for naming the owner in a refusal. */
const FSJ_STEPS_AT: Record<number, string> = { 15: "VISA_RECEIVED", 16: "PRE_DEPARTURE", 17: "JOINED", 18: "HAPPY_CALL" };

type Student = Awaited<ReturnType<typeof getStudentForUser>>;
type User = Awaited<ReturnType<typeof requireUser>>;
type TrackSet = Parameters<typeof updateTracked<"application">>[2];

/** What every step needs at hand: who, which student, which application, and the shared moves. */
class Ctx {
  constructor(
    readonly by: string,
    readonly user: User,
    readonly student: Student,
    readonly app: FsjApplication,
  ) {}

  get name() {
    return fullName(this.student);
  }
  get href() {
    return `/students/${this.student.id}/fsj`;
  }

  /** Writes fields on the application through updateTracked, so the change is on the History tab. */
  async track(set: TrackSet, action: string) {
    await updateTracked("application", this.app.id, { ...set, updatedAt: new Date() }, { by: this.by, action });
  }

  /** Moves the status by its code, through changeStatus, which applies the fee gate and tells the branch. */
  async move(code: string, reason?: string) {
    if (code === this.app.statusCode) return;
    const to = await db.query.statusDefinitions.findFirst({
      where: and(eq(schema.statusDefinitions.pathway, this.app.pathway), eq(schema.statusDefinitions.code, code), eq(schema.statusDefinitions.active, true)),
    });
    if (!to) throw new Refused(`The status ${code} is not in the ${this.app.pathway} status flow. Run deploy/fsj-bfd-process.sql, or add it under Status flows.`);
    await changeStatus(this.user, this.app.id, to.id, reason, { viaFsj: true });
  }

  /** Keeps one moment of the process in fsj_events. */
  async log(kind: (typeof schema.fsjEventKind.enumValues)[number], step: number, f: { outcome?: string | null; level?: string | null; employer?: string | null; at?: Date | null; on?: string | null; link?: string | null; detail?: string | null } = {}) {
    await db.insert(schema.fsjEvents).values({ applicationId: this.app.id, studentId: this.student.id, kind, step, createdById: this.by, ...f });
  }

  /** The counsellor and the branch head, who are copied on most of the guide's emails. */
  branch() {
    return partnerRecipients(this.student.orgId, this.student.assignedToId);
  }

  /**
   * One trigger of the email matrix: a notice in the portal to the people
   * named, and the moment kept so the tab can say when it was raised. The
   * email itself is the department's to send, from the text on the tab.
   */
  async notice(trigger: FsjTrigger, ids: (string | null | undefined)[], title: string, body: string) {
    const m = FSJ_EMAILS[trigger];
    await notifyUsers(ids, title, `${body} Email (${m.content.toLowerCase()}): the addresses and the text to copy are on step ${m.step} of the FSJ / BFD tab. The portal does not send it.`, this.href);
    await this.log("NOTICE", m.step, { outcome: trigger, detail: title });
  }
}

const RUN: Record<FsjOp, (c: Ctx, fd: FormData) => Promise<FormState>> = {
  /* Step 2: the registration fee and the agreement. */
  async registration(c, fd) {
    // Where the student's fee plan has the registration fee, its invoice says
    // whether it is paid; otherwise the day is given here, as before.
    const fromInvoices = c.app.paymentSource.registration === "INVOICES";
    const feeOn = fromInvoices ? c.app.registrationFeePaidOn : day(fd.get("registrationFeePaidOn"));
    const agreementOn = day(fd.get("agreementSignedOn"));
    if (!feeOn) {
      return fromInvoices
        ? { error: "The registration fee invoice is not paid yet. Record the payment on the Fees tab, then record the registration." }
        : bad("registrationFeePaidOn", "Give the day the registration fee was paid");
    }
    if (!agreementOn) return bad("agreementSignedOn", "Give the day the agreement / declaration was signed");
    await c.track(fromInvoices ? { fsjAgreementSignedOn: agreementOn } : { fsjRegistrationFeePaidOn: feeOn, fsjAgreementSignedOn: agreementOn }, "fsj.registration");
    if (c.app.statusCode !== "REGISTRATION") return { ok: "Registration details saved." };
    await c.move("DOCUMENT_COLLECTION");
    await c.notice("REGISTERED", await c.branch(), `${c.name}: registered for ${c.app.pathway}`, "Registration recorded. Document collection (step 3) is next.");
    await audit(c.by, "fsj.registration", "application", c.app.id, { feeOn, agreementOn });
    return { ok: "Registration recorded. Send the registration email from step 2 (the portal does not send it). Document collection is next." };
  },

  /* The payment stages the guide names: registration, application, offer letter, pre-visa. */
  async payments(c, fd) {
    // A stage the student's fee plan covers is read from its invoices, so only
    // the other stages are marked here; the days marked earlier are kept.
    const marked = (stage: keyof FsjApplication["paymentSource"], field: string) => (c.app.paymentSource[stage] === "MARKED" ? day(fd.get(field)) : undefined);
    const all = {
      fsjRegistrationFeePaidOn: marked("registration", "registrationFeePaidOn"),
      fsjApplicationFeePaidOn: marked("application", "applicationFeePaidOn"),
      fsjOfferPaymentOn: marked("offer", "offerPaymentOn"),
      fsjPreVisaPaymentOn: marked("preVisa", "preVisaPaymentOn"),
    };
    const values = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined)) as Partial<Record<keyof typeof all, string | null>>;
    if (!Object.keys(values).length) return { error: "Every payment stage is read from the student's fee invoices. Record payments on the Fees tab." };
    const before = feeGate({ registrationFeePaidOn: c.app.registrationFeePaidOn, applicationFeePaidOn: c.app.applicationFeePaidOn });
    const after = feeGate({
      registrationFeePaidOn: all.fsjRegistrationFeePaidOn === undefined ? c.app.registrationFeePaidOn : all.fsjRegistrationFeePaidOn,
      applicationFeePaidOn: all.fsjApplicationFeePaidOn === undefined ? c.app.applicationFeePaidOn : all.fsjApplicationFeePaidOn,
    });
    await c.track(values, "fsj.payments");
    await audit(c.by, "fsj.payments", "application", c.app.id, values);
    // The guide: once the fee is paid, proceed. The documentation team starts
    // the application, so they are told the moment both fees are in.
    if (!before.clear && after.clear && FEE_CHECK_AT.includes(c.app.statusCode)) {
      await notifyUsers(await documentationIds(), `${c.name}: fees received`, "The registration and application fees are now marked paid. Run the payment check on step 6 to start the application.", c.href);
      return { ok: "Payments saved. The documentation team has been told to start the application." };
    }
    return { ok: "Payments saved." };
  },

  /* The three hand-overs the guide marks: to documentation, to the visa team, to the travel desk. */
  async handover(c, fd) {
    const note = text(fd.get("note"), 400);
    const check = handoverCheck(c.app.statusCode, { contractSignedOn: c.app.contractSignedOn, joiningOn: c.app.joiningOn });
    if (!check.ok) return { error: check.why };
    const h = check.handover;
    if (h.to === "DOCUMENTATION") {
      // The profile documents (Section 2, what the counsellor collects) and
      // the details the guide lists, named rather than hidden.
      await syncChecklist(c.student.id);
      const rows = await studentChecklist(c.student.id);
      const sctx = await studentContext(c.student.id);
      const gate = rows.length ? stageGate(rows, "PROFILE", sctx.courseStart) : { clear: true, missing: [] as { label: string }[] };
      const facts = await fsjStudentFacts(c.student.id);
      const details = fsjDetailsMissing({
        medcityId: c.student.medcityId,
        email: c.student.email,
        parentPhone: facts?.parentPhone,
        germanLevel: facts?.germanLevel,
        gapRecorded: !!facts?.gapRecorded,
        registeredOn: c.student.createdAt,
        counsellor: c.student.assignedToId,
        registrationFeePaidOn: c.app.registrationFeePaidOn,
      });
      const missing = [...gate.missing.map((m) => m.label), ...details];
      if (missing.length) return { error: `Still needed before the hand-over: ${missing.join(", ")}.` };
      if (!c.app.handedOverAt) {
        const now = new Date();
        // The hand-over goes on the student's line of the ownership ledger, written by updateTracked.
        await c.track({ handedOverAt: now, handedOverById: c.by, handoverNote: note }, "application.handover");
      }
      await c.move(h.toCode);
      await c.log("HANDOVER", 3, { outcome: h.to, detail: note });
      await audit(c.by, "application.handover", "application", c.app.id, { via: "fsj", note });
      await tellDeskFsjArrived({ studentId: c.student.id, student: c.name, branch: c.student.orgId, because: `document collection is done${note ? `. From the branch: ${note}` : ""}` });
      return { ok: "Handed to the Documentation Department. The document cross-check is next." };
    }
    await c.move(h.toCode);
    // A department hand-over moves who carries the file, so it goes on the
    // student's line of the ownership ledger, with the owner and branch as they stand.
    await appendLedger(db, [
      {
        kind: "HANDOVER",
        entity: "student",
        entityId: c.student.id,
        orgId: c.student.orgId,
        ownerId: c.student.assignedToId,
        detail: `${c.app.pathway} file ${c.app.ackNo} handed to the ${FSJ_DEPARTMENT_LABEL[h.to]}`,
        actorId: c.by,
      },
    ]);
    await c.log("HANDOVER", fsjStepOf(h.fromCode)?.step ?? 0, { outcome: h.to, detail: note });
    await audit(c.by, "fsj.handover", "application", c.app.id, { to: h.to, note });
    const ids = h.to === "VISA" ? await roleIds(FSJ_VISA_ROLES) : await roleIds(FSJ_TRAVEL_ROLES);
    await notifyUsers(ids, `${c.name}: ${c.app.pathway} file handed to the ${FSJ_DEPARTMENT_LABEL[h.to]}`, h.to === "VISA" ? "The contract is signed. Book the VFS slot (step 11)." : `The visa is approved and the joining date is ${c.app.joiningOn}. The pre-departure process (step 16) is next.`, c.href);
    return { ok: `Handed to the ${FSJ_DEPARTMENT_LABEL[h.to]}.` };
  },

  /* Step 4: something is missing; the counsellor collects it. */
  async missing(c, fd) {
    if (c.app.statusCode !== "DOCUMENT_CROSS_CHECK") return { error: "Missing documents are raised during the document cross-check." };
    const list = text(fd.get("missing"), 1000);
    if (!list) return bad("missing", "Say what is missing or unclear");
    await c.log("DOCUMENTS_MISSING", 4, { detail: list });
    await c.notice("DOCUMENTS_MISSING", await c.branch(), `${c.name}: documents or details missing`, `The documentation team needs: ${list}.`);
    return { ok: "The counsellor and the branch head have been told what is missing." };
  },

  /* Step 4 done: on to the language assessment. */
  async crosscheck(c) {
    if (c.app.statusCode !== "DOCUMENT_CROSS_CHECK") return { error: "The file is not at the document cross-check." };
    await c.move("LANGUAGE_ASSESSMENT");
    return { ok: "Cross-check complete. The language assessment is next." };
  },

  /* Step 5, and the re-assessments of step 7. The level and result are the team's; no pass mark is applied. */
  async assessment(c, fd) {
    if (!ASSESSMENT_AT.includes(c.app.statusCode)) return { error: "An assessment is recorded at the language assessment, the improvement classes or interview preparation." };
    const level = text(fd.get("level"), 60);
    const result = String(fd.get("result") ?? "") as LanguageResult;
    const on = day(fd.get("assessedOn")) ?? today();
    const note = text(fd.get("note"), 600);
    if (!level) return bad("level", "Give the level assessed, as the team judged it");
    if (result !== "SUFFICIENT" && result !== "NOT_SUFFICIENT") return bad("result", "Say whether the level and communication are sufficient");
    const reassessed = c.app.languageResult != null;
    await c.track({ fsjLanguageLevel: level, fsjLanguageResult: result, fsjLanguageAssessedOn: on }, "fsj.assessment");
    await c.log("LANGUAGE_ASSESSMENT", fsjStepOf(c.app.statusCode)?.step ?? 5, { level, outcome: result, on, detail: note });
    const to = afterAssessment(result, !!c.app.applicationStartedOn);
    await c.move(to);
    await c.notice(
      "ASSESSMENT_DONE",
      await c.branch(),
      `${c.name}: language ${reassessed ? "re-assessment" : "assessment"} recorded`,
      `Level ${level}, ${result === "SUFFICIENT" ? "sufficient" : "not sufficient"}.`,
    );
    return {
      ok:
        result === "SUFFICIENT"
          ? to === "PAYMENT_CHECK"
            ? "Sufficient: eligible for interview. The payment check is next."
            : "Sufficient: back to interview preparation."
          : "Not sufficient: language improvement classes, then a re-assessment.",
    };
  },

  /* Step 6: both fees in starts the application; otherwise it is on hold and the counsellor is told. */
  async feecheck(c) {
    if (!FEE_CHECK_AT.includes(c.app.statusCode)) return { error: "The payment check is done after a sufficient language assessment." };
    const gate = feeGate({ registrationFeePaidOn: c.app.registrationFeePaidOn, applicationFeePaidOn: c.app.applicationFeePaidOn });
    if (gate.clear) {
      await c.track({ fsjApplicationStartedOn: today() }, "fsj.application_started");
      await c.move("INTERVIEW_PREPARATION");
      await c.log("FEE_CHECK", 6, { outcome: "PAID" });
      await notifyUsers(await c.branch(), `${c.name}: application started`, "Both fees are in. Interview preparation (step 7) has begun.", c.href);
      return { ok: "Both fees are paid. The application has started: interview preparation is next." };
    }
    await c.move("APPLICATION_ON_HOLD");
    await c.log("FEE_CHECK", 6, { outcome: "PENDING", detail: gate.missing.join(", ") });
    await c.notice("FEE_PENDING", await c.branch(), `${c.name}: application on hold, fee pending`, `Not yet marked paid: ${gate.missing.join(", ")}. The application does not start until it is received.`);
    return { error: feeGateText(gate.missing) };
  },

  /* Step 8: the interview, with everything the guide's email carries. */
  async interview(c, fd) {
    const employer = text(fd.get("employer"), 160) ?? "";
    const raw = String(fd.get("interviewAt") ?? "").trim();
    const at = raw ? fromIstInput(raw) : null;
    const link = text(fd.get("link"), 400);
    const responsibilities = text(fd.get("responsibilities"), 1000);
    const requirements = text(fd.get("requirements"), 1000);
    const note = text(fd.get("note"), 400);
    if (!employer) return bad("employer", "Name the organisation / employer");
    if (!at) return bad("interviewAt", "Give the date and the time");
    const check = interviewCheck({
      code: c.app.statusCode,
      fees: { registrationFeePaidOn: c.app.registrationFeePaidOn, applicationFeePaidOn: c.app.applicationFeePaidOn },
      applicationStarted: !!c.app.applicationStartedOn,
      languageResult: c.app.languageResult,
      employer,
      currentEmployer: c.app.employer,
      notSelectedBy: await notSelectedBy(c.app.id),
    });
    if (!check.ok) return { error: check.why };
    const kind = c.app.statusCode === "SECOND_ROUND" ? "SECOND_ROUND" : c.app.statusCode === "INTERVIEW_SCHEDULED" ? "RESCHEDULED" : "FIRST";
    await c.track(
      { fsjEmployer: employer, fsjInterviewAt: at, fsjInterviewLink: link, fsjResponsibilities: responsibilities, fsjRequirements: requirements, fsjFeedback: null },
      "fsj.interview",
    );
    await c.log("INTERVIEW", 8, { employer, at, link, outcome: kind, detail: note });
    await c.move("INTERVIEW_SCHEDULED");
    await c.notice("INTERVIEW_SCHEDULED", await c.branch(), `${c.name}: interview ${kind === "RESCHEDULED" ? "rescheduled" : "scheduled"} with ${employer}`, `${istDateTime(at)}.`);
    return { ok: `Interview ${kind === "RESCHEDULED" ? "rescheduled" : "scheduled"} with ${employer}. Send the interview email from step 8.` };
  },

  /* Step 9: the candidate attended; the employer's feedback is awaited. */
  async attended(c) {
    if (c.app.statusCode !== "INTERVIEW_SCHEDULED") return { error: "There is no scheduled interview to mark attended." };
    await c.move("INTERVIEW_ATTENDED");
    return { ok: "Interview attended. Record the employer's feedback when it comes." };
  },

  /* Step 9's decision: positive, a second round, or not selected (back to preparation, another employer). */
  async feedback(c, fd) {
    if (!FEEDBACK_AT.includes(c.app.statusCode)) return { error: "Feedback is recorded after an interview." };
    const outcome = String(fd.get("outcome") ?? "") as Feedback;
    const note = text(fd.get("note"), 1000);
    if (!["POSITIVE", "SECOND_ROUND", "NOT_SELECTED"].includes(outcome)) return bad("outcome", "Pick the employer's feedback");
    if (outcome === "NOT_SELECTED" && !note) return bad("note", "Write the employer's feedback, to share with the counsellor and the candidate");
    const employer = c.app.employer;
    await c.track(
      outcome === "NOT_SELECTED"
        ? { fsjFeedback: outcome, fsjEmployer: null, fsjInterviewAt: null, fsjInterviewLink: null, fsjResponsibilities: null, fsjRequirements: null }
        : { fsjFeedback: outcome },
      "fsj.feedback",
    );
    await c.log("FEEDBACK", 9, { employer, outcome, detail: note });
    await c.move(afterFeedback(outcome));
    const who = employer ?? "The employer";
    const branch = await c.branch();
    if (outcome === "NOT_SELECTED") {
      await notifyUsers(branch, `${c.name}: not selected by ${who}`, `Feedback to share with the candidate: ${note}. Interview preparation continues and the profile goes to other employers.`, c.href);
      return { ok: `Not selected by ${who}. The feedback has gone to the counsellor; interview preparation continues for another employer.` };
    }
    if (outcome === "SECOND_ROUND") {
      await notifyUsers(branch, `${c.name}: shortlisted by ${who}`, "Several candidates were shortlisted; the employer decides after a second-round interview.", c.href);
      return { ok: `Shortlisted by ${who}. Schedule the second-round interview.` };
    }
    await notifyUsers(branch, `${c.name}: confirmed by ${who}`, "The employer confirms. The offer letter / contract follows; collect the offer-letter stage payment.", c.href);
    return { ok: `Confirmed by ${who}. Record the offer letter when it comes.` };
  },

  /* Step 10: the offer letter, then the signed contract. */
  async offer(c, fd) {
    if (!OFFER_AT.includes(c.app.statusCode)) return { error: "The offer is recorded once the employer confirms." };
    const offerOn = day(fd.get("offerOn"));
    const contractSignedOn = day(fd.get("contractSignedOn"));
    const next = afterOffer({ offerOn, contractSignedOn });
    if (!next.ok) return { error: next.why };
    await c.track({ fsjOfferOn: offerOn, fsjContractSignedOn: contractSignedOn }, "fsj.offer");
    if (offerOn && offerOn !== c.app.offerOn) await c.log("OFFER", 10, { outcome: "ISSUED", on: offerOn, employer: c.app.employer });
    if (contractSignedOn && contractSignedOn !== c.app.contractSignedOn) await c.log("OFFER", 10, { outcome: "SIGNED", on: contractSignedOn, employer: c.app.employer });
    if (next.code) await c.move(next.code);
    if (offerOn && !c.app.offerOn) {
      await notifyUsers(await c.branch(), `${c.name}: offer letter issued`, `${c.app.employer ?? "The employer"} has issued the offer letter / contract. Collect the offer-letter stage payment.`, c.href);
    }
    return { ok: contractSignedOn ? "Contract signed. Hand the file to the visa team." : offerOn ? "Offer letter recorded. The counsellor has been told to collect the offer-letter stage payment." : "Saved." };
  },

  /* Step 11: the VFS slot. */
  async vfs(c, fd) {
    if (!VFS_AT.includes(c.app.statusCode)) return { error: "The VFS slot is booked by the visa team once the file is with them." };
    const slot = day(fd.get("vfsSlotOn"));
    if (!slot) return bad("vfsSlotOn", "Give the VFS slot date");
    await c.track({ fsjVfsSlotOn: slot }, "fsj.vfs_slot");
    await c.log("VFS_SLOT", 11, { on: slot });
    if (c.app.statusCode === "VFS_SLOT_BOOKING") await c.move("PRE_VISA_DOCUMENTS");
    await notifyUsers(await c.branch(), `${c.name}: VFS slot ${slot}`, "The visa team has booked the VFS submission date.", c.href);
    return { ok: "VFS slot saved. Visa document preparation is next." };
  },

  /* Step 12: the file is ready for VFS, once the pre-visa payment is in. */
  async visaReady(c) {
    const check = visaReadyCheck(c.app.statusCode, c.app.preVisaPaymentOn);
    if (!check.ok) return { error: check.why };
    await c.move("VISA_FILED");
    return { ok: "The visa file is ready. The candidate attends VFS on the slot date." };
  },

  /* Step 13: submitted at VFS; the embassy processes it. */
  async visaSubmitted(c, fd) {
    if (c.app.statusCode !== "VISA_FILED") return { error: "The submission is recorded once the file is ready for VFS." };
    const on = day(fd.get("submittedOn")) ?? today();
    const resubmission = c.app.visaDecision === "REFUSED" || !!c.app.visaReason;
    await c.track({ visaLodgedOn: on, visaDecision: null, visaDecisionOn: null }, "fsj.visa_submitted");
    await c.log("VISA_SUBMITTED", 13, { on, outcome: resubmission ? "RESUBMITTED" : "FIRST" });
    await c.move("VISA_PROCESSING");
    return { ok: `${resubmission ? "Resubmitted" : "Submitted"} at VFS. The visa is processing.` };
  },

  /* Step 14's decision: approved, or refused with the reason and whether the employer still wants the candidate. */
  async visaDecision(c, fd) {
    if (!VISA_DECISION_AT.includes(c.app.statusCode)) return { error: "The visa decision is recorded after the submission." };
    const outcome = String(fd.get("outcome") ?? "") as VisaOutcome;
    if (outcome !== "APPROVED" && outcome !== "REJECTED") return bad("outcome", "Pick the visa outcome");
    const on = day(fd.get("decidedOn")) ?? today();
    const reason = text(fd.get("reason"), 600);
    const willing = fd.get("employerStillWilling") === "yes";
    const next = afterVisaDecision({ outcome, reason, employerStillWilling: willing });
    if (!next.ok) return bad("reason", next.why);
    await c.track({ visaDecision: outcome === "APPROVED" ? "GRANTED" : "REFUSED", visaDecisionOn: on, fsjVisaReason: outcome === "APPROVED" ? c.app.visaReason : reason }, "fsj.visa_decision");
    await c.log("VISA_DECISION", 14, { outcome, on, detail: outcome === "REJECTED" ? `${reason}. Employer still willing: ${willing ? "yes" : "no"}` : null });
    await c.move(next.code, next.code === "VISA_REJECTED" ? (reason ?? undefined) : undefined);
    if (next.code === "VISA_RECEIVED") {
      await c.notice("VISA_APPROVED", await c.branch(), `${c.name}: visa approved`, "Confirm the joining date; the pre-departure process follows.");
      return { ok: "Visa approved. Confirm the joining date, then hand the file to the travel desk." };
    }
    if (next.code === "VISA_RESUBMISSION") {
      await notifyUsers([...(await documentationIds()), ...(await c.branch())], `${c.name}: visa refused, to resubmit`, `Reason: ${reason}. The employer still wants the candidate: correct the file and resubmit.`, c.href);
      return { ok: "Visa refused. The employer still wants the candidate, so the file is corrected and resubmitted." };
    }
    await notifyUsers(await c.branch(), `${c.name}: visa refused`, `Reason: ${reason}. The employer is not taking the candidate, so the case is closed as visa rejected.`, c.href);
    return { ok: "Visa refused and the case closed as visa rejected." };
  },

  /* Step 15: passport back, employer told, joining date confirmed. */
  async approval(c, fd) {
    if (c.app.statusCode !== "VISA_RECEIVED") return { error: "These are recorded once the visa is approved." };
    const joiningOn = day(fd.get("joiningOn"));
    const sent = fd.getAll("done").map(String);
    await c.track({ fsjJoiningOn: joiningOn, fsjDone: mergeChecklist(c.app.done ?? [], 15, sent) }, "fsj.visa_approval");
    return { ok: joiningOn ? "Saved. Hand the file to the travel desk when ready." : "Saved. Confirm the joining date before the hand-over to the travel desk." };
  },

  /* Steps 16 to 18: the travel desk's and the follow-up's checklists. */
  async checklist(c, fd) {
    const step = Number(fd.get("step"));
    if (!FSJ_CHECKLISTS[step] || step === 15) return { error: "That checklist could not be saved." };
    if (!checklistOpen(step, c.app.statusCode)) return { error: "That checklist opens when the file reaches its step." };
    const done = mergeChecklist(c.app.done ?? [], step, fd.getAll("done").map(String));
    await c.track({ fsjDone: done }, `fsj.checklist_${step}`);
    const to = afterChecklist(step, c.app.statusCode, done);
    if (to) await c.move(to);
    return { ok: to ? "Saved. The post-arrival follow-up has begun." : "Saved." };
  },

  /* Step 17: the candidate departs. */
  async departure(c, fd) {
    if (c.app.statusCode !== "PRE_DEPARTURE") return { error: "The departure is recorded from the pre-departure process." };
    const on = day(fd.get("departedOn"));
    if (!on) return bad("departedOn", "Give the day the candidate travelled");
    await c.track({ fsjDepartedOn: on }, "fsj.departure");
    await c.move("JOINED");
    await notifyUsers(await c.branch(), `${c.name}: departed for Germany`, "The post-arrival follow-up (step 18) includes a happy call, a testimonial and a reference.", c.href);
    return { ok: "Departure recorded. The post-arrival follow-up is next." };
  },
};
