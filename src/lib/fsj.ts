/**
 * The FSJ and BFD written process, shared by the server, the screens, the
 * tests and the deploy SQL.
 *
 * FSJ (Freiwilliges Soziales Jahr) and BFD (Bundesfreiwilligendienst) follow
 * one process of 18 steps across five departments, from the owner's guide
 * "FSJ & BFD Process Guide". The statuses in the database are what the teams
 * record; this file maps them to the guide's steps, says who owns each step,
 * which moves each decision makes, which documents the guide asks for and who
 * the guide says to email at each trigger.
 *
 * Two points in the guide are still open ("Points to confirm"):
 * - The minimum language level for interview eligibility is not defined. The
 *   portal stores the level and the result exactly as the documentation team
 *   enters them and applies no pass mark of its own.
 * - The handling of a candidate the employer does not select is drafted. It is
 *   implemented as drafted: the feedback is shared, interview preparation
 *   continues and the profile goes to another employer.
 */
import { ADMIN_ROLES, DOCUMENTATION_ROLES, PARTNER_ROLES } from "./permissions";

export const FSJ_PATHWAYS = ["FSJ", "BFD"] as const;
export type FsjPathway = (typeof FSJ_PATHWAYS)[number];
export const isFsjPathway = (p: string | null | undefined): p is FsjPathway => p === "FSJ" || p === "BFD";

/*
 * The programme facts, as Medcity's programme sheet states them (the entry
 * "FSJ & BFD: Voluntary/Federal Volunteer Service" in the CRM's
 * medcity-programmes data). Shown as information beside the process; nothing
 * in the portal checks a student against them.
 */
export const FSJ_PROGRAMMES: Record<FsjPathway, { short: string; name: string; english: string; facts: { label: string; value: string }[] }> = {
  FSJ: {
    short: "FSJ",
    name: "Freiwilliges Soziales Jahr",
    english: "Voluntary Social Year",
    facts: [
      { label: "Duration", value: "6 to 12 months" },
      { label: "Age", value: "18 to 26 years" },
      { label: "Language", value: "B1 Full / B2, 3 modules" },
      { label: "Stipend", value: "€400 to €550 a month" },
    ],
  },
  BFD: {
    short: "BFD",
    name: "Bundesfreiwilligendienst",
    english: "Federal Volunteer Service",
    facts: [
      { label: "Duration", value: "6 to 12 (18) months" },
      { label: "Age", value: "18 and over, no upper limit" },
      { label: "Language", value: "B1 Full / B2, 3 modules" },
      { label: "Stipend", value: "€400 to €550 a month" },
    ],
  },
};

export const programmeLabel = (p: string | null | undefined) => (isFsjPathway(p) ? `${p} (${FSJ_PROGRAMMES[p].name})` : "FSJ / BFD");

/* ---------------- Departments, owners and steps ---------------- */

/** The guide's five departments, in order. */
export type FsjDepartment = "COUNSELLOR" | "DOCUMENTATION" | "INTERVIEW" | "VISA" | "TRAVEL";

export const FSJ_DEPARTMENTS: { key: FsjDepartment; label: string }[] = [
  { key: "COUNSELLOR", label: "Counsellor department" },
  { key: "DOCUMENTATION", label: "Documentation department" },
  { key: "INTERVIEW", label: "Interview and employer stage" },
  { key: "VISA", label: "Visa team" },
  { key: "TRAVEL", label: "Travel desk" },
];

export const FSJ_DEPARTMENT_LABEL = Object.fromEntries(FSJ_DEPARTMENTS.map((d) => [d.key, d.label])) as Record<FsjDepartment, string>;

/** Who the guide names as a step's owner. */
export type FsjOwner = "BRANCH" | "DOCUMENTATION" | "LANGUAGE_TRAINERS" | "EMPLOYER" | "COUNSELLOR" | "VISA" | "TRAVEL";

export const FSJ_OWNER_LABEL: Record<FsjOwner, string> = {
  BRANCH: "Counsellor / branch team",
  DOCUMENTATION: "Documentation team",
  LANGUAGE_TRAINERS: "Language trainers",
  EMPLOYER: "Employer",
  COUNSELLOR: "Counsellor",
  VISA: "Visa team",
  TRAVEL: "Travel desk",
};

export type FsjStep = {
  step: number;
  title: string;
  department: FsjDepartment;
  owners: FsjOwner[];
  /** The application statuses that mean a file is at this step. */
  statusCodes: string[];
  /** The guide's points for the step, shortened. */
  tasks: string[];
  /** The department the file is handed to at the end of the step, where the guide marks a hand-over. */
  handoverTo?: FsjDepartment;
};

export const FSJ_STEPS: FsjStep[] = [
  {
    step: 1,
    title: "Candidate enquiry and counselling",
    department: "COUNSELLOR",
    owners: ["BRANCH"],
    statusCodes: [],
    tasks: [
      "Evaluate age, qualification (Higher Secondary or above), German level and communication skills",
      "Explain FSJ and BFD and their eligibility, the fee structure, payment stages, extra expenses and refund policy",
      "Explain the intakes and the full process, including the language assessment and the interview",
      "Record the German details: level, year of completion, modules cleared",
    ],
  },
  {
    step: 2,
    title: "Registration and agreement",
    department: "COUNSELLOR",
    owners: ["BRANCH"],
    statusCodes: ["REGISTRATION"],
    tasks: ["Registration form submitted", "Registration fee collected and the consultancy agreement / declaration signed", "Candidate details emailed to the FSJ / BFD addresses, branch head in copy"],
  },
  {
    step: 3,
    title: "Document collection and profile verification",
    department: "COUNSELLOR",
    owners: ["BRANCH"],
    statusCodes: ["DOCUMENT_COLLECTION"],
    tasks: [
      "Collect the documents in Section 2, clear and scanned in colour",
      "Complete the details: candidate number, email, parent's number, German level, education / employment gap, registration date, branch, counsellor, amount paid",
      "Hand the candidate and documents to the Documentation Department",
    ],
    handoverTo: "DOCUMENTATION",
  },
  {
    step: 4,
    title: "Document cross-check",
    department: "DOCUMENTATION",
    owners: ["DOCUMENTATION"],
    statusCodes: ["DOCUMENT_CROSS_CHECK"],
    tasks: ["Cross-check every document and detail from the counsellor", "Tell the counsellor what is missing or unclear", "Proceed only once collection is complete"],
  },
  {
    step: 5,
    title: "Language assessment",
    department: "DOCUMENTATION",
    owners: ["DOCUMENTATION"],
    statusCodes: ["LANGUAGE_ASSESSMENT"],
    tasks: ["Assess German, with focus on spoken communication", "Email the assessment report to the candidate, counsellor and branch head in copy"],
  },
  {
    step: 6,
    title: "Payment status check and application start",
    department: "DOCUMENTATION",
    owners: ["DOCUMENTATION"],
    statusCodes: ["PAYMENT_CHECK", "APPLICATION_ON_HOLD"],
    tasks: ["Check the registration fee and the application fee", "Start the application once both are paid; until then it is on hold and the counsellor is told"],
  },
  {
    step: 7,
    title: "Interview preparation and language improvement",
    department: "DOCUMENTATION",
    owners: ["DOCUMENTATION", "LANGUAGE_TRAINERS"],
    statusCodes: ["LANGUAGE_IMPROVEMENT", "INTERVIEW_PREPARATION"],
    tasks: [
      "Interview preparation classes (general and employer-specific) and German speaking enhancement",
      "Language improvement classes for candidates below the required level, then re-assessment",
      "Mock interviews; German / English CV, Europass CV, motivation letter, translation and attestation",
      "Confirm the language is sufficient before scheduling",
    ],
  },
  {
    step: 8,
    title: "Interview scheduling",
    department: "INTERVIEW",
    owners: ["DOCUMENTATION"],
    statusCodes: ["INTERVIEW_SCHEDULED"],
    tasks: ["Schedule as per the employer's availability", "Email the candidate, counsellor and branch head: link and schedule, organisation and employer, responsibilities, requirements"],
  },
  {
    step: 9,
    title: "Interview and employer feedback",
    department: "INTERVIEW",
    owners: ["DOCUMENTATION", "EMPLOYER"],
    statusCodes: ["INTERVIEW_ATTENDED", "SECOND_ROUND"],
    tasks: ["Obtain the employer's feedback after the interview", "If the candidate cannot attend, tell the employer at once and ask to reschedule (some employers do not)"],
  },
  {
    step: 10,
    title: "Employer confirmation and contract",
    department: "INTERVIEW",
    owners: ["DOCUMENTATION", "COUNSELLOR"],
    statusCodes: ["EMPLOYER_CONFIRMED", "OFFER_RECEIVED", "CONTRACT_SIGNED"],
    tasks: ["The employer issues the offer letter / contract", "Tell the counsellor and candidate; collect the offer-letter stage payment", "The candidate signs the contract and the declaration of acceptance and returns them"],
    handoverTo: "VISA",
  },
  { step: 11, title: "VFS slot booking", department: "VISA", owners: ["VISA"], statusCodes: ["VFS_SLOT_BOOKING"], tasks: ["Book a VFS submission date for the candidate's intake"] },
  {
    step: 12,
    title: "Visa document preparation",
    department: "VISA",
    owners: ["DOCUMENTATION", "VISA"],
    statusCodes: ["PRE_VISA_DOCUMENTS", "VISA_RESUBMISSION"],
    tasks: ["Prepare the embassy documents (Section 2) with the employer contract", "Verify the pre-visa payment before submission"],
  },
  { step: 13, title: "Visa submission at VFS", department: "VISA", owners: ["VISA"], statusCodes: ["VISA_FILED"], tasks: ["The candidate attends the appointment: biometrics and documents at VFS"] },
  { step: 14, title: "Visa processing", department: "VISA", owners: ["VISA"], statusCodes: ["VISA_PROCESSING"], tasks: ["Wait for the decision; usually 1 to 2 months, as per the embassy"] },
  {
    step: 15,
    title: "Visa approval",
    department: "VISA",
    owners: ["VISA"],
    statusCodes: ["VISA_RECEIVED"],
    tasks: ["Passport returned with the visa", "Inform the employer", "Confirm the joining date"],
    handoverTo: "TRAVEL",
  },
  { step: 16, title: "Pre-departure process", department: "TRAVEL", owners: ["TRAVEL"], statusCodes: ["PRE_DEPARTURE"], tasks: ["Flight, accommodation, SIM, travel card, insurance, orientation, felicitation, airport pick-up"] },
  { step: 17, title: "Departure to Germany", department: "TRAVEL", owners: ["TRAVEL"], statusCodes: ["JOINED"], tasks: ["Travel, report to the employer, city registration and bank account, start as a volunteer"] },
  {
    step: 18,
    title: "Post-arrival follow-up",
    department: "TRAVEL",
    owners: ["TRAVEL", "COUNSELLOR"],
    statusCodes: ["HAPPY_CALL"],
    tasks: ["Happy call, testimonial and reference from Germany", "Residence permit assistance and alumni community support"],
  },
];

export const FSJ_STEP_COUNT = FSJ_STEPS.length;

/** The step a status belongs to, or null for a status the guide does not place (on hold for an intake, closed). */
export function fsjStepOf(code: string | null | undefined): FsjStep | null {
  if (!code) return null;
  return FSJ_STEPS.find((s) => s.statusCodes.includes(code)) ?? null;
}

export const fsjDepartmentOf = (code: string | null | undefined): FsjDepartment | null => fsjStepOf(code)?.department ?? null;

export const ownersText = (step: FsjStep | null | undefined) => (step ? step.owners.map((o) => FSJ_OWNER_LABEL[o]).join(" / ") : "");

/** Whole days between two instants, never negative. */
export const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));

/**
 * Whether a file has sat at its status for at least the days a person asked
 * about on the tracker. The guide gives no turnaround per step, so the number
 * is the reader's own, never a rule; nothing is "late" by itself.
 */
export function stuckAtLeast(since: Date | null | undefined, days: number | null | undefined, now = new Date()): boolean {
  if (days == null || !since) return days == null;
  return daysBetween(since, now) >= days;
}

/* ---------------- Who may record what ---------------- */

/** The branch: the counsellors and branch head, the head office counsellors, and the admins on their behalf. */
export const FSJ_BRANCH_ROLES = [...PARTNER_ROLES, ...ADMIN_ROLES, "DESK_COUNSELLOR"] as const;
/** The documentation desk (and its language trainers), and the admins. */
export const FSJ_DESK_ROLES = [...DOCUMENTATION_ROLES, ...ADMIN_ROLES] as const;
/** The visa team sits on the Overseas desk with the documentation team, so the same people. */
export const FSJ_VISA_ROLES = FSJ_DESK_ROLES;
/** The travel desk, run from the Overseas desk by the application team leader with the admins. */
export const FSJ_TRAVEL_ROLES = ["APPLICATION_TEAM_LEADER", ...ADMIN_ROLES] as const;

export type FsjOp =
  | "registration"
  | "payments"
  | "handover"
  | "missing"
  | "crosscheck"
  | "assessment"
  | "feecheck"
  | "interview"
  | "attended"
  | "feedback"
  | "offer"
  | "vfs"
  | "visaReady"
  | "visaSubmitted"
  | "visaDecision"
  | "approval"
  | "checklist"
  | "departure"
  | "settle";

/**
 * Whether a role may record one move. The hand-over belongs to whoever owns
 * the step being handed on, and a checklist to whoever owns its step, so both
 * read the step as well. Marking a payment by hand ("payments", and the
 * registration fee on "registration") also needs the Collect fees right, as on
 * the Fees tab; that is checked on the server with feeAccess.
 */
export function mayDo(op: FsjOp, role: string, ctx: { code?: string | null; checklistStep?: number } = {}): boolean {
  const has = (roles: readonly string[]) => roles.includes(role);
  switch (op) {
    case "registration":
    case "payments":
      return has(FSJ_BRANCH_ROLES);
    case "handover": {
      const from = handoverFrom(ctx.code);
      if (!from) return false;
      return from.fromDepartment === "COUNSELLOR" ? has(FSJ_BRANCH_ROLES) : from.fromDepartment === "VISA" ? has(FSJ_VISA_ROLES) : has(FSJ_DESK_ROLES);
    }
    case "missing":
    case "crosscheck":
    case "assessment":
    case "feecheck":
    case "interview":
    case "attended":
    case "feedback":
    case "offer":
      return has(FSJ_DESK_ROLES);
    case "vfs":
    case "visaReady":
    case "visaSubmitted":
    case "visaDecision":
    case "approval":
      return has(FSJ_VISA_ROLES);
    case "departure":
      return has(FSJ_TRAVEL_ROLES);
    case "settle":
      // A written-off fee: whether the file goes on is the head office's call.
      return has(ADMIN_ROLES);
    case "checklist": {
      const step = ctx.checklistStep;
      if (step === 15) return has(FSJ_VISA_ROLES);
      if (step === 18) return has(FSJ_TRAVEL_ROLES) || has(PARTNER_ROLES) || role === "DESK_COUNSELLOR";
      return has(FSJ_TRAVEL_ROLES);
    }
  }
}

/* ---------------- The fee gate (step 6) ---------------- */

/**
 * The statuses that mean the application has started: everything from
 * interview preparation on. Language improvement is step 7 too, but it is
 * given to a candidate below the required level whether or not the fee is in,
 * so it is left out. A file is only moved onto these with both fees paid.
 */
export function needsFees(code: string | null | undefined): boolean {
  const step = fsjStepOf(code);
  if (!step || code === "LANGUAGE_IMPROVEMENT") return false;
  return step.step >= 7;
}

/**
 * The two fees the gate reads. settled marks a fee that counts as paid with no
 * day of payment: a waived instalment, or a written-off invoice the head
 * office let through.
 */
export type FeeFacts = {
  registrationFeePaidOn: string | null | undefined;
  applicationFeePaidOn: string | null | undefined;
  settled?: { registration?: boolean; application?: boolean };
};

/** Whether the registration and application fees are marked paid, and which are not. */
export function feeGate(f: FeeFacts): { clear: boolean; missing: string[] } {
  const missing = [
    !f.registrationFeePaidOn && !f.settled?.registration ? "registration fee" : null,
    !f.applicationFeePaidOn && !f.settled?.application ? "application fee" : null,
  ].filter((x): x is string => !!x);
  return { clear: missing.length === 0, missing };
}

export const feeGateText = (missing: string[]) => `The ${missing.join(" and the ")} ${missing.length === 1 ? "is" : "are"} not marked paid, so the application does not start. The counsellor has been told.`;

/** The refusal when somebody moves a file onto a started-application status without both fees marked paid. */
export const feeGateRefusal = (missing: string[]) => `The ${missing.join(" and the ")} ${missing.length === 1 ? "is" : "are"} not marked paid. The application starts only once both fees are in.`;

/** Where the fee check sends a file: started with both fees in, on hold otherwise. */
export const afterFeeCheck = (f: FeeFacts) => (feeGate(f).clear ? "INTERVIEW_PREPARATION" : "APPLICATION_ON_HOLD");

export const FEE_CHECK_AT = ["PAYMENT_CHECK", "APPLICATION_ON_HOLD"];

/* ---------------- The language assessment (step 5, and step 7's re-assessment) ---------------- */

export type LanguageResult = "SUFFICIENT" | "NOT_SUFFICIENT";
export const LANGUAGE_RESULT_LABEL: Record<LanguageResult, string> = { SUFFICIENT: "Sufficient: eligible for interview", NOT_SUFFICIENT: "Not sufficient: improvement classes, then re-assessment" };

/** Where an assessment can be recorded: the assessment itself, the improvement classes, and the mock interviews of step 7. */
export const ASSESSMENT_AT = ["LANGUAGE_ASSESSMENT", "LANGUAGE_IMPROVEMENT", "INTERVIEW_PREPARATION"];

/**
 * Where an assessment sends the file. Not sufficient goes to the improvement
 * classes and is re-assessed from there. Sufficient goes to the payment check
 * the first time; once the application has started (a re-assessment during
 * interview preparation, or after improvement classes taken later), it goes
 * back to interview preparation. The level is the team's to judge: this reads
 * only the result they chose.
 */
export function afterAssessment(result: LanguageResult, applicationStarted: boolean): string {
  if (result === "NOT_SUFFICIENT") return "LANGUAGE_IMPROVEMENT";
  return applicationStarted ? "INTERVIEW_PREPARATION" : "PAYMENT_CHECK";
}

/* ---------------- Interviews and employer feedback (steps 8 and 9) ---------------- */

export type Feedback = "POSITIVE" | "SECOND_ROUND" | "NOT_SELECTED";
export const FEEDBACK_LABEL: Record<Feedback, string> = {
  POSITIVE: "Positive: the employer confirms",
  SECOND_ROUND: "Multiple candidates shortlisted: second-round interview",
  NOT_SELECTED: "Not selected",
};

export const INTERVIEW_AT = ["INTERVIEW_PREPARATION", "SECOND_ROUND", "INTERVIEW_SCHEDULED"];
export const FEEDBACK_AT = ["INTERVIEW_SCHEDULED", "INTERVIEW_ATTENDED"];

const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Whether an interview may be scheduled now, and why not. Scheduling needs the
 * application started (both fees in) and the latest assessment recorded as
 * sufficient, the guide's "confirm the language is sufficient before
 * scheduling". A second round is with the employer that shortlisted. An
 * employer that did not select the candidate is not asked again: the guide
 * sends the profile to other employers.
 */
export function interviewCheck(a: {
  code: string | null | undefined;
  fees: FeeFacts;
  applicationStarted: boolean;
  languageResult: LanguageResult | null | undefined;
  employer: string;
  currentEmployer: string | null | undefined;
  notSelectedBy: string[];
}): { ok: true } | { ok: false; why: string } {
  if (!a.code || !INTERVIEW_AT.includes(a.code)) return { ok: false, why: "An interview is scheduled from interview preparation, a second round, or to reschedule one already set." };
  const gate = feeGate(a.fees);
  if (!gate.clear || !a.applicationStarted) return { ok: false, why: gate.clear ? "The application has not been started yet. Run the payment check first." : feeGateText(gate.missing) };
  if (a.languageResult !== "SUFFICIENT") return { ok: false, why: "The latest language assessment is not recorded as sufficient. Confirm the language before scheduling." };
  if (!a.employer.trim()) return { ok: false, why: "Name the organisation." };
  if (a.code === "SECOND_ROUND" && a.currentEmployer && !sameName(a.employer, a.currentEmployer)) {
    return { ok: false, why: `The second round is with ${a.currentEmployer}, the employer that shortlisted.` };
  }
  if (a.notSelectedBy.some((e) => sameName(e, a.employer))) return { ok: false, why: `${a.employer.trim()} did not select the candidate, or withdrew after a visa refusal. Submit the profile to another employer.` };
  return { ok: true };
}

/**
 * Where the employer's feedback sends the file: positive to the offer, a
 * second round back to scheduling with the same employer, and not selected
 * back to interview preparation, ready for another employer.
 */
export function afterFeedback(outcome: Feedback): string {
  if (outcome === "POSITIVE") return "EMPLOYER_CONFIRMED";
  if (outcome === "SECOND_ROUND") return "SECOND_ROUND";
  return "INTERVIEW_PREPARATION";
}

/* ---------------- Offer and contract (step 10) ---------------- */

export const OFFER_AT = ["EMPLOYER_CONFIRMED", "OFFER_RECEIVED", "CONTRACT_SIGNED"];

/** Where the offer form sends the file: signed with a contract date, issued with an offer date. A signature needs the offer first. */
export function afterOffer(f: { offerOn: string | null; contractSignedOn: string | null }): { ok: true; code: string | null } | { ok: false; why: string } {
  if (f.contractSignedOn && !f.offerOn) return { ok: false, why: "Record the offer letter date before the contract signature." };
  if (f.offerOn && f.contractSignedOn && f.contractSignedOn < f.offerOn) return { ok: false, why: "The contract cannot be signed before the offer letter was issued." };
  return { ok: true, code: f.contractSignedOn ? "CONTRACT_SIGNED" : f.offerOn ? "OFFER_RECEIVED" : null };
}

/* ---------------- Hand-overs between departments ---------------- */

export type FsjHandover = { fromCode: string; fromDepartment: FsjDepartment; to: FsjDepartment; toCode: string; label: string };

/** The three hand-overs the guide marks with an arrow. */
export const FSJ_HANDOVERS: FsjHandover[] = [
  { fromCode: "DOCUMENT_COLLECTION", fromDepartment: "COUNSELLOR", to: "DOCUMENTATION", toCode: "DOCUMENT_CROSS_CHECK", label: "Hand to the Documentation Department" },
  { fromCode: "CONTRACT_SIGNED", fromDepartment: "INTERVIEW", to: "VISA", toCode: "VFS_SLOT_BOOKING", label: "Hand to the Visa Team" },
  { fromCode: "VISA_RECEIVED", fromDepartment: "VISA", to: "TRAVEL", toCode: "PRE_DEPARTURE", label: "Hand to the Travel Desk" },
];

export const handoverFrom = (code: string | null | undefined) => FSJ_HANDOVERS.find((h) => h.fromCode === code) ?? null;

/**
 * Whether the file may be handed on from where it is. The branch's hand-over
 * also waits on the profile documents and details, checked on the server with
 * fsjDetailsMissing; the later two wait on the contract and the joining date.
 */
export function handoverCheck(code: string | null | undefined, f: { contractSignedOn: string | null; joiningOn: string | null }): { ok: true; handover: FsjHandover } | { ok: false; why: string } {
  const h = handoverFrom(code);
  if (!h) return { ok: false, why: "There is no hand-over from this step." };
  if (h.to === "VISA" && !f.contractSignedOn) return { ok: false, why: "Record the signed contract before handing the file to the visa team." };
  if (h.to === "TRAVEL" && !f.joiningOn) return { ok: false, why: "Confirm the joining date before handing the file to the travel desk." };
  return { ok: true, handover: h };
}

/** The first step that belongs to the documentation team: the cross-check after the branch's hand-over. */
export const FSJ_DESK_STEP = 4;

/**
 * Whether a status means the file is past the branch, so moving an FSJ / BFD
 * application there (from the status picker, say) hands it to the desk if
 * nobody has: the documentation team can only open a handed-over file.
 */
export function fsjPastBranch(code: string | null | undefined): boolean {
  const step = fsjStepOf(code);
  return step != null && step.step >= FSJ_DESK_STEP;
}

/**
 * The details the guide wants complete before the branch hands over (step 3),
 * named one by one so the counsellor can fill them in.
 */
export function fsjDetailsMissing(d: {
  medcityId: string | null | undefined;
  email: string | null | undefined;
  parentPhone: string | null | undefined;
  germanLevel: string | null | undefined;
  gapRecorded: boolean;
  registeredOn: Date | string | null | undefined;
  counsellor: string | null | undefined;
  registrationFeePaidOn: string | null | undefined;
}): string[] {
  return [
    !d.medcityId ? "candidate number (Medcity ID)" : null,
    !d.email ? "email ID" : null,
    !d.parentPhone ? "parent's contact number" : null,
    !d.germanLevel ? "current German level" : null,
    !d.gapRecorded ? "education / employment gap" : null,
    !d.registeredOn ? "registration date" : null,
    !d.counsellor ? "counsellor" : null,
    !d.registrationFeePaidOn ? "amount paid (registration fee)" : null,
  ].filter((x): x is string => !!x);
}

/* ---------------- The visa (steps 11 to 15) ---------------- */

/** Where a VFS slot is booked: on first reaching the visa team, during preparation, and again for a resubmission after a refusal. */
export const VFS_AT = ["VFS_SLOT_BOOKING", "PRE_VISA_DOCUMENTS", "VISA_RESUBMISSION"];
export const VISA_READY_AT = ["PRE_VISA_DOCUMENTS", "VISA_RESUBMISSION"];
export const VISA_DECISION_AT = ["VISA_FILED", "VISA_PROCESSING"];

/**
 * What the guide's step 12 needs before the file goes to VFS: the pre-visa
 * payment (paid, or settled), the signed employer contract it is prepared
 * with, and the profile documents of Section 2 (named, as the checklist has
 * them).
 */
export type VisaFacts = {
  preVisaPaymentOn: string | null | undefined;
  preVisaSettled?: boolean;
  contractSignedOn: string | null | undefined;
  profileMissing: string[];
};

/** Whether the visa file may go to VFS, and what is still missing. */
export function visaGate(f: VisaFacts): { clear: boolean; missing: string[] } {
  const missing = [!f.preVisaPaymentOn && !f.preVisaSettled ? "pre-visa payment" : null, !f.contractSignedOn ? "signed contract" : null, ...f.profileMissing].filter((x): x is string => !!x);
  return { clear: missing.length === 0, missing };
}

/** The visa gate's refusal, in sentences a person can act on. */
export function visaGateText(f: VisaFacts): string {
  const out: string[] = [];
  if (!f.preVisaPaymentOn && !f.preVisaSettled) out.push("The pre-visa payment is not marked received. It is verified before submission.");
  if (!f.contractSignedOn) out.push("The signed employer contract is not recorded.");
  if (f.profileMissing.length) out.push(`Profile documents still needed: ${f.profileMissing.join(", ")}.`);
  return out.join(" ");
}

/** The guide's step 12: the visa file goes to VFS only with the pre-visa payment, the signed contract and the profile documents in. */
export function visaReadyCheck(code: string | null | undefined, f: VisaFacts): { ok: true } | { ok: false; why: string } {
  if (!code || !VISA_READY_AT.includes(code)) return { ok: false, why: "The visa file is made ready from visa document preparation or a correction after a refusal." };
  if (!visaGate(f).clear) return { ok: false, why: visaGateText(f) };
  return { ok: true };
}

/** The visa submission at VFS (step 13): moving a file onto it or past it needs the visa gate. */
export const FSJ_VISA_STEP = 13;

/**
 * Whether a status move takes the file past the visa gate: from before the VFS
 * submission (or from a status the guide does not place, such as a closed or
 * held file) onto it or any later step. Moves within the visa stage and after
 * it are not checked again, so a document expiring after the visa is granted
 * does not hold up the travel desk.
 */
export function crossesVisaGate(from: string | null | undefined, to: string | null | undefined): boolean {
  const toStep = fsjStepOf(to)?.step;
  if (toStep == null || toStep < FSJ_VISA_STEP) return false;
  const fromStep = fsjStepOf(from)?.step;
  return fromStep == null || fromStep < FSJ_VISA_STEP;
}

export type VisaOutcome = "APPROVED" | "REJECTED";

/** After a refusal: the guide's correction and resubmission, another employer when this one has withdrawn, or closing the case. */
export type AfterRefusal = "RESUBMIT" | "ANOTHER_EMPLOYER" | "CLOSE";
export const AFTER_REFUSAL_LABEL: Record<AfterRefusal, string> = {
  RESUBMIT: "The employer still wants the candidate: correct the file and resubmit",
  ANOTHER_EMPLOYER: "The employer has withdrawn: back to interview preparation for another employer",
  CLOSE: "The employer has withdrawn: close the case as visa rejected",
};

/**
 * Where the visa decision sends the file. Approved is the visa received. A
 * refusal needs its reason and what happens next: if the employer still wants
 * the candidate the documentation team corrects the file and it is
 * resubmitted; if the employer has withdrawn, the file goes back to interview
 * preparation for another employer (the not-selected loop of step 9, keeping
 * the language result, the application start and the fees), or the case is
 * closed as visa rejected.
 */
export function afterVisaDecision(d: { outcome: VisaOutcome; reason: string | null; afterRefusal: AfterRefusal | null | undefined }): { ok: true; code: string } | { ok: false; why: string; field: "reason" | "afterRefusal" } {
  if (d.outcome === "APPROVED") return { ok: true, code: "VISA_RECEIVED" };
  if (!d.reason?.trim()) return { ok: false, why: "Give the reason for the refusal.", field: "reason" };
  if (d.afterRefusal === "RESUBMIT") return { ok: true, code: "VISA_RESUBMISSION" };
  if (d.afterRefusal === "ANOTHER_EMPLOYER") return { ok: true, code: "INTERVIEW_PREPARATION" };
  if (d.afterRefusal === "CLOSE") return { ok: true, code: "VISA_REJECTED" };
  return { ok: false, why: "Say what happens next: resubmit with this employer, another employer, or close the case.", field: "afterRefusal" };
}

/* ---------------- Checklists (steps 15 to 18) ---------------- */

export const FSJ_CHECKLISTS: Record<number, { key: string; label: string }[]> = {
  15: [
    { key: "s15.passport", label: "Passport returned with the visa" },
    { key: "s15.employer", label: "Employer informed" },
  ],
  16: [
    { key: "s16.flight", label: "Flight booking" },
    { key: "s16.accommodation", label: "Accommodation arrangement" },
    { key: "s16.sim", label: "International SIM card" },
    { key: "s16.travelCard", label: "Travel card / currency exchange assistance" },
    { key: "s16.insurance", label: "Travel and health insurance assistance" },
    { key: "s16.orientation", label: "Pre-departure orientation" },
    { key: "s16.felicitation", label: "Felicitation and testimonial collection" },
    { key: "s16.pickup", label: "Airport pick-up arrangements" },
  ],
  17: [
    { key: "s17.travelled", label: "Travelled to Germany" },
    { key: "s17.reported", label: "Reported to the employer" },
    { key: "s17.registration", label: "City registration and bank account opening" },
    { key: "s17.started", label: "Started as FSJ / BFD volunteer" },
  ],
  18: [
    { key: "s18.happyCall", label: "Happy call to the candidate" },
    { key: "s18.testimonial", label: "Testimonial collection from Germany" },
    { key: "s18.reference", label: "Reference collection" },
    { key: "s18.residence", label: "Residence permit application assistance and alumni community support" },
  ],
};

/**
 * A checklist is ticked from its own step on. The departure list opens during
 * pre-departure, since the travel desk prepares it then, and the follow-up list
 * opens once the candidate has departed, since its happy call is what starts
 * the follow-up.
 */
export function checklistOpen(step: number, code: string | null | undefined): boolean {
  const at = fsjStepOf(code)?.step ?? 0;
  if (!FSJ_CHECKLISTS[step]) return false;
  return at >= step || ((step === 17 || step === 18) && at === step - 1);
}

/**
 * The ticks a checklist save leaves on the file: the other steps' ticks kept,
 * this step's replaced by what was sent, anything not on the list dropped.
 */
export function mergeChecklist(held: readonly string[], step: number, sent: readonly string[]): string[] {
  const keys = new Set((FSJ_CHECKLISTS[step] ?? []).map((i) => i.key));
  const others = held.filter((k) => !keys.has(k));
  return [...others, ...(FSJ_CHECKLISTS[step] ?? []).map((i) => i.key).filter((k) => sent.includes(k))];
}

/** The happy call is the start of the follow-up: ticking it on a file that has departed moves it to step 18. */
export const afterChecklist = (step: number, code: string | null | undefined, done: readonly string[]) => (step === 18 && code === "JOINED" && done.includes("s18.happyCall") ? "HAPPY_CALL" : null);

/* ---------------- The email matrix (Section 3) ---------------- */

export type FsjTrigger = "REGISTERED" | "DOCUMENTS_MISSING" | "ASSESSMENT_DONE" | "FEE_PENDING" | "INTERVIEW_SCHEDULED" | "VISA_APPROVED";
export type Recipient = { kind: "address"; email: string } | { kind: "candidate" } | { kind: "counsellor" } | { kind: "branchHead" };

export const FSJ_CONTACT_AREA = "FSJ and BFD (Germany)";

/** The two addresses the guide names for the registration email, the starting rows for the Contacts list. */
export const FSJ_TEAM: { name: string; title: string; email: string; level: number; sortOrder: number }[] = [
  { name: "FSJ and BFD registrations", title: "Receives the candidate details at registration, with the branch head in copy", email: "fsj.bfd@miak.in", level: 1, sortOrder: 10 },
  { name: "FSJ and BFD registrations (second address)", title: "Also receives the candidate details at registration", email: "nsg.ast@miak.in", level: 1, sortOrder: 20 },
];

/**
 * One row of the email matrix. sender is the department whose step raises the
 * trigger and so sends the email. Where tellSender is set, the notice also goes
 * to that department, saying the email is theirs to send and to whom, since
 * the people the email goes to are not the people who send it.
 */
export type FsjEmail = { step: number; label: string; to: Recipient[]; cc: Recipient[]; content: string; sender: "BRANCH" | "DOCUMENTATION" | "VISA"; tellSender: boolean };

export const FSJ_EMAILS: Record<FsjTrigger, FsjEmail> = {
  REGISTERED: {
    step: 2,
    label: "Candidate registered",
    to: FSJ_TEAM.map((t) => ({ kind: "address" as const, email: t.email })),
    cc: [{ kind: "branchHead" }],
    content: "Candidate details and registration confirmation",
    sender: "BRANCH",
    tellSender: false,
  },
  DOCUMENTS_MISSING: { step: 4, label: "Documents / details missing", to: [{ kind: "counsellor" }], cc: [{ kind: "branchHead" }], content: "List of pending documents or details", sender: "DOCUMENTATION", tellSender: false },
  ASSESSMENT_DONE: {
    step: 5,
    label: "Language assessment completed",
    to: [{ kind: "candidate" }],
    cc: [{ kind: "counsellor" }, { kind: "branchHead" }],
    content: "Assessment report and recommendation",
    sender: "DOCUMENTATION",
    tellSender: true,
  },
  FEE_PENDING: { step: 6, label: "Application fee pending", to: [{ kind: "counsellor" }], cc: [{ kind: "branchHead" }], content: "Payment status; application on hold", sender: "DOCUMENTATION", tellSender: true },
  INTERVIEW_SCHEDULED: {
    step: 8,
    label: "Interview scheduled",
    to: [{ kind: "candidate" }],
    cc: [{ kind: "counsellor" }, { kind: "branchHead" }],
    content: "Interview link, organisation, employer, responsibilities, requirements",
    sender: "DOCUMENTATION",
    tellSender: false,
  },
  VISA_APPROVED: {
    step: 15,
    label: "Visa approved",
    to: [{ kind: "candidate" }],
    cc: [{ kind: "counsellor" }, { kind: "branchHead" }],
    content: "Visa approval and next steps (joining date, pre-departure)",
    sender: "VISA",
    tellSender: true,
  },
};

export const FSJ_SENDER_LABEL: Record<FsjEmail["sender"], string> = { BRANCH: "the counsellor / branch team", DOCUMENTATION: "the documentation team", VISA: "the visa team" };

/**
 * The notice to the department that sends a trigger's email: that it is
 * theirs to send, to whom and with whom in copy, and who has no address on
 * record. The text to copy stays on the tab.
 */
export function senderNoticeText(trigger: FsjTrigger, to: { emails: string[]; unknown: string[] }, cc: { emails: string[]; unknown: string[] }): string {
  const m = FSJ_EMAILS[trigger];
  const unknown = [...new Set([...to.unknown, ...cc.unknown])];
  return [
    `The "${m.label.toLowerCase()}" email is for ${FSJ_SENDER_LABEL[m.sender]} to send.`,
    `To: ${to.emails.join("; ") || "Not recorded"}.`,
    `Cc: ${cc.emails.join("; ") || "None"}.`,
    unknown.length ? `No email on record for ${unknown.join(", ")}.` : "",
    `The text to copy is on step ${m.step} of the FSJ / BFD tab. The portal does not send it.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export const FSJ_TRIGGERS = Object.keys(FSJ_EMAILS) as FsjTrigger[];

export type People = { candidate: string | null; counsellor: string | null; branchHeads: string[] };

/**
 * The addresses one list of recipients comes to, and who among them has no
 * email on record, so the screen can say so instead of dropping them quietly.
 * The guide's own registration addresses are used unless the Contacts list has
 * rows for the area, which then stand in for them.
 */
export function resolveRecipients(list: Recipient[], people: People, registrationAddresses: string[] = []): { emails: string[]; unknown: string[] } {
  const emails: string[] = [];
  const unknown: string[] = [];
  const add = (e: string | null | undefined, who: string) => {
    if (!e) unknown.push(who);
    else if (!emails.includes(e)) emails.push(e);
  };
  const fixed = list.filter((r): r is { kind: "address"; email: string } => r.kind === "address").map((r) => r.email);
  for (const e of fixed.length && registrationAddresses.length ? registrationAddresses : fixed) add(e, e);
  for (const r of list) {
    if (r.kind === "candidate") add(people.candidate, "the candidate");
    else if (r.kind === "counsellor") add(people.counsellor, "the counsellor");
    else if (r.kind === "branchHead") {
      if (people.branchHeads.length) for (const b of people.branchHeads) add(b, "the branch head");
      else unknown.push("the branch head");
    }
  }
  return { emails, unknown };
}

export type DraftFacts = {
  pathway: string | null | undefined;
  student: string;
  medcityId: string | null;
  email: string | null;
  phone: string | null;
  parentPhone: string | null;
  germanLevel: string | null;
  gap: string | null;
  registeredOn: string | null;
  branch: string | null;
  counsellor: string | null;
  registrationFeePaidOn: string | null;
  missing?: string | null;
  level?: string | null;
  result?: LanguageResult | null;
  note?: string | null;
  employer?: string | null;
  interviewAt?: string | null;
  link?: string | null;
  responsibilities?: string | null;
  requirements?: string | null;
  feesMissing?: string[];
  joiningOn?: string | null;
  decidedOn?: string | null;
};

const NR = "Not recorded";

/**
 * The email a trigger asks for, as text a person copies into their own mail:
 * the addresses, a subject and a body made of what the file holds. Nothing is
 * sent from the portal; a fact the file does not hold reads "Not recorded".
 */
export function emailDraft(trigger: FsjTrigger, f: DraftFacts, addresses: { to: string[]; cc: string[] }) {
  const prog = isFsjPathway(f.pathway) ? f.pathway : "FSJ / BFD";
  const who = `${f.student}${f.medcityId ? ` (${f.medcityId})` : ""}`;
  const line = (label: string, v: string | null | undefined) => `${label}: ${v?.trim() ? v.trim() : NR}`;
  let subject = "";
  let body: string[] = [];
  switch (trigger) {
    case "REGISTERED":
      subject = `${prog} registration: ${who}`;
      body = [
        `A candidate has registered for ${prog}.`,
        "",
        line("Candidate", f.student),
        line("Candidate number", f.medcityId),
        line("Email", f.email),
        line("Mobile", f.phone),
        line("Parent's contact number", f.parentPhone),
        line("Current German level", f.germanLevel),
        line("Education / employment gap", f.gap),
        line("Registration date", f.registeredOn),
        line("Branch", f.branch),
        line("Counsellor", f.counsellor),
        line("Registration fee paid on", f.registrationFeePaidOn),
      ];
      break;
    case "DOCUMENTS_MISSING":
      subject = `${prog}: documents or details pending for ${who}`;
      body = [`The documentation team needs the following before the cross-check can be completed:`, "", f.missing?.trim() || NR];
      break;
    case "ASSESSMENT_DONE":
      subject = `${prog}: German language assessment report for ${f.student}`;
      body = [
        `Dear ${f.student},`,
        "",
        "Your German language assessment has been completed.",
        line("Level assessed", f.level),
        line("Result", f.result ? LANGUAGE_RESULT_LABEL[f.result] : null),
        line("Recommendation", f.note),
      ];
      break;
    case "FEE_PENDING":
      subject = `${prog}: application fee pending for ${who}`;
      body = [
        `The application for ${f.student} is on hold.`,
        line("Not yet received", f.feesMissing?.length ? f.feesMissing.join(", ") : null),
        "The application does not start until the fee is received.",
      ];
      break;
    case "INTERVIEW_SCHEDULED":
      subject = `${prog}: interview scheduled with ${f.employer?.trim() || "the employer"}`;
      body = [
        `Dear ${f.student},`,
        "",
        "Your interview has been scheduled.",
        line("Organisation / employer", f.employer),
        line("Date and time", f.interviewAt),
        line("Interview link", f.link),
        line("Work responsibilities", f.responsibilities),
        line("Employer requirements", f.requirements),
      ];
      break;
    case "VISA_APPROVED":
      subject = `${prog}: visa approved for ${f.student}`;
      body = [
        `Dear ${f.student},`,
        "",
        "Your visa has been approved.",
        line("Decision date", f.decidedOn),
        line("Joining date", f.joiningOn),
        "Next: the pre-departure process with our travel desk.",
      ];
      break;
  }
  body.push("", "Medcity Overseas");
  const text = [`To: ${addresses.to.join("; ") || NR}`, `Cc: ${addresses.cc.join("; ") || "None"}`, `Subject: ${subject}`, "", ...body].join("\n");
  return { subject, body: body.join("\n"), text, to: addresses.to, cc: addresses.cc };
}

/* ---------------- The student portal ---------------- */

/** What each step means for the candidate, in plain words. No owners, no addresses. */
export const FSJ_STUDENT_STEP: Record<number, string> = {
  1: "Talking through FSJ and BFD with your counsellor",
  2: "Registering with us and signing the agreement",
  3: "Collecting your documents",
  4: "Our documentation team is checking your documents",
  5: "Your German language assessment",
  6: "Checking your fees so your application can start",
  7: "Preparing you for interviews, with German practice",
  8: "Your interview with an employer is being arranged",
  9: "Waiting for the employer's decision",
  10: "Your offer letter and contract",
  11: "Booking your visa appointment",
  12: "Preparing your visa documents",
  13: "Your visa appointment at VFS",
  14: "The embassy is processing your visa",
  15: "Your visa is approved",
  16: "Getting you ready to travel",
  17: "Flying to Germany and starting as a volunteer",
  18: "Settling in: we stay in touch",
};

/**
 * The FSJ or BFD application the student portal and the staff tab follow: the
 * open one that moved most recently, with a finished one giving way to one
 * still being worked. Null where there is none.
 */
export function pickFsjApplication<T extends { pathway: string; statusGroup: string; changedAt: Date | string | null }>(apps: T[]): T | null {
  const open = apps.filter((a) => isFsjPathway(a.pathway) && a.statusGroup !== "CLOSED");
  if (!open.length) return null;
  const at = (a: T) => (a.changedAt ? new Date(a.changedAt).getTime() : 0);
  return [...open].sort((a, b) => (a.statusGroup === "SUCCESS" ? 1 : 0) - (b.statusGroup === "SUCCESS" ? 1 : 0) || at(b) - at(a))[0];
}
