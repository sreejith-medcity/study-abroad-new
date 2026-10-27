/**
 * The Au pair written process, shared by the server, the screens, the tests
 * and the deploy SQL.
 *
 * Au pair (a year living with a host family in Germany, looking after the
 * children for board, lodging and pocket money) follows the owner's guide
 * "Au Pair Process Flow": 15 steps in five stages, carried by six teams, from
 * the enquiry to the happy call after arrival. The statuses in the database
 * are what the teams record; this file maps them to the guide's steps, says
 * which team owns each step, which moves each decision makes, which documents
 * the guide asks for and what the registration email says.
 *
 * It is built the way src/lib/fsj.ts carries the FSJ / BFD guide, as a module
 * of its own rather than a second process inside that one: the two guides
 * share their outline (hand-overs, a decision after each interview, a gate
 * before the visa, the travel desk) but not their rules, and the FSJ / BFD
 * rules stay exactly as they are. What is stored is shared: the fsj_* columns
 * on the application whose meaning is the same (the registration fee, the
 * agreement, the host family in the employer column, the interview, the
 * contract signature, the payment check, the visa, the joining and departure
 * days and the checklist ticks) and fsj_events for every round.
 */
import { ADMIN_ROLES, DOCUMENTATION_ROLES, PARTNER_ROLES } from "./permissions";

/* ---------------- Teams, stages and steps ---------------- */

/** The guide's six responsible teams, in the order the file meets them. */
export type AuPairTeam = "BRANCH" | "DOCUMENTATION" | "MENTOR" | "PLACEMENT" | "VISA" | "TRAVEL";

export const AU_PAIR_TEAMS: { key: AuPairTeam; label: string }[] = [
  { key: "BRANCH", label: "Counsellor / branch team" },
  { key: "DOCUMENTATION", label: "Documentation department" },
  { key: "MENTOR", label: "Student mentor" },
  { key: "PLACEMENT", label: "Placement team" },
  { key: "VISA", label: "Visa team" },
  { key: "TRAVEL", label: "Travel desk" },
];

export const AU_PAIR_TEAM_LABEL = Object.fromEntries(AU_PAIR_TEAMS.map((d) => [d.key, d.label])) as Record<AuPairTeam, string>;

/** The guide's five stages, which group the steps on the tab. */
export const AU_PAIR_STAGES = [
  "Student enquiry and registration",
  "Documentation and preparation",
  "Host family interview and contract",
  "Visa documentation and processing",
  "Travel and departure",
] as const;

export type AuPairStep = {
  step: number;
  title: string;
  /** The guide's stage, 1 to 5. */
  stage: number;
  team: AuPairTeam;
  /** The application statuses that mean a file is at this step. */
  statusCodes: string[];
  /** The guide's points for the step, shortened. */
  tasks: string[];
  /** The team the file is handed to at the end of the step, where the guide says so. */
  handoverTo?: AuPairTeam;
};

export const AU_PAIR_STEPS: AuPairStep[] = [
  {
    step: 1,
    title: "Student enquiry and initial counselling",
    stage: 1,
    team: "BRANCH",
    statusCodes: ["ASSESSMENT"],
    tasks: [
      "Evaluate the profile: age (usually 18 to 26), qualification (+2, diploma or degree), English and German",
      "Explain the Au pair programme and its requirements",
      "Financial counselling: service charges, extra expenses, visa charges, compensation if the contract is not processed",
      "Career goals and preferences (first and second), intended intake and availability, the refund policy",
      "Collect the German details: level, year of completion, module-wise certificates",
    ],
  },
  {
    step: 2,
    title: "Registration and agreement",
    stage: 1,
    team: "BRANCH",
    statusCodes: ["REGISTRATION"],
    tasks: [
      "Confirm the candidate's decision to proceed and complete the candidate form",
      "Collect the registration fee (or one-time fee)",
      "Obtain the signed consultancy agreement and declaration form",
      "Email the Documentation Team at aupair@miak.in and tell them on WhatsApp, with the concerned addresses in copy",
    ],
  },
  {
    step: 3,
    title: "Document collection and handover",
    stage: 1,
    team: "BRANCH",
    statusCodes: ["DOCUMENT_COLLECTION"],
    tasks: ["Collect the documents the guide lists from the candidate", "Transfer the candidate's file to the Documentation Department"],
    handoverTo: "DOCUMENTATION",
  },
  {
    step: 4,
    title: "Mentor assignment",
    stage: 2,
    team: "DOCUMENTATION",
    statusCodes: ["MENTOR_ASSIGNMENT"],
    tasks: ["Assign a mentor to the candidate", "Tell the counsellor who the mentor is (WhatsApp)", "The counsellor passes the mentor's details to the candidate"],
    handoverTo: "MENTOR",
  },
  {
    step: 5,
    title: "Interview preparation",
    stage: 2,
    team: "MENTOR",
    statusCodes: ["INTERVIEW_PREPARATION"],
    tasks: ["General Au pair interview preparation", "Stream-specific or situation-based preparation", "Mock interviews to assess readiness", "Areas for improvement and feedback"],
  },
  {
    step: 6,
    title: "Profile submission and placement handover",
    stage: 2,
    team: "MENTOR",
    statusCodes: ["PROFILE_SUBMITTED", "HOST_FAMILY_FOUND"],
    tasks: [
      "Update the candidate's profile and obtain the candidate's consent before submitting it",
      "Search for host families on AuPair.com, Au-pair Vermittlung and other platforms",
      "Introduce the candidate to suitable families and obtain the interested family's contact number",
      "Share the family's number with the candidate, then hand the candidate to the Placement Team",
    ],
    handoverTo: "PLACEMENT",
  },
  {
    step: 7,
    title: "Host family interview",
    stage: 3,
    team: "PLACEMENT",
    statusCodes: ["FAMILY_INTERVIEW"],
    tasks: [
      "Schedule the online interview with the host family and tell the candidate the details",
      "Follow up on the outcome: selected goes to the contract, not selected goes back to interview preparation",
    ],
  },
  {
    step: 8,
    title: "Host family contract",
    stage: 3,
    team: "PLACEMENT",
    statusCodes: ["OFFER_RECEIVED", "CONTRACT_SIGNED"],
    tasks: [
      "Receive the contract and verify pocket money, working hours, duties and duration",
      "Explain the terms to the candidate and have them sign where required",
      "Send the signed contract to the family and obtain the completed documents",
      "Hand the contract and the details to the Visa Team",
    ],
    handoverTo: "VISA",
  },
  {
    step: 9,
    title: "Pre-visa documentation",
    stage: 4,
    team: "VISA",
    statusCodes: ["PRE_VISA_DOCUMENTS"],
    tasks: ["Prepare and verify the visa documents on the guide's list, as applicable", "Payment verification: every applicable payment completed before proceeding"],
  },
  {
    step: 10,
    title: "Visa appointment booking and submission",
    stage: 4,
    team: "VISA",
    statusCodes: ["VISA_APPOINTMENT"],
    tasks: [
      "Check availability and book the appointment; tell the candidate the date, time and location",
      "Arrange the documents in order and guide the candidate on the submission",
      "At the appointment: documents, biometrics and any other procedure the visa centre asks for",
    ],
  },
  {
    step: 11,
    title: "Visa processing and follow-up",
    stage: 4,
    team: "VISA",
    statusCodes: ["VISA_PROCESSING"],
    tasks: ["Track the application and follow up where possible", "Respond to requests for additional documents", "Keep the candidate informed"],
  },
  {
    step: 12,
    title: "Visa approval and confirmation",
    stage: 4,
    team: "VISA",
    statusCodes: ["VISA_RECEIVED"],
    tasks: ["Tell the candidate; confirm passport collection or return; verify the visa details", "Inform the host family and confirm the expected joining date", "Hand the candidate to the Travel Desk"],
    handoverTo: "TRAVEL",
  },
  {
    step: 13,
    title: "Pre-departure preparation",
    stage: 5,
    team: "TRAVEL",
    statusCodes: ["PRE_DEPARTURE"],
    tasks: ["Flight booking, pre-departure orientation, travel requirements and documents", "Testimonial where applicable, airport drop-off or pickup, flight schedule confirmed"],
  },
  {
    step: 14,
    title: "Departure to Germany",
    stage: 5,
    team: "TRAVEL",
    statusCodes: ["JOINED"],
    tasks: ["Confirm the flight and the travel documents", "Coordinate on the day; share the travel update with the team and the host family"],
  },
  {
    step: 15,
    title: "Arrival in Germany and post-arrival follow-up",
    stage: 5,
    team: "TRAVEL",
    statusCodes: ["HAPPY_CALL"],
    tasks: ["Happy call: safe arrival, received by the host family", "Testimonial and references where applicable", "Arrival status updated in the records"],
  },
];

export const AU_PAIR_STEP_COUNT = AU_PAIR_STEPS.length;

/** The step a status belongs to, or null for a status the guide does not place (on hold for an intake, closed). */
export function auPairStepOf(code: string | null | undefined): AuPairStep | null {
  if (!code) return null;
  return AU_PAIR_STEPS.find((s) => s.statusCodes.includes(code)) ?? null;
}

export const auPairTeamOf = (code: string | null | undefined): AuPairTeam | null => auPairStepOf(code)?.team ?? null;

/*
 * The provisional statuses of 1.8.7 that the written process does not keep,
 * and the step each file on one moves to. JOINED is kept with a new meaning
 * (departed), so a file on the provisional "Arrived" JOINED moves to the
 * arrival step: the deploy SQL reads the provisional label to tell the two
 * apart. The codes kept with the same meaning (the enquiry, the documents,
 * the family interview, the offer, the contract, the visa processing and
 * approval, the travel arrangements) stay where they are.
 */
export const AU_PAIR_RETIRED: { code: string; to: string; provisionalLabel?: string; retire: boolean }[] = [
  { code: "AGENCY_PROFILE", to: "PROFILE_SUBMITTED", retire: true },
  { code: "FAMILY_MATCHING", to: "PROFILE_SUBMITTED", retire: true },
  { code: "VISA_FILED", to: "VISA_PROCESSING", retire: true },
  { code: "JOINED", to: "HAPPY_CALL", provisionalLabel: "Arrived: living with the host family", retire: false },
];

/** Whole days between two instants, never negative. */
export const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));

/* ---------------- Who may record what ---------------- */

/** The branch: the counsellors and branch head, the head office counsellors, and the admins on their behalf. */
export const AU_PAIR_BRANCH_ROLES = [...PARTNER_ROLES, ...ADMIN_ROLES, "DESK_COUNSELLOR"] as const;
/**
 * The documentation department, the student mentors, the placement team and
 * the visa team all sit on the Overseas desk, as FSJ / BFD's documentation and
 * visa teams do: the documentation roles, and the admins.
 */
export const AU_PAIR_DESK_ROLES = [...DOCUMENTATION_ROLES, ...ADMIN_ROLES] as const;
/** The travel desk, run from the Overseas desk by the application team leader with the admins. */
export const AU_PAIR_TRAVEL_ROLES = ["APPLICATION_TEAM_LEADER", ...ADMIN_ROLES] as const;

export const TEAM_ROLES: Record<AuPairTeam, readonly string[]> = {
  BRANCH: AU_PAIR_BRANCH_ROLES,
  DOCUMENTATION: AU_PAIR_DESK_ROLES,
  MENTOR: AU_PAIR_DESK_ROLES,
  PLACEMENT: AU_PAIR_DESK_ROLES,
  VISA: AU_PAIR_DESK_ROLES,
  TRAVEL: AU_PAIR_TRAVEL_ROLES,
};

export type AuPairOp =
  | "counselling"
  | "registration"
  | "handover"
  | "mentor"
  | "mock"
  | "profile"
  | "hostFamily"
  | "interview"
  | "outcome"
  | "contract"
  | "payments"
  | "appointment"
  | "submitted"
  | "followUp"
  | "visaDecision"
  | "approval"
  | "checklist"
  | "departure";

/** The team whose step each move records. */
const OP_TEAM: Record<Exclude<AuPairOp, "handover" | "checklist">, AuPairTeam> = {
  counselling: "BRANCH",
  registration: "BRANCH",
  // Marking the payments verified needs the Collect fees right too, checked on the server.
  payments: "BRANCH",
  mentor: "DOCUMENTATION",
  mock: "MENTOR",
  profile: "MENTOR",
  hostFamily: "MENTOR",
  interview: "PLACEMENT",
  outcome: "PLACEMENT",
  contract: "PLACEMENT",
  appointment: "VISA",
  submitted: "VISA",
  followUp: "VISA",
  visaDecision: "VISA",
  approval: "VISA",
  departure: "TRAVEL",
};

/**
 * Whether a role may record one move. A hand-over belongs to the team handing
 * the file on, and a checklist to its step's team, so both read the step.
 */
export function mayDoAuPair(op: AuPairOp, role: string, ctx: { code?: string | null; checklistStep?: number } = {}): boolean {
  if (op === "handover") {
    const h = auPairHandoverFrom(ctx.code);
    return !!h && TEAM_ROLES[h.fromTeam].includes(role);
  }
  if (op === "checklist") {
    const step = AU_PAIR_STEPS.find((s) => s.step === ctx.checklistStep);
    return !!step && !!AU_PAIR_CHECKLISTS[step.step] && TEAM_ROLES[step.team].includes(role);
  }
  return TEAM_ROLES[OP_TEAM[op]].includes(role);
}

/* ---------------- Hand-overs ---------------- */

export type AuPairHandover = { fromCode: string; fromTeam: AuPairTeam; to: AuPairTeam; toCode: string; label: string };

/**
 * The hand-overs the guide names. The mentor's (step 4) happens by naming the
 * mentor, so it has its own form; the others are a button on the tab.
 */
export const AU_PAIR_HANDOVERS: AuPairHandover[] = [
  { fromCode: "DOCUMENT_COLLECTION", fromTeam: "BRANCH", to: "DOCUMENTATION", toCode: "MENTOR_ASSIGNMENT", label: "Hand to the Documentation Department" },
  { fromCode: "HOST_FAMILY_FOUND", fromTeam: "MENTOR", to: "PLACEMENT", toCode: "FAMILY_INTERVIEW", label: "Hand to the Placement Team" },
  { fromCode: "CONTRACT_SIGNED", fromTeam: "PLACEMENT", to: "VISA", toCode: "PRE_VISA_DOCUMENTS", label: "Hand to the Visa Team" },
  { fromCode: "VISA_RECEIVED", fromTeam: "VISA", to: "TRAVEL", toCode: "PRE_DEPARTURE", label: "Hand to the Travel Desk" },
];

export const auPairHandoverFrom = (code: string | null | undefined) => AU_PAIR_HANDOVERS.find((h) => h.fromCode === code) ?? null;

/**
 * Whether the file may be handed on from where it is. The branch's hand-over
 * also waits on the profile documents and details, checked on the server; the
 * others wait on the host family's number shared, the signed contract and the
 * joining date.
 */
export function auPairHandoverCheck(
  code: string | null | undefined,
  f: { hostFamily: string | null; contractSignedOn: string | null; joiningOn: string | null },
): { ok: true; handover: AuPairHandover } | { ok: false; why: string } {
  const h = auPairHandoverFrom(code);
  if (!h) return { ok: false, why: "There is no hand-over from this step." };
  if (h.to === "PLACEMENT" && !f.hostFamily) return { ok: false, why: "Record the interested host family before handing the candidate to the placement team." };
  if (h.to === "VISA" && !f.contractSignedOn) return { ok: false, why: "Record the signed contract before handing the file to the visa team." };
  if (h.to === "TRAVEL" && !f.joiningOn) return { ok: false, why: "Confirm the expected joining date with the host family before handing the file to the travel desk." };
  return { ok: true, handover: h };
}

/** The first step that belongs to the documentation department: the mentor, after the branch's hand-over. */
export const AU_PAIR_DESK_STEP = 4;

/**
 * Whether a status means the file is past the branch, so moving an Au pair
 * application there (from the status picker, say) hands it to the desk if
 * nobody has: the documentation team can only open a handed-over file.
 */
export function auPairPastBranch(code: string | null | undefined): boolean {
  const step = auPairStepOf(code);
  return step != null && step.step >= AU_PAIR_DESK_STEP;
}

/** The details the branch completes before the hand-over (steps 1 to 3), named one by one. */
export function auPairDetailsMissing(d: {
  medcityId: string | null | undefined;
  email: string | null | undefined;
  germanLevel: string | null | undefined;
  counsellor: string | null | undefined;
  registrationFeePaidOn: string | null | undefined;
  agreementSignedOn: string | null | undefined;
}): string[] {
  return [
    !d.medcityId ? "candidate number (Medcity ID)" : null,
    !d.email ? "email ID" : null,
    !d.germanLevel ? "German level (the German record or a German test)" : null,
    !d.counsellor ? "counsellor" : null,
    !d.registrationFeePaidOn ? "registration fee" : null,
    !d.agreementSignedOn ? "signed consultancy agreement and declaration" : null,
  ].filter((x): x is string => !!x);
}

/* ---------------- Steps 5 to 7: preparation, profile, host family, interview ---------------- */

export type MockResult = "READY" | "NEEDS_WORK";
export const MOCK_RESULT_LABEL: Record<MockResult, string> = { READY: "Ready for host family interviews", NEEDS_WORK: "More preparation needed" };

export const AU_PAIR_PLATFORMS = ["AuPair.com", "Au-pair Vermittlung", "Other"] as const;
export type AuPairPlatform = (typeof AU_PAIR_PLATFORMS)[number];

/** The platform as stored: the named one, or "Other: <name>" with the name given. */
export function platformText(platform: string, other: string | null | undefined): { ok: true; text: string } | { ok: false; why: string } {
  if (!(AU_PAIR_PLATFORMS as readonly string[]).includes(platform)) return { ok: false, why: "Pick the platform the family was found on." };
  if (platform !== "Other") return { ok: true, text: platform };
  if (!other?.trim()) return { ok: false, why: "Name the other platform." };
  return { ok: true, text: `Other: ${other.trim()}` };
}

/**
 * Whether the profile may go out (step 6): from interview preparation, after a
 * mock interview recorded as ready, with the candidate's consent. The guide:
 * "Obtain the candidate's consent before submitting the profile."
 */
export function profileCheck(a: { code: string | null | undefined; lastMock: MockResult | null | undefined; consentOn: string | null }): { ok: true } | { ok: false; why: string; field?: string } {
  if (a.code !== "INTERVIEW_PREPARATION") return { ok: false, why: "The profile is submitted from interview preparation." };
  if (a.lastMock !== "READY") return { ok: false, why: "Record a mock interview with the candidate ready before submitting the profile." };
  if (!a.consentOn) return { ok: false, why: "Record the day the candidate consented to the profile being submitted.", field: "consentOn" };
  return { ok: true };
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A host family that did not select the candidate, or withdrew after a visa refusal, is not put forward again. */
export function familyRefusal(family: string, declinedBy: string[]): string | null {
  return declinedBy.some((d) => sameName(d, family)) ? `${family.trim()} did not select the candidate, or withdrew after a visa refusal. Look for another family.` : null;
}

export const HOST_FAMILY_AT = ["PROFILE_SUBMITTED", "HOST_FAMILY_FOUND"];
export const INTERVIEW_AT = ["FAMILY_INTERVIEW"];

export type FamilyOutcome = "SELECTED" | "NOT_SELECTED";
export const FAMILY_OUTCOME_LABEL: Record<FamilyOutcome, string> = {
  SELECTED: "Selected: on to the host family contract",
  NOT_SELECTED: "Not selected: back to interview preparation, the placement continues",
};

/** Where the interview outcome sends the file: the guide's step 8 if selected, step 5 if not. */
export const afterOutcome = (o: FamilyOutcome) => (o === "SELECTED" ? "OFFER_RECEIVED" : "INTERVIEW_PREPARATION");

/** The outcome is the placement team's to record, once the interview is scheduled. */
export function outcomeCheck(a: { code: string | null | undefined; interviewAt: Date | string | null }): { ok: true } | { ok: false; why: string } {
  if (a.code !== "FAMILY_INTERVIEW") return { ok: false, why: "The outcome is recorded after the host family interview." };
  if (!a.interviewAt) return { ok: false, why: "Schedule the interview before recording its outcome." };
  return { ok: true };
}

/* ---------------- Step 8: the contract ---------------- */

export const CONTRACT_AT = ["OFFER_RECEIVED", "CONTRACT_SIGNED"];

export type ContractTerms = { pocketMoney: number | null; weeklyHours: number | null; durationMonths: number | null; signedOn: string | null };

/**
 * The contract's terms, as the placement team verifies them: pocket money a
 * month, working hours a week, the duration, and the day the candidate
 * signed. The guide sets no figures, so only plain sense is checked (a
 * positive amount, no more hours than a week has, a duration in months). A
 * signature needs the terms first, since they are explained before signing.
 */
export function contractCheck(t: ContractTerms): { ok: true; code: string } | { ok: false; why: string; field: string } {
  const whole = (n: number | null, lo: number, hi: number) => n == null || (Number.isInteger(n) && n >= lo && n <= hi);
  if (!whole(t.pocketMoney, 1, 100000)) return { ok: false, why: "Give the pocket money as a whole number of euros a month.", field: "pocketMoney" };
  if (!whole(t.weeklyHours, 1, 60)) return { ok: false, why: "Give the working hours as a whole number of hours a week, 60 at most.", field: "weeklyHours" };
  if (!whole(t.durationMonths, 1, 36)) return { ok: false, why: "Give the duration as a whole number of months.", field: "durationMonths" };
  if (t.signedOn && (t.pocketMoney == null || t.weeklyHours == null || t.durationMonths == null)) {
    return { ok: false, why: "Record the pocket money, the weekly hours and the duration, as verified and explained, before the signature.", field: t.pocketMoney == null ? "pocketMoney" : t.weeklyHours == null ? "weeklyHours" : "durationMonths" };
  }
  return { ok: true, code: t.signedOn ? "CONTRACT_SIGNED" : "OFFER_RECEIVED" };
}

/* ---------------- Steps 9 and 10: the documents and the gate before the appointment ---------------- */

/**
 * Step 3's list: what the counsellor collects. The passport, the photographs
 * and the 10th and 12th marksheets are asked of every journey already, so
 * the deploy SQL adds only the rest as Au pair rows. Optional where the guide
 * says "if applicable" or "if available".
 */
export const AU_PAIR_PROFILE_DOCUMENTS: { item: string; typeCodes: string[]; required: boolean }[] = [
  { item: "Passport copy", typeCodes: ["PASSPORT"], required: true },
  { item: "10th and 12th certificates", typeCodes: ["MARKSHEET_10", "MARKSHEET_12"], required: true },
  { item: "Degree / diploma certificates, if applicable", typeCodes: ["DEGREE_CERTIFICATE", "DIPLOMA_CERTIFICATE"], required: false },
  { item: "Resume / CV", typeCodes: ["CV"], required: true },
  { item: "Recent passport-size colour photographs", typeCodes: ["PHOTOGRAPH"], required: true },
  { item: "Childcare experience certificates, if available", typeCodes: ["CHILDCARE_EXPERIENCE"], required: false },
  { item: "German language certificates", typeCodes: ["GERMAN_CERTIFICATE"], required: true },
  { item: "Birth certificate", typeCodes: ["BIRTH_CERTIFICATE"], required: true },
];

/**
 * Step 9's list, item by item, and the document types that carry each. A
 * type the student already gave at step 3 counts here too. "Any additional
 * documents required by the German authorities" is not a type: the visa team
 * asks for it as "Other" on the Documentation tab.
 */
export const AU_PAIR_PRE_VISA: { item: string; typeCodes: string[]; required: boolean }[] = [
  { item: "Au pair contract and questionnaire", typeCodes: ["AU_PAIR_CONTRACT"], required: true },
  { item: "Informal invitation letter from the host family", typeCodes: ["HOST_FAMILY_INVITATION"], required: true },
  { item: "German language certificate", typeCodes: ["GERMAN_CERTIFICATE"], required: true },
  { item: "Passport", typeCodes: ["PASSPORT"], required: true },
  { item: "Educational certificates", typeCodes: ["MARKSHEET_10", "MARKSHEET_12"], required: true },
  { item: "CV / resume", typeCodes: ["CV"], required: true },
  { item: "Motivation letter", typeCodes: ["MOTIVATION_LETTER"], required: true },
  { item: "Accommodation proof", typeCodes: ["ACCOMMODATION"], required: true },
  { item: "Health insurance and travel insurance", typeCodes: ["INSURANCE"], required: true },
  { item: "Visa application forms", typeCodes: ["VISA_FORM"], required: true },
  { item: "Biometric photograph (35 x 45 mm, as currently required)", typeCodes: ["BIOMETRIC_PHOTO"], required: true },
  { item: "Declaration form", typeCodes: ["VISA_DECLARATION"], required: true },
  { item: "Cover letter", typeCodes: ["COVER_LETTER"], required: true },
  { item: "Annex for employment data, if applicable", typeCodes: ["ANNEX_EMPLOYMENT_DATA"], required: false },
  { item: "Birth certificate", typeCodes: ["BIRTH_CERTIFICATE"], required: true },
  { item: "Aadhaar and PAN cards, if required", typeCodes: ["AADHAAR_PAN"], required: false },
  { item: "Contact information form", typeCodes: ["CONTACT_INFORMATION_FORM"], required: true },
  { item: "Host family identification documents", typeCodes: ["HOST_FAMILY_ID"], required: true },
];

/** One document's standing as the checklist has it, enough to say whether a list item is in. */
export type DocState = { typeCode: string; state: string };

/** The items of a list that are required and not yet accepted (or marked not needed) on the student's checklist. */
export function listMissing(list: { item: string; typeCodes: string[]; required: boolean }[], rows: DocState[]): string[] {
  const done = (code: string) => rows.some((r) => r.typeCode === code && (r.state === "ACCEPTED" || r.state === "NOT_NEEDED"));
  return list.filter((l) => l.required && !l.typeCodes.every(done)).map((l) => l.item);
}

/** What the visa gate reads: the payments verified, the signed contract, the pre-visa documents still missing. */
export type AuPairVisaFacts = { paymentsVerifiedOn: string | null | undefined; contractSignedOn: string | null | undefined; documentsMissing: string[] };

/** Whether the file may go to the appointment, and what is still missing. */
export function auPairVisaGate(f: AuPairVisaFacts): { clear: boolean; missing: string[] } {
  const missing = [!f.paymentsVerifiedOn ? "payment verification" : null, !f.contractSignedOn ? "signed host family contract" : null, ...f.documentsMissing].filter((x): x is string => !!x);
  return { clear: missing.length === 0, missing };
}

/** The visa gate's refusal, in sentences a person can act on. */
export function auPairVisaGateText(f: AuPairVisaFacts): string {
  const out: string[] = [];
  if (!f.paymentsVerifiedOn) out.push("The payments are not verified: every applicable payment is completed before the appointment, as per company policy.");
  if (!f.contractSignedOn) out.push("The signed host family contract is not recorded.");
  if (f.documentsMissing.length) out.push(`Pre-visa documents still needed: ${f.documentsMissing.join(", ")}.`);
  return out.join(" ");
}

/** The appointment (step 10): moving a file onto it or past it needs the visa gate. */
export const AU_PAIR_VISA_STEP = 10;

/**
 * Whether a status move takes the file past the visa gate: from before the
 * appointment (or from a status the guide does not place, such as a held
 * file) onto it or any later step. Moves within the visa stage and after it
 * are not checked again.
 */
export function crossesAuPairVisaGate(from: string | null | undefined, to: string | null | undefined): boolean {
  const toStep = auPairStepOf(to)?.step;
  if (toStep == null || toStep < AU_PAIR_VISA_STEP) return false;
  const fromStep = auPairStepOf(from)?.step;
  return fromStep == null || fromStep < AU_PAIR_VISA_STEP;
}

/** Where the payments can be verified: from the visa team's first step until the appointment, and again for a resubmission. */
export const PAYMENTS_AT = ["PRE_VISA_DOCUMENTS"];
/** The appointment is booked from pre-visa documentation, and rebooked while it stands. */
export const APPOINTMENT_AT = ["PRE_VISA_DOCUMENTS", "VISA_APPOINTMENT"];

/* ---------------- Steps 11 and 12: the decision ---------------- */

export type VisaOutcome = "APPROVED" | "REJECTED";
export type AfterRefusal = "RESUBMIT" | "ANOTHER_FAMILY" | "CLOSE";
export const AFTER_REFUSAL_LABEL: Record<AfterRefusal, string> = {
  RESUBMIT: "The host family still wants the candidate: correct the file and apply again",
  ANOTHER_FAMILY: "The host family has withdrawn: back to interview preparation, the placement continues",
  CLOSE: "Close the case as visa rejected",
};

/**
 * Where the visa decision sends the file. Approved is the visa received. A
 * refusal needs its reason and what happens next, as FSJ / BFD records it:
 * the visa team corrects the file and books again while the family still
 * wants the candidate, the file goes back to interview preparation for
 * another family (the not-selected loop of step 7), or the case is closed.
 */
export function afterVisaDecision(d: { outcome: VisaOutcome; reason: string | null; afterRefusal: AfterRefusal | null | undefined }): { ok: true; code: string } | { ok: false; why: string; field: "reason" | "afterRefusal" } {
  if (d.outcome === "APPROVED") return { ok: true, code: "VISA_RECEIVED" };
  if (!d.reason?.trim()) return { ok: false, why: "Give the reason for the refusal.", field: "reason" };
  if (d.afterRefusal === "RESUBMIT") return { ok: true, code: "PRE_VISA_DOCUMENTS" };
  if (d.afterRefusal === "ANOTHER_FAMILY") return { ok: true, code: "INTERVIEW_PREPARATION" };
  if (d.afterRefusal === "CLOSE") return { ok: true, code: "VISA_REJECTED" };
  return { ok: false, why: "Say what happens next: apply again with this family, another family, or close the case.", field: "afterRefusal" };
}

/* ---------------- Checklists ---------------- */

/** The guide's points that are done rather than decided, ticked on the step they belong to. */
export const AU_PAIR_CHECKLISTS: Record<number, { key: string; label: string }[]> = {
  1: [
    { key: "ap1.profile", label: "Profile evaluated: age, qualification, English and German" },
    { key: "ap1.programme", label: "Au pair programme and requirements explained" },
    { key: "ap1.finance", label: "Financial counselling: service charges, expenses, visa charges, compensation terms" },
    { key: "ap1.preferences", label: "Career goals and first and second preferences discussed" },
    { key: "ap1.intake", label: "Intended intake and availability discussed" },
    { key: "ap1.refund", label: "Refund policy explained" },
    { key: "ap1.german", label: "German details collected: level, year, module-wise certificates" },
  ],
  2: [
    { key: "ap2.form", label: "Registration form (candidate form) completed" },
    { key: "ap2.whatsapp", label: "Documentation team told on WhatsApp" },
  ],
  5: [
    { key: "ap5.general", label: "General Au pair interview preparation" },
    { key: "ap5.situation", label: "Stream-specific or situation-based preparation" },
  ],
  6: [
    { key: "ap6.updated", label: "Candidate's profile updated" },
    { key: "ap6.introduced", label: "Introduced to suitable host families" },
    { key: "ap6.shared", label: "Host family's number shared with the candidate" },
  ],
  8: [
    { key: "ap8.received", label: "Contract received from the host family" },
    { key: "ap8.duties", label: "Duties verified with the pocket money, hours and duration" },
    { key: "ap8.explained", label: "Terms explained to the candidate" },
    { key: "ap8.returned", label: "Signed contract sent to the family and the completed documents obtained" },
  ],
  10: [
    { key: "ap10.order", label: "Documents arranged in the correct order" },
    { key: "ap10.guided", label: "Candidate guided on the submission at the visa centre" },
    { key: "ap10.biometrics", label: "Biometrics and the visa centre's other procedures completed" },
  ],
  12: [
    { key: "ap12.passport", label: "Passport collection or return confirmed" },
    { key: "ap12.details", label: "Visa details verified" },
    { key: "ap12.family", label: "Host family told about the visa approval" },
  ],
  13: [
    { key: "ap13.flight", label: "Flight booked after the travel plan was confirmed" },
    { key: "ap13.orientation", label: "Pre-departure orientation" },
    { key: "ap13.requirements", label: "Travel requirements and essential documents explained" },
    { key: "ap13.testimonial", label: "Testimonial collected, where applicable" },
    { key: "ap13.airport", label: "Airport drop-off or pickup arranged as required" },
    { key: "ap13.schedule", label: "Flight schedule confirmed with the candidate and teams" },
  ],
  14: [
    { key: "ap14.flight", label: "Flight details confirmed" },
    { key: "ap14.documents", label: "Required travel documents with the candidate" },
    { key: "ap14.update", label: "Departure confirmed and the travel update shared with the team" },
    { key: "ap14.family", label: "Host family told about the travel status" },
  ],
  15: [
    { key: "ap15.happyCall", label: "Happy call after arrival" },
    { key: "ap15.safe", label: "Safe arrival in Germany confirmed" },
    { key: "ap15.received", label: "Host family has received the candidate" },
    { key: "ap15.testimonial", label: "Testimonial after arrival, where applicable" },
    { key: "ap15.references", label: "References collected, where applicable" },
    { key: "ap15.recorded", label: "Arrival status updated in the records" },
  ],
};

/**
 * A checklist is ticked from its own step on, so a point done late can still
 * be ticked. The departure list also opens during pre-departure, since the
 * travel desk prepares it then, and the arrival list once the candidate has
 * departed: its happy call is what starts the follow-up.
 */
export function auPairChecklistOpen(step: number, code: string | null | undefined): boolean {
  const at = auPairStepOf(code)?.step ?? 0;
  if (!AU_PAIR_CHECKLISTS[step]) return false;
  return at >= step || ((step === 14 || step === 15) && at === step - 1);
}

/** The ticks a checklist save leaves on the file: other steps' ticks kept, this step's replaced by what was sent. */
export function mergeAuPairChecklist(held: readonly string[], step: number, sent: readonly string[]): string[] {
  const items = AU_PAIR_CHECKLISTS[step] ?? [];
  const keys = new Set(items.map((i) => i.key));
  return [...held.filter((k) => !keys.has(k)), ...items.map((i) => i.key).filter((k) => sent.includes(k))];
}

/** The happy call starts the follow-up: ticking it on a file that has departed moves it to step 15. */
export const afterAuPairChecklist = (step: number, code: string | null | undefined, done: readonly string[]) => (step === 15 && code === "JOINED" && done.includes("ap15.happyCall") ? "HAPPY_CALL" : null);

/* ---------------- The registration email (step 2) ---------------- */

export const AU_PAIR_CONTACT_AREA = "Au pair (Germany)";

/** The address the guide names, the starting row for the Contacts list. */
export const AU_PAIR_TEAM: { name: string; title: string; email: string; level: number; sortOrder: number }[] = [
  { name: "Au pair documentation team", title: "Receives the candidate's details at registration, from the branch, with WhatsApp to follow", email: "aupair@miak.in", level: 1, sortOrder: 10 },
];

export type AuPairDraftFacts = {
  student: string;
  medcityId: string | null;
  email: string | null;
  phone: string | null;
  germanLevel: string | null;
  branch: string | null;
  counsellor: string | null;
  registeredOn: string | null;
  registrationFeePaidOn: string | null;
  agreementSignedOn: string | null;
  intake: string | null;
};

/**
 * The registration email as text a person copies into their own mail: the
 * guide's "send an email to the Documentation Team at aupair@miak.in", with
 * the branch head in copy (the other concerned addresses are added by the
 * sender, as the internal procedure says). Nothing is sent from the portal; a
 * fact the file does not hold reads "Not recorded".
 */
export function registrationDraft(f: AuPairDraftFacts, addresses: { to: string[]; cc: string[] }) {
  const NR = "Not recorded";
  const who = `${f.student}${f.medcityId ? ` (${f.medcityId})` : ""}`;
  const line = (label: string, v: string | null | undefined) => `${label}: ${v?.trim() ? v.trim() : NR}`;
  const subject = `Au pair registration: ${who}`;
  const body = [
    "A candidate has registered for the Au pair programme.",
    "",
    line("Candidate", f.student),
    line("Candidate number", f.medcityId),
    line("Email", f.email),
    line("Mobile", f.phone),
    line("German level", f.germanLevel),
    line("Intended intake", f.intake),
    line("Registration date", f.registeredOn),
    line("Registration fee paid on", f.registrationFeePaidOn),
    line("Consultancy agreement and declaration signed on", f.agreementSignedOn),
    line("Branch", f.branch),
    line("Counsellor", f.counsellor),
    "",
    "Medcity Overseas",
  ];
  const text = [`To: ${addresses.to.join("; ") || NR}`, `Cc: ${addresses.cc.join("; ") || "None"}`, `Subject: ${subject}`, "", ...body].join("\n");
  return { subject, body: body.join("\n"), text, to: addresses.to, cc: addresses.cc };
}

/** The notice to the branch that the registration email is theirs to send, and to whom. */
export function registrationNoticeText(to: string[], cc: string[], noAddress: string[]): string {
  return [
    "The registration email to the Documentation Team is for the counsellor / branch team to send, with a WhatsApp message to the team.",
    `To: ${to.join("; ") || "Not recorded"}.`,
    `Cc: ${cc.join("; ") || "None"}, and the concerned addresses as per the internal procedure.`,
    noAddress.length ? `No email on record for ${noAddress.join(", ")}.` : "",
    "The text to copy is on step 2 of the Au pair tab. The portal does not send it.",
  ]
    .filter(Boolean)
    .join(" ");
}

/* ---------------- The student portal ---------------- */

/** What each step means for the candidate, in plain words. No teams, no addresses. */
export const AU_PAIR_STUDENT_STEP: Record<number, string> = {
  1: "Talking through the Au pair programme with your counsellor",
  2: "Registering with us and signing the agreement",
  3: "Collecting your documents",
  4: "Our documentation team is choosing your mentor",
  5: "Practising for your host family interviews with your mentor",
  6: "Sharing your profile with host families, with your consent",
  7: "Your interview with a host family",
  8: "Your host family contract",
  9: "Preparing your visa documents",
  10: "Your visa appointment",
  11: "Your visa is being processed",
  12: "Your visa is approved",
  13: "Getting you ready to travel",
  14: "Flying to Germany to meet your host family",
  15: "Settling in with your host family: we stay in touch",
};

/**
 * The Au pair application the student portal and the staff tab follow: the
 * open one that moved most recently, a finished one giving way to one still
 * being worked. Null where there is none.
 */
export function pickAuPairApplication<T extends { pathway: string; statusGroup: string; changedAt: Date | string | null }>(apps: T[]): T | null {
  const open = apps.filter((a) => a.pathway === "AU_PAIR" && a.statusGroup !== "CLOSED");
  if (!open.length) return null;
  const at = (a: T) => (a.changedAt ? new Date(a.changedAt).getTime() : 0);
  return [...open].sort((a, b) => (a.statusGroup === "SUCCESS" ? 1 : 0) - (b.statusGroup === "SUCCESS" ? 1 : 0) || at(b) - at(a))[0];
}

/** The programme facts the guide gives, shown as information; nothing checks a student against them. */
export const AU_PAIR_FACTS: { label: string; value: string }[] = [
  { label: "Destination", value: "Germany, with a host family" },
  { label: "Age", value: "Usually 18 to 26 years" },
  { label: "Qualification", value: "+2, diploma or degree" },
  { label: "Language", value: "English and German" },
];
