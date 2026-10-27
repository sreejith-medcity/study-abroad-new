"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, DOCUMENTATION_ROLES, STUDENT_WORK_ROLES } from "@/lib/permissions";
import { fmtDate, fromIstInput, fullName, istDateTime } from "@/lib/format";
import type { FormState } from "@/lib/form-state";
import {
  AFTER_REFUSAL_LABEL,
  APPOINTMENT_AT,
  AU_PAIR_CHECKLISTS,
  AU_PAIR_DESK_ROLES,
  AU_PAIR_STEPS,
  AU_PAIR_TEAM_LABEL,
  AU_PAIR_TRAVEL_ROLES,
  CONTRACT_AT,
  HOST_FAMILY_AT,
  PAYMENTS_AT,
  afterAuPairChecklist,
  afterOutcome,
  afterVisaDecision,
  auPairChecklistOpen,
  auPairDetailsMissing,
  auPairHandoverCheck,
  auPairStepOf,
  contractCheck,
  familyRefusal,
  mayDoAuPair,
  mergeAuPairChecklist,
  outcomeCheck,
  platformText,
  profileCheck,
  registrationNoticeText,
  type AfterRefusal,
  type AuPairOp,
  type FamilyOutcome,
  type MockResult,
  type VisaOutcome,
} from "@/lib/au-pair";
import { getStudentForUser } from "./queries";
import { changeStatus, StatusChangeError, tellDeskAuPairArrived } from "./applications";
import { notifyUsers, partnerRecipients } from "./notify";
import { updateTracked } from "./record-history";
import { appendLedger } from "./ledger";
import { feeAccess } from "./student-fees";
import { fsjStudentFacts, roleIds } from "./fsj";
import {
  AU_PAIR_MENTOR_PART,
  FAMILY_WITHDRAWN,
  auPairContacts,
  auPairMentor,
  auPairStatusGate,
  currentAuPairApplication,
  declinedBy,
  lastMock,
  openInvoices,
  profileMissing,
  type AuPairApplication,
} from "./au-pair";

const OPS: AuPairOp[] = ["counselling", "registration", "handover", "mentor", "mock", "profile", "hostFamily", "interview", "outcome", "contract", "payments", "appointment", "submitted", "followUp", "visaDecision", "approval", "checklist", "departure"];

const text = (v: FormDataEntryValue | null, max = 200) => {
  const t = String(v ?? "").trim().slice(0, max);
  return t || null;
};
/** A date box's value, or null; anything that is not a real date is refused rather than guessed at. */
const day = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : null;
};
/** A whole number box: null when empty, NaN when it is not a whole number, so the rule can name it. */
const whole = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
};
const today = () => new Date().toISOString().slice(0, 10);
const bad = (field: string, message: string): FormState => ({ fieldErrors: { [field]: [message] }, error: message });
const ticks = (fd: FormData) => fd.getAll("done").map(String);

class Refused extends Error {}

/**
 * Every Au pair step recorded on the student's Au pair tab, the way
 * fsjStepAction records the FSJ / BFD steps: one action with the step in
 * "op". It checks the person may open the student and may record this step,
 * checks the status move it leads to would be accepted (the status exists, a
 * reason is given where one is required, the gate before the visa appointment
 * passes) before anything is written, writes the fields through
 * updateTracked so the History tab has them, keeps the moment in fsj_events,
 * moves the status through changeStatus and tells the team that has the file
 * next. The portal sends no email: the registration email's text is on the tab.
 */
export async function auPairStepAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  const student = await getStudentForUser(user, studentId);
  const op = String(fd.get("op") ?? "") as AuPairOp;
  if (!OPS.includes(op)) return { error: "That step could not be recorded." };

  const app = await currentAuPairApplication(studentId);
  if (!app) return { error: "There is no open Au pair application. Start one from the Applications tab, on an Au pair course." };
  const sentFor = String(fd.get("applicationId") ?? "");
  if (sentFor && sentFor !== app.id) return { error: "This file has a newer Au pair application than the page shows. Reload the page." };

  const checklistStep = op === "checklist" ? Number(fd.get("step")) : undefined;
  if (!mayDoAuPair(op, user.role, { code: app.statusCode, checklistStep })) {
    const team = op === "checklist" ? AU_PAIR_STEPS.find((s) => s.step === checklistStep)?.team : auPairStepOf(app.statusCode)?.team;
    return { error: `Your role does not record this step${team ? `: it belongs to the ${AU_PAIR_TEAM_LABEL[team]}` : ""}.` };
  }

  const ctx = new Ctx(user, student, app);
  try {
    const result = await RUN[op](ctx, fd);
    revalidatePath(`/students/${studentId}`, "layout");
    revalidatePath("/au-pair");
    return result;
  } catch (e) {
    if (e instanceof Refused || e instanceof StatusChangeError) {
      revalidatePath(`/students/${studentId}`, "layout");
      return { error: e.message };
    }
    throw e;
  }
}

type Student = Awaited<ReturnType<typeof getStudentForUser>>;
type User = Awaited<ReturnType<typeof requireUser>>;
type TrackSet = Parameters<typeof updateTracked<"application">>[2];
type EventKind = (typeof schema.fsjEventKind.enumValues)[number];

/** What every step needs at hand: who, which student, which application, and the shared moves. */
class Ctx {
  constructor(
    readonly user: User,
    readonly student: Student,
    readonly app: AuPairApplication,
  ) {}

  get by() {
    return this.user.id;
  }
  get name() {
    return fullName(this.student);
  }
  get href() {
    return `/students/${this.student.id}/au-pair`;
  }

  async track(set: TrackSet, action: string) {
    await updateTracked("application", this.app.id, { ...set, updatedAt: new Date() }, { by: this.by, action });
  }

  /**
   * Checks, before the step writes anything, that moving the file to this
   * status would be accepted. Throws the refusal; returns the status, or null
   * where the file is already there. The gate reads the facts as they will
   * be once this step's own fields are written (passed in `after`).
   */
  async ready(code: string, reason?: string, after: { paymentsVerifiedOn?: string | null; contractSignedOn?: string | null } = {}) {
    if (code === this.app.statusCode) return null;
    const to = await db.query.statusDefinitions.findFirst({
      where: and(eq(schema.statusDefinitions.pathway, "AU_PAIR"), eq(schema.statusDefinitions.code, code), eq(schema.statusDefinitions.active, true)),
    });
    if (!to) throw new Refused(`The status ${code} is not in the Au pair status flow. Run deploy/au-pair-pathway.sql, or add it under Status flows.`);
    if (to.requiresReason && !reason?.trim()) throw new Refused(`A reason is required for "${to.label}".`);
    const refusal = await auPairStatusGate(
      {
        studentId: this.student.id,
        fsjPreVisaPaymentOn: after.paymentsVerifiedOn !== undefined ? after.paymentsVerifiedOn : this.app.paymentsVerifiedOn,
        fsjContractSignedOn: after.contractSignedOn !== undefined ? after.contractSignedOn : this.app.contractSignedOn,
      },
      this.app.statusCode,
      code,
    );
    if (refusal) throw new Refused(refusal.why);
    return to;
  }

  /** Moves the status by its code, through changeStatus, which applies the gate again and tells the branch. */
  async move(code: string, reason?: string) {
    const to = await this.ready(code, reason);
    if (!to) return;
    await changeStatus(this.user, this.app.id, to.id, reason, { viaAuPair: true });
  }

  /** Keeps one moment of the process in fsj_events, which the Au pair file shares with FSJ / BFD. */
  async log(kind: EventKind, step: number, f: { outcome?: string | null; level?: string | null; employer?: string | null; at?: Date | null; on?: string | null; link?: string | null; detail?: string | null } = {}) {
    await db.insert(schema.fsjEvents).values({ applicationId: this.app.id, studentId: this.student.id, kind, step, createdById: this.by, ...f });
  }

  /** The counsellor and the branch head. */
  branch() {
    return partnerRecipients(this.student.orgId, this.student.assignedToId);
  }

  /** The Overseas desk: documentation, mentors, placement and visa. */
  desk() {
    return roleIds(AU_PAIR_DESK_ROLES);
  }

  done(step: number, sent: string[]) {
    return mergeAuPairChecklist(this.app.done ?? [], step, sent);
  }
}

const RUN: Record<AuPairOp, (c: Ctx, fd: FormData) => Promise<FormState>> = {
  /* Step 1: the counselling points, and the candidate's decision to proceed. */
  async counselling(c, fd) {
    if (c.app.statusCode !== "ASSESSMENT") return { error: "The counselling is recorded at the enquiry, before registration." };
    const done = c.done(1, ticks(fd));
    const proceed = fd.get("proceed") === "1";
    if (proceed) {
      const left = AU_PAIR_CHECKLISTS[1].filter((i) => !done.includes(i.key));
      if (left.length) return { error: `Before registration, the counselling still has to cover: ${left.map((i) => i.label.toLowerCase()).join("; ")}.` };
      await c.ready("REGISTRATION");
    }
    await c.track({ fsjDone: done }, "au_pair.counselling");
    if (!proceed) return { ok: "Counselling saved." };
    await c.move("REGISTRATION");
    return { ok: "The candidate proceeds. Registration and the agreement (step 2) are next." };
  },

  /* Step 2: the candidate form, the registration fee, the agreement and the email to the documentation team. */
  async registration(c, fd) {
    if (c.app.statusCode !== "REGISTRATION") return { error: "The registration is recorded at the registration step." };
    const agreementOn = day(fd.get("agreementSignedOn"));
    const done = c.done(2, ticks(fd));
    let markOn: string | null = null;
    // Marking a fee paid needs the Collect fees right, as on the Fees tab;
    // anyone else records the registration against a fee already marked.
    if ((await feeAccess(c.user)).act) {
      markOn = day(fd.get("registrationFeePaidOn"));
      if (!markOn) return bad("registrationFeePaidOn", "Give the day the registration fee (or one-time fee) was paid");
    } else if (!c.app.registrationFeePaidOn) {
      return { error: "The registration fee is not marked paid. Marking a fee paid needs the Collect fees right, as on the Fees tab: ask the counsellor or branch head who took it." };
    }
    if (!agreementOn) return bad("agreementSignedOn", "Give the day the consultancy agreement and declaration form were signed");
    if (!done.includes("ap2.form")) return bad("done", "Complete the registration form (candidate form) first");
    await c.ready("DOCUMENT_COLLECTION");
    await c.track({ ...(markOn ? { fsjRegistrationFeePaidOn: markOn } : {}), fsjAgreementSignedOn: agreementOn, fsjDone: done }, "au_pair.registration");
    await c.move("DOCUMENT_COLLECTION");

    // The email to aupair@miak.in is the branch's to send; the portal tells
    // the branch so and keeps the text to copy on the tab. The documentation
    // department hears from the portal at the hand-over (step 3), the first
    // moment it can open the file: notices reach only people who can.
    const [facts, contacts] = await Promise.all([fsjStudentFacts(c.student.id), auPairContacts()]);
    const to = contacts.rows.map((r) => r.email).filter((e): e is string => !!e);
    const heads = facts?.heads ?? [];
    const cc = heads.map((h) => h.email).filter((e): e is string => !!e);
    const noAddress = heads.length ? [] : ["the branch head"];
    await notifyUsers(await c.branch(), `${c.name}: Au pair registration email to send`, registrationNoticeText(to, cc, noAddress), c.href);
    await c.log("NOTICE", 2, { outcome: "REGISTERED", detail: "Registration email to send to the documentation team" });
    await audit(c.by, "au_pair.registration", "application", c.app.id, { feeOn: markOn ?? c.app.registrationFeePaidOn, agreementOn });
    return { ok: "Registration recorded. Send the registration email from step 2 (the portal does not send it) and tell the team on WhatsApp. Document collection is next." };
  },

  /* The four hand-overs: to documentation, to the placement team, to the visa team, to the travel desk. */
  async handover(c, fd) {
    const note = text(fd.get("note"), 400);
    const check = auPairHandoverCheck(c.app.statusCode, { hostFamily: c.app.hostFamily, contractSignedOn: c.app.contractSignedOn, joiningOn: c.app.joiningOn });
    if (!check.ok) return { error: check.why };
    const h = check.handover;
    if (h.to === "DOCUMENTATION") {
      const facts = await fsjStudentFacts(c.student.id);
      const missing = [
        ...(await profileMissing(c.student.id, { sync: true })),
        ...auPairDetailsMissing({
          medcityId: c.student.medcityId,
          email: c.student.email,
          germanLevel: facts?.germanLevel,
          counsellor: c.student.assignedToId,
          registrationFeePaidOn: c.app.registrationFeePaidOn,
          agreementSignedOn: c.app.agreementSignedOn,
        }),
      ];
      if (missing.length) return { error: `Still needed before the hand-over: ${missing.join(", ")}.` };
      await c.ready(h.toCode);
      // The hand-over opens the file to the documentation department and goes
      // on the student's line of the ownership ledger, written by updateTracked.
      if (!c.app.handedOverAt) await c.track({ handedOverAt: new Date(), handedOverById: c.by, handoverNote: note }, "application.handover");
      await c.move(h.toCode);
      await c.log("HANDOVER", 3, { outcome: h.to, detail: note });
      await audit(c.by, "application.handover", "application", c.app.id, { via: "au_pair", note });
      await tellDeskAuPairArrived({ studentId: c.student.id, student: c.name, branch: c.student.orgId, because: `document collection is done${note ? `. From the branch: ${note}` : ""}` });
      return { ok: "Handed to the Documentation Department. They assign the mentor next." };
    }
    if (h.to === "PLACEMENT" && !(c.app.done ?? []).includes("ap6.shared")) return { error: "Share the host family's contact number with the candidate first, and tick it on step 6." };
    await c.move(h.toCode);
    await appendLedger(db, [
      {
        kind: "HANDOVER",
        entity: "student",
        entityId: c.student.id,
        orgId: c.student.orgId,
        ownerId: c.student.assignedToId,
        detail: `Au pair file ${c.app.ackNo} handed to the ${AU_PAIR_TEAM_LABEL[h.to]}`,
        actorId: c.by,
      },
    ]);
    await c.log("HANDOVER", auPairStepOf(h.fromCode)?.step ?? 0, { outcome: h.to, detail: note });
    await audit(c.by, "au_pair.handover", "application", c.app.id, { to: h.to, note });
    if (h.to === "PLACEMENT") {
      await notifyUsers(await c.desk(), `${c.name}: Au pair candidate handed to the placement team`, `${c.app.hostFamily} is interested. Schedule the host family interview (step 7).`, c.href);
    } else if (h.to === "VISA") {
      await notifyUsers(await c.desk(), `${c.name}: Au pair file handed to the visa team`, "The host family contract is signed. Pre-visa documentation (step 9) is next.", c.href);
      await notifyUsers(await c.branch(), `${c.name}: payments to verify before the visa appointment`, "The visa team has the file. Every applicable payment must be completed before the appointment: verify the payments on step 9 of the Au pair tab.", c.href);
    } else {
      await notifyUsers(await roleIds(AU_PAIR_TRAVEL_ROLES), `${c.name}: Au pair file handed to the travel desk`, `The visa is approved and the expected joining date is ${fmtDate(c.app.joiningOn)}. Pre-departure preparation (step 13) is next.`, c.href);
    }
    return { ok: `Handed to the ${AU_PAIR_TEAM_LABEL[h.to]}.` };
  },

  /* Step 4: the documentation department assigns the mentor and tells the counsellor who. */
  async mentor(c, fd) {
    if ((auPairStepOf(c.app.statusCode)?.step ?? 0) < 4) return { error: "The mentor is assigned once the file is with the documentation department." };
    const mentorId = String(fd.get("mentorId") ?? "").trim();
    if (!mentorId) return bad("mentorId", "Pick the mentor");
    const mentor = await db.query.users.findFirst({ where: eq(schema.users.id, mentorId) });
    if (!mentor?.active || !(DOCUMENTATION_ROLES as readonly string[]).includes(mentor.role)) return bad("mentorId", "The mentor has to be a documentation officer");
    const current = await auPairMentor(c.student.id);
    if (current?.id === mentorId && c.app.statusCode !== "MENTOR_ASSIGNMENT") return { ok: `${mentor.name} is already the mentor.` };
    const moves = c.app.statusCode === "MENTOR_ASSIGNMENT";
    if (moves) await c.ready("INTERVIEW_PREPARATION");
    await db.transaction(async (tx) => {
      await tx.delete(schema.studentPeople).where(and(eq(schema.studentPeople.studentId, c.student.id), eq(schema.studentPeople.part, AU_PAIR_MENTOR_PART)));
      await tx.insert(schema.studentPeople).values({ studentId: c.student.id, userId: mentorId, part: AU_PAIR_MENTOR_PART, addedById: c.by });
    });
    await c.log("MENTOR", 4, { outcome: current ? "CHANGED" : "ASSIGNED", detail: mentor.name });
    await audit(c.by, "au_pair.mentor", "student", c.student.id, { applicationId: c.app.id, from: current?.id ?? null, to: mentorId });
    if (moves) await c.move("INTERVIEW_PREPARATION");
    const contact = [mentor.phone, mentor.email].filter(Boolean).join(", ");
    await notifyUsers(await c.branch(), `${c.name}: Au pair mentor is ${mentor.name}`, `Tell the candidate their mentor's details${contact ? `: ${contact}` : ""}. The guide has the documentation team tell you on WhatsApp too.`, c.href);
    await notifyUsers([mentorId], `${c.name}: you are the Au pair mentor`, "Interview preparation (step 5) is yours: general and situation-based preparation and mock interviews with feedback.", c.href);
    return { ok: `${mentor.name} is the mentor. The counsellor has been told${moves ? "; interview preparation is next" : ""}.` };
  },

  /* Step 5: a mock interview with its feedback, every one kept. */
  async mock(c, fd) {
    if (c.app.statusCode !== "INTERVIEW_PREPARATION") return { error: "Mock interviews are recorded during interview preparation." };
    const result = String(fd.get("result") ?? "") as MockResult;
    if (result !== "READY" && result !== "NEEDS_WORK") return bad("result", "Say whether the candidate is ready");
    const feedback = text(fd.get("feedback"), 1000);
    if (!feedback) return bad("feedback", "Write the areas for improvement and the feedback given");
    const on = day(fd.get("on")) ?? today();
    await c.track({ fsjDone: c.done(5, ticks(fd)) }, "au_pair.preparation");
    await c.log("MOCK_INTERVIEW", 5, { outcome: result, on, detail: feedback });
    return { ok: result === "READY" ? "Mock interview recorded: ready. Submit the profile once the candidate consents." : "Mock interview recorded: more preparation first." };
  },

  /* Step 6: the profile goes to host families, with the candidate's consent. */
  async profile(c, fd) {
    const consentOn = day(fd.get("consentOn"));
    const done = c.done(6, ticks(fd));
    const check = profileCheck({ code: c.app.statusCode, lastMock: await lastMock(c.app.id), consentOn });
    if (!check.ok) return check.field ? bad(check.field, check.why) : { error: check.why };
    if (!done.includes("ap6.updated")) return bad("done", "Update the candidate's profile first, and tick it");
    await c.ready("PROFILE_SUBMITTED");
    await c.track({ auPairConsentOn: consentOn, fsjDone: done }, "au_pair.profile");
    await c.log("PROFILE_SUBMITTED", 6, { on: consentOn, detail: "Consent recorded; profile submitted to host families" });
    await c.move("PROFILE_SUBMITTED");
    await notifyUsers(await c.branch(), `${c.name}: Au pair profile submitted`, "With the candidate's consent, the mentor is looking for host families.", c.href);
    return { ok: "Profile submitted with the candidate's consent. Record the host family when one is interested." };
  },

  /* Step 6: an interested host family, where it was found, and its number shared with the candidate. */
  async hostFamily(c, fd) {
    if (!HOST_FAMILY_AT.includes(c.app.statusCode)) return { error: "A host family is recorded once the profile is submitted." };
    const family = text(fd.get("family"), 160);
    if (!family) return bad("family", "Name the host family");
    const p = platformText(String(fd.get("platform") ?? ""), text(fd.get("platformOther"), 100));
    if (!p.ok) return bad("platform", p.why);
    const refused = familyRefusal(family, await declinedBy(c.app.id));
    if (refused) return bad("family", refused);
    const done = c.done(6, ticks(fd));
    await c.ready("HOST_FAMILY_FOUND");
    await c.track({ fsjEmployer: family, auPairPlatform: p.text, fsjInterviewAt: null, fsjInterviewLink: null, fsjFeedback: null, fsjDone: done }, "au_pair.host_family");
    await c.log("HOST_FAMILY", 6, { employer: family, outcome: p.text, detail: text(fd.get("note"), 400) });
    await c.move("HOST_FAMILY_FOUND");
    return { ok: done.includes("ap6.shared") ? `${family} recorded. Hand the candidate to the placement team.` : `${family} recorded. Share the family's number with the candidate, then hand over to the placement team.` };
  },

  /* Step 7: the online interview with the host family, every round kept. */
  async interview(c, fd) {
    if (c.app.statusCode !== "FAMILY_INTERVIEW") return { error: "The interview is scheduled by the placement team once the candidate is with them." };
    const raw = String(fd.get("interviewAt") ?? "").trim();
    const at = raw ? fromIstInput(raw) : null;
    if (!at) return bad("interviewAt", "Give the date and the time");
    const link = text(fd.get("link"), 400);
    const kind = c.app.interviewAt ? "RESCHEDULED" : "FIRST";
    await c.track({ fsjInterviewAt: at, fsjInterviewLink: link, fsjFeedback: null }, "au_pair.interview");
    await c.log("INTERVIEW", 7, { employer: c.app.hostFamily, at, link, outcome: kind, detail: text(fd.get("note"), 400) });
    await notifyUsers(await c.branch(), `${c.name}: host family interview ${kind === "RESCHEDULED" ? "rescheduled" : "scheduled"}`, `With ${c.app.hostFamily ?? "the host family"}, ${istDateTime(at)}${link ? `, ${link}` : ""}. The placement team tells the candidate the details.`, c.href);
    return { ok: `Interview ${kind === "RESCHEDULED" ? "rescheduled" : "scheduled"}. Tell the candidate the details, then record the outcome.` };
  },

  /* Step 7's decision: selected goes to the contract; not selected goes back to interview preparation. */
  async outcome(c, fd) {
    const check = outcomeCheck({ code: c.app.statusCode, interviewAt: c.app.interviewAt });
    if (!check.ok) return { error: check.why };
    const outcome = String(fd.get("outcome") ?? "") as FamilyOutcome;
    if (outcome !== "SELECTED" && outcome !== "NOT_SELECTED") return bad("outcome", "Pick the outcome");
    const note = text(fd.get("note"), 1000);
    if (outcome === "NOT_SELECTED" && !note) return bad("note", "Write the family's feedback, for the mentor's next round of preparation");
    const to = afterOutcome(outcome);
    await c.ready(to);
    const family = c.app.hostFamily;
    await c.track(
      outcome === "SELECTED" ? { fsjFeedback: "POSITIVE" } : { fsjFeedback: "NOT_SELECTED", fsjEmployer: null, auPairPlatform: null, fsjInterviewAt: null, fsjInterviewLink: null },
      "au_pair.outcome",
    );
    await c.log("FEEDBACK", 7, { employer: family, outcome, detail: note });
    await c.move(to);
    const mentor = await auPairMentor(c.student.id);
    if (outcome === "NOT_SELECTED") {
      await notifyUsers([...(await c.branch()), mentor?.id], `${c.name}: not selected by ${family ?? "the host family"}`, `Feedback: ${note}. Back to interview preparation; the placement continues with other families.`, c.href);
      return { ok: `Not selected by ${family ?? "the host family"}. Back to interview preparation (step 5); the placement continues.` };
    }
    await notifyUsers([...(await c.branch()), mentor?.id], `${c.name}: selected by ${family ?? "the host family"}`, "The placement team receives and verifies the contract next (step 8).", c.href);
    return { ok: `Selected by ${family ?? "the host family"}. Record the contract's terms when it comes.` };
  },

  /* Step 8: the contract's terms as verified and explained, then the candidate's signature. */
  async contract(c, fd) {
    if (!CONTRACT_AT.includes(c.app.statusCode)) return { error: "The contract is recorded once the host family selects the candidate." };
    const terms = { pocketMoney: whole(fd.get("pocketMoney")), weeklyHours: whole(fd.get("weeklyHours")), durationMonths: whole(fd.get("durationMonths")), signedOn: day(fd.get("signedOn")) };
    const done = c.done(8, ticks(fd));
    const next = contractCheck(terms);
    if (!next.ok) return bad(next.field, next.why);
    if (terms.signedOn && !done.includes("ap8.explained")) return bad("done", "Explain the terms to the candidate before the signature, and tick it");
    await c.ready(next.code, undefined, { contractSignedOn: terms.signedOn });
    await c.track(
      { auPairPocketMoney: terms.pocketMoney, auPairWeeklyHours: terms.weeklyHours, auPairDurationMonths: terms.durationMonths, fsjContractSignedOn: terms.signedOn, fsjDone: done },
      "au_pair.contract",
    );
    const changed = terms.pocketMoney !== c.app.pocketMoney || terms.weeklyHours !== c.app.weeklyHours || terms.durationMonths !== c.app.durationMonths || terms.signedOn !== c.app.contractSignedOn;
    if (changed) {
      await c.log("CONTRACT", 8, {
        employer: c.app.hostFamily,
        outcome: terms.signedOn ? "SIGNED" : "TERMS",
        on: terms.signedOn,
        detail: `Pocket money ${terms.pocketMoney ?? "not recorded"} euros a month, ${terms.weeklyHours ?? "not recorded"} hours a week, ${terms.durationMonths ?? "not recorded"} months`,
      });
    }
    await c.move(next.code);
    return { ok: terms.signedOn ? "Contract signed. Send it to the family, then hand the file to the visa team." : "Contract terms saved." };
  },

  /* Step 9: every applicable payment completed, verified before the appointment. */
  async payments(c, fd) {
    if (!PAYMENTS_AT.includes(c.app.statusCode)) return { error: "The payments are verified while the visa team prepares the pre-visa documents." };
    if (!(await feeAccess(c.user)).act) return { error: "Verifying the payments needs the Collect fees right, as on the Fees tab. Ask the counsellor or branch head." };
    const on = day(fd.get("verifiedOn"));
    if (!on) return bad("verifiedOn", "Give the day the payments were verified");
    const open = await openInvoices(c.student.id);
    const reason = text(fd.get("reason"), 600);
    if (open.length) {
      const list = open.map((i) => `${i.number ?? "draft"} (${i.state === "WRITTEN_OFF" ? "written off" : i.state === "PART_PAID" ? "part paid" : "unpaid"})`).join(", ");
      if (!(ADMIN_ROLES as readonly string[]).includes(c.user.role)) return { error: `Fee invoices still open: ${list}. Every applicable payment is completed before the appointment; the head office decides otherwise.` };
      if (!reason) return bad("reason", `Fee invoices still open: ${list}. Give the reason the head office lets the file go on`);
      await audit(c.by, "au_pair.payment_override", "application", c.app.id, { invoices: open.map((i) => i.number ?? i.id), reason });
    }
    await c.track({ fsjPreVisaPaymentOn: on }, "au_pair.payments");
    await c.log("FEE_CHECK", 9, { outcome: "VERIFIED", on, detail: reason });
    await audit(c.by, "au_pair.payments", "application", c.app.id, { on });
    await notifyUsers(await c.desk(), `${c.name}: Au pair payments verified`, "Every applicable payment is completed. The visa appointment can be booked once the pre-visa documents are in.", c.href);
    return { ok: "Payments verified." };
  },

  /* Step 10: the appointment, with the date, time and location; the gate is checked here. */
  async appointment(c, fd) {
    if (!APPOINTMENT_AT.includes(c.app.statusCode)) return { error: "The appointment is booked from pre-visa documentation." };
    const raw = String(fd.get("appointmentAt") ?? "").trim();
    const at = raw ? fromIstInput(raw) : null;
    if (!at) return bad("appointmentAt", "Give the appointment's date and time");
    const place = text(fd.get("place"), 200);
    if (!place) return bad("place", "Give the location (the visa application centre)");
    await c.ready("VISA_APPOINTMENT");
    await c.track({ auPairAppointmentAt: at, auPairAppointmentPlace: place }, "au_pair.appointment");
    await c.log("APPOINTMENT", 10, { at, detail: place, outcome: c.app.appointmentAt ? "REBOOKED" : "BOOKED" });
    await c.move("VISA_APPOINTMENT");
    await notifyUsers(await c.branch(), `${c.name}: visa appointment ${istDateTime(at)}`, `At ${place}. The visa team tells the candidate and guides them on the submission.`, c.href);
    return { ok: "Appointment booked. Tell the candidate the date, time and location." };
  },

  /* Step 10: submitted at the appointment; the visa processes. */
  async submitted(c, fd) {
    if (c.app.statusCode !== "VISA_APPOINTMENT") return { error: "The submission is recorded once the appointment is booked." };
    const on = day(fd.get("submittedOn")) ?? today();
    const done = c.done(10, ticks(fd));
    if (!done.includes("ap10.biometrics")) return bad("done", "Tick the biometrics and the visa centre's procedures once they are done");
    await c.ready("VISA_PROCESSING");
    const again = c.app.visaDecision === "REFUSED" || !!c.app.visaReason;
    await c.track({ visaLodgedOn: on, visaDecision: null, visaDecisionOn: null, fsjDone: done }, "au_pair.visa_submitted");
    await c.log("VISA_SUBMITTED", 10, { on, outcome: again ? "RESUBMITTED" : "FIRST" });
    await c.move("VISA_PROCESSING");
    return { ok: `${again ? "Applied again" : "Submitted"}. The visa is processing: record follow-ups and the decision on step 11.` };
  },

  /* Step 11: a follow-up, or a request for more documents. */
  async followUp(c, fd) {
    if (c.app.statusCode !== "VISA_PROCESSING") return { error: "Follow-ups are recorded while the visa is processing." };
    const note = text(fd.get("note"), 1000);
    if (!note) return bad("note", "Say what was learnt or asked for");
    const requested = fd.get("kind") === "DOCUMENTS";
    await c.log("FOLLOW_UP", 11, { outcome: requested ? "DOCUMENTS_REQUESTED" : "UPDATE", detail: note });
    if (requested) await notifyUsers([...(await c.branch()), ...(await c.desk())], `${c.name}: more documents asked for the visa`, note, c.href);
    else await notifyUsers(await c.branch(), `${c.name}: visa update`, `${note} Keep the candidate informed.`, c.href);
    return { ok: requested ? "Recorded. The counsellor and the desk have been told what is asked for." : "Follow-up recorded." };
  },

  /* Step 11's decision: approved, or refused with the reason and what happens next. */
  async visaDecision(c, fd) {
    if (c.app.statusCode !== "VISA_PROCESSING") return { error: "The visa decision is recorded after the submission." };
    const outcome = String(fd.get("outcome") ?? "") as VisaOutcome;
    if (outcome !== "APPROVED" && outcome !== "REJECTED") return bad("outcome", "Pick the visa outcome");
    const on = day(fd.get("decidedOn")) ?? today();
    const reason = text(fd.get("reason"), 600);
    const afterRefusal = (String(fd.get("afterRefusal") ?? "") || null) as AfterRefusal | null;
    const next = afterVisaDecision({ outcome, reason, afterRefusal });
    if (!next.ok) return bad(next.field, next.why);
    const moveReason = next.code === "VISA_REJECTED" ? (reason ?? undefined) : next.code === "INTERVIEW_PREPARATION" ? `Visa refused (${reason}); the host family has withdrawn` : undefined;
    await c.ready(next.code, moveReason);
    if (next.code === "INTERVIEW_PREPARATION") {
      // The not-selected loop of step 7: the mentor, the consent and the
      // payments stay; the withdrawn family's interview, contract and visa
      // round are cleared (they stay in the history and the recorded moments)
      // and that family is not put forward again.
      const family = c.app.hostFamily;
      await c.track(
        {
          fsjEmployer: null,
          auPairPlatform: null,
          fsjInterviewAt: null,
          fsjInterviewLink: null,
          fsjFeedback: null,
          auPairPocketMoney: null,
          auPairWeeklyHours: null,
          auPairDurationMonths: null,
          fsjContractSignedOn: null,
          auPairAppointmentAt: null,
          auPairAppointmentPlace: null,
          visaLodgedOn: null,
          visaDecision: null,
          visaDecisionOn: null,
          fsjVisaReason: null,
          fsjJoiningOn: null,
        },
        "au_pair.visa_decision",
      );
      await c.log("VISA_DECISION", 11, { outcome: FAMILY_WITHDRAWN, on, employer: family, detail: `${reason}. The host family has withdrawn: back to interview preparation; the placement continues.` });
      await c.move(next.code, moveReason);
      await notifyUsers([...(await c.branch()), ...(await c.desk())], `${c.name}: visa refused, another host family`, `Reason: ${reason}. ${family ?? "The host family"} has withdrawn, so the file is back at interview preparation and the placement continues.`, c.href);
      return { ok: "Visa refused and the host family has withdrawn. The file is back at interview preparation; the placement continues." };
    }
    await c.track(
      {
        visaDecision: outcome === "APPROVED" ? "GRANTED" : "REFUSED",
        visaDecisionOn: on,
        fsjVisaReason: outcome === "APPROVED" ? c.app.visaReason : reason,
        ...(next.code === "PRE_VISA_DOCUMENTS" ? { auPairAppointmentAt: null, auPairAppointmentPlace: null } : {}),
      },
      "au_pair.visa_decision",
    );
    await c.log("VISA_DECISION", 11, { outcome, on, detail: outcome === "REJECTED" && afterRefusal ? `${reason}. ${AFTER_REFUSAL_LABEL[afterRefusal]}.` : null });
    await c.move(next.code, moveReason);
    if (next.code === "VISA_RECEIVED") {
      await notifyUsers(await c.branch(), `${c.name}: Au pair visa approved`, "The visa team confirms the passport, the visa details and the joining date with the host family, then hands the candidate to the travel desk.", c.href);
      return { ok: "Visa approved. Confirm the passport, the visa details and the joining date, then hand the file to the travel desk." };
    }
    if (next.code === "PRE_VISA_DOCUMENTS") {
      await notifyUsers([...(await c.branch()), ...(await c.desk())], `${c.name}: visa refused, to apply again`, `Reason: ${reason}. The host family still wants the candidate: the visa team corrects the file and books again.`, c.href);
      return { ok: "Visa refused. The host family still wants the candidate, so the file is corrected and a new appointment booked." };
    }
    await notifyUsers(await c.branch(), `${c.name}: visa refused`, `Reason: ${reason}. The case is closed as visa rejected.`, c.href);
    return { ok: "Visa refused and the case closed as visa rejected." };
  },

  /* Step 12: the approval's checks and the expected joining date. */
  async approval(c, fd) {
    if (c.app.statusCode !== "VISA_RECEIVED") return { error: "These are recorded once the visa is approved." };
    const joiningOn = day(fd.get("joiningOn"));
    await c.track({ fsjJoiningOn: joiningOn, fsjDone: c.done(12, ticks(fd)) }, "au_pair.visa_approval");
    return { ok: joiningOn ? "Saved. Hand the file to the travel desk when ready." : "Saved. Confirm the expected joining date before the hand-over to the travel desk." };
  },

  /* Steps 13 to 15: the travel desk's lists; the happy call starts the follow-up. */
  async checklist(c, fd) {
    const step = Number(fd.get("step"));
    if (![13, 14, 15].includes(step)) return { error: "That checklist could not be saved." };
    if (!auPairChecklistOpen(step, c.app.statusCode)) return { error: "That checklist opens when the file reaches its step." };
    const done = c.done(step, ticks(fd));
    const to = afterAuPairChecklist(step, c.app.statusCode, done);
    if (to) await c.ready(to);
    await c.track({ fsjDone: done }, `au_pair.checklist_${step}`);
    if (to) {
      await c.move(to);
      await c.log("FOLLOW_UP", 15, { outcome: "HAPPY_CALL", detail: text(fd.get("note"), 600) });
    }
    return { ok: to ? "Saved. The happy call is done: the post-arrival follow-up has begun." : "Saved." };
  },

  /* Step 14: the candidate departs. */
  async departure(c, fd) {
    if (c.app.statusCode !== "PRE_DEPARTURE") return { error: "The departure is recorded from pre-departure preparation." };
    const on = day(fd.get("departedOn"));
    if (!on) return bad("departedOn", "Give the day the candidate travelled");
    await c.ready("JOINED");
    await c.track({ fsjDepartedOn: on }, "au_pair.departure");
    await c.move("JOINED");
    await notifyUsers(await c.branch(), `${c.name}: departed for Germany`, "The travel desk makes the happy call after arrival, and collects a testimonial and references where applicable.", c.href);
    return { ok: "Departure recorded. The arrival follow-up (step 15) is next." };
  },
};

