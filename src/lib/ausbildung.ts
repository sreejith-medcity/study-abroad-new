/**
 * Plain helpers for Ausbildung and the service charge, shared by the server
 * and the screens.
 */
import { ADMIN_ROLES, DOCUMENTATION_ROLES, PARTNER_ROLES } from "./permissions";

/** The German levels a student works through, in order. */
export const GERMAN_LEVELS = ["A1", "A2", "B1", "B2"] as const;
export type GermanLevel = (typeof GERMAN_LEVELS)[number];
export type ModuleState = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export const MODULE_STATE_LABEL: Record<ModuleState, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

/**
 * The fields Ausbildung places are usually in, offered as suggestions on the
 * three preferences. Suggestions only: anything can be typed.
 */
export const AUSBILDUNG_FIELDS = [
  "Nursing (Pflegefachmann/-frau)",
  "Elderly care (Altenpflege)",
  "Medical assistant (MFA)",
  "Dental assistant (ZFA)",
  "Hotel management (Hotelfachmann/-frau)",
  "Chef (Koch/Köchin)",
  "Restaurant services (Fachmann/-frau für Restaurants)",
  "Retail (Kaufmann/-frau im Einzelhandel)",
  "Logistics (Fachkraft für Lagerlogistik)",
  "Mechatronics (Mechatroniker/-in)",
  "Electrician (Elektroniker/-in)",
  "IT specialist (Fachinformatiker/-in)",
  "Industrial mechanic (Industriemechaniker/-in)",
  "Bakery (Bäcker/-in)",
];

/**
 * The German levels a student has finished and the ones still to do, from
 * whatever rows there are. A level with no row is not started.
 */
export function moduleStanding(rows: { level: string; state: ModuleState }[]) {
  const by = new Map(rows.map((r) => [r.level, r.state]));
  const levels = GERMAN_LEVELS.map((level) => ({ level, state: (by.get(level) ?? "NOT_STARTED") as ModuleState }));
  return {
    levels,
    done: levels.filter((l) => l.state === "COMPLETED").map((l) => l.level),
    incomplete: levels.filter((l) => l.state !== "COMPLETED").map((l) => l.level),
  };
}

/**
 * Money on these screens: rupees with the rupee sign, the way the branches
 * say it, and any other currency with its code.
 */
export function chargeMoney(amount: number, currency: string) {
  if (currency === "INR") return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  return `${currency} ${new Intl.NumberFormat("en-IN").format(amount)}`;
}

/** A Date as the "YYYY-MM-DDTHH:mm" a datetime-local box wants, in IST. */
export function toIstInput(d: Date | null | undefined) {
  if (!d) return "";
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().slice(0, 16);
}

/* ---------------- The written process ---------------- */

/*
 * Medcity's Ausbildung process, as the written guide lays it out: nineteen
 * steps across five desks, each with a turnaround. The statuses in the
 * database are what the desk records; this is the map from those statuses to
 * the guide's steps, so the tracker can say which desk a file is with and
 * whether it has sat there longer than the guide allows. Kept in one place so
 * the tracker, the student's tab, the tests and the process document all read
 * the same thing. It is a guide, not a rule: nothing here stops a status move.
 */

export type AusbildungDepartment = "COUNSELLING" | "DOCUMENTATION" | "LANGUAGE" | "PLACEMENT" | "VISA" | "TRAVEL";

export const AUSBILDUNG_DEPARTMENTS: { key: AusbildungDepartment; label: string; who: string }[] = [
  { key: "COUNSELLING", label: "Counselling", who: "Counsellor and branch team" },
  { key: "DOCUMENTATION", label: "Documentation", who: "Documentation mentor" },
  { key: "LANGUAGE", label: "Language and interview prep", who: "Student mentor (language specialist)" },
  { key: "PLACEMENT", label: "Placement", who: "Placement team" },
  { key: "VISA", label: "Visa", who: "Visa team" },
  { key: "TRAVEL", label: "Travel desk", who: "Travel desk" },
];

export const DEPARTMENT_LABEL: Record<AusbildungDepartment, string> = Object.fromEntries(AUSBILDUNG_DEPARTMENTS.map((d) => [d.key, d.label])) as Record<AusbildungDepartment, string>;

export type AusbildungStep = {
  /** The step's number in the guide, 1 to 19. */
  step: number;
  title: string;
  department: AusbildungDepartment;
  /**
   * The guide's turnaround in days ("T+7" is seven), or null where the guide
   * says it depends on something else: the German level taken, the slot the
   * embassy has. Null is shown as the guide's own words, never as a number.
   */
  tatDays: number | null;
  tatNote?: string;
  /** The application statuses that mean a file is at this step. */
  statusCodes: string[];
  /** Who the file is handed to at the end of the step, where the guide names an address. */
  handover?: string;
};

export const AUSBILDUNG_STEPS: AusbildungStep[] = [
  { step: 1, title: "Student enquiry and initial counselling", department: "COUNSELLING", tatDays: null, tatNote: "At the enquiry", statusCodes: [] },
  { step: 2, title: "Registration and agreement", department: "COUNSELLING", tatDays: 1, statusCodes: [], handover: "ausbildung@miak.in" },
  { step: 3, title: "Document collection", department: "COUNSELLING", tatDays: 7, statusCodes: ["DOCUMENT_COLLECTION"] },
  { step: 4, title: "Assigning a mentor to the candidate", department: "DOCUMENTATION", tatDays: 0, tatNote: "Same day", statusCodes: ["MENTOR_ASSIGNED"] },
  { step: 5, title: "German language training", department: "LANGUAGE", tatDays: null, tatNote: "Depends on the level taken", statusCodes: ["LANGUAGE_PENDING"] },
  { step: 6, title: "Document preparation and translation", department: "DOCUMENTATION", tatDays: 7, statusCodes: ["DOCUMENT_PREPARATION", "PROFILE_CV"], handover: "translation.germany@miak.in" },
  { step: 7, title: "Interview readiness", department: "LANGUAGE", tatDays: null, tatNote: "Depends on the language level and the payment", statusCodes: ["LANGUAGE_ASSESSMENT"] },
  { step: 8, title: "Interview preparation", department: "LANGUAGE", tatDays: 14, statusCodes: ["MOCK_INTERVIEW_PASSED"] },
  { step: 9, title: "Profile submission to employers", department: "DOCUMENTATION", tatDays: 7, statusCodes: ["EMPLOYER_MATCHING", "PROFILE_SUBMITTED", "EMPLOYER_SHORTLISTED"], handover: "placementassistant@miak.in" },
  { step: 10, title: "Interview scheduling", department: "PLACEMENT", tatDays: 30, tatNote: "First interview within 7 days", statusCodes: ["EMPLOYER_INTERVIEW"] },
  { step: 11, title: "Training contract (Ausbildungsvertrag)", department: "PLACEMENT", tatDays: 0, tatNote: "Same day", statusCodes: ["CONTRACT_SIGNED", "RECOGNITION"] },
  { step: 12, title: "Pre-visa documentation", department: "VISA", tatDays: 7, statusCodes: ["PRE_VISA_DOCUMENTS"] },
  { step: 13, title: "Visa appointment", department: "VISA", tatDays: null, tatNote: "Depends on slot availability, roughly 1 to 2 weeks", statusCodes: ["VISA_FILED"] },
  { step: 14, title: "Visa processing", department: "VISA", tatDays: 30, tatNote: "4 to 6 weeks on average", statusCodes: ["VISA_PROCESSING"] },
  { step: 15, title: "Visa approval", department: "VISA", tatDays: 1, statusCodes: ["VISA_RECEIVED"] },
  { step: 16, title: "Pre-departure process", department: "TRAVEL", tatDays: 14, statusCodes: ["PRE_DEPARTURE"] },
  // The guide numbers the departure 18 and the follow-up 19, after repeating
  // steps 14 to 16 under the visa heading. The numbers here are the ones the
  // team quotes.
  { step: 18, title: "Departure to Germany", department: "TRAVEL", tatDays: 7, statusCodes: ["JOINED"] },
  { step: 19, title: "Destination Germany: happy call", department: "TRAVEL", tatDays: 7, statusCodes: ["HAPPY_CALL"] },
];

/** The guide's step a status belongs to, or null for a status the guide does not place (on hold, closed). */
export function stepOfStatus(code: string | null | undefined): AusbildungStep | null {
  if (!code) return null;
  return AUSBILDUNG_STEPS.find((s) => s.statusCodes.includes(code)) ?? null;
}

/** The desk a file is with, read off its status. */
export const departmentOfStatus = (code: string | null | undefined): AusbildungDepartment | null => stepOfStatus(code)?.department ?? null;

/* ---------------- The hand-over to the documentation desk ---------------- */

/*
 * The guide has the branch collect the documents (step 3) and then transfer
 * the candidate to the documentation department, which names a mentor (step
 * 4). In the portal the documentation desk can only open a student whose
 * application has been handed over, so the hand-over is the moment the desk
 * is let in. The branch does it on purpose with the hand-over button, and it
 * also happens by itself when somebody moves the status to step 4 or later:
 * a file at "Mentor assigned" is with the desk whatever button was pressed.
 */

/** The first step the guide gives to the documentation desk: assigning a mentor. */
export const DESK_HANDOVER_STEP = 4;

/**
 * Whether a status means the file is with the documentation desk or past it,
 * so moving an Ausbildung application there hands it over if nobody has. A
 * status the guide does not place (on hold, closed) hands nothing over.
 */
export function handedToDeskByStatus(code: string | null | undefined): boolean {
  const step = stepOfStatus(code);
  return step != null && step.step >= DESK_HANDOVER_STEP;
}

/** Whether a status is at the branch's end of the process, before the desk has it. */
export function beforeTheDesk(code: string | null | undefined): boolean {
  const step = stepOfStatus(code);
  return step != null && step.step < DESK_HANDOVER_STEP;
}

/** Who hands an Ausbildung file to the desk: the branch, the head office counsellors, and the admins on their behalf. */
export const AUSBILDUNG_HANDOVER_ROLES = [...PARTNER_ROLES, ...ADMIN_ROLES, "DESK_COUNSELLOR"] as const;

/** Who names the mentor: the documentation desk, and the admins. */
export const MENTOR_SETTING_ROLES = [...DOCUMENTATION_ROLES, ...ADMIN_ROLES] as const;

export type DeskHandoverCheck = { ready: boolean; why: string | null };

/**
 * Whether the branch may hand an Ausbildung file to the documentation desk.
 *
 * The gate is the profile documents the guide has the branch collect at step
 * 3, named rather than hidden behind a refusal, because a file that reaches the
 * desk short of paper only comes back. A file already with the desk, or one
 * that is closed, is not handed over again.
 */
export function canHandToDesk(args: { handedOver: boolean; closed: boolean; gateClear: boolean; missing: string[] }): DeskHandoverCheck {
  if (args.closed) return { ready: false, why: "This application is closed." };
  if (args.handedOver) return { ready: false, why: "Already with the documentation desk." };
  if (!args.gateClear) return { ready: false, why: `Still needed before this can go: ${args.missing.join(", ")}.` };
  return { ready: true, why: null };
}

/*
 * The mentor the documentation desk names at step 4 is kept as a person on
 * the student's file, under this part, which is the guide's own name for the
 * role. Being on the file is what opens the student to them and what the
 * people-on-file panel shows, so no new column was needed.
 */
export const MENTOR_PART = "Documentation mentor";

/** The desks whose steps the mentor carries, so a follow-up task on one goes to the mentor first. */
export const MENTOR_DEPARTMENTS: AusbildungDepartment[] = ["DOCUMENTATION", "LANGUAGE"];

export const mentorOwnsStep = (department: AusbildungDepartment | null | undefined) => department != null && MENTOR_DEPARTMENTS.includes(department);

/** Whole days between two instants, never negative. */
export const daysBetween = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));

/**
 * How a file sits against the guide's turnaround: the days it has been in its
 * status, the days the guide allows, and whether it is over. Over is only said
 * where the guide gives a number; "depends on the slot" is never late.
 */
export function tatStanding(code: string | null | undefined, since: Date | null | undefined, now = new Date()) {
  const step = stepOfStatus(code);
  const days = since ? daysBetween(since, now) : null;
  const tatDays = step?.tatDays ?? null;
  const over = tatDays != null && days != null && days > tatDays;
  return {
    step,
    days,
    tatDays,
    tatNote: step?.tatNote ?? null,
    over,
    /** How many days past the turnaround the file is; zero while it is within it. */
    daysOver: over && days != null && tatDays != null ? days - tatDays : 0,
  };
}

/**
 * Whether a file is over its step's turnaround, and by how many days, for the
 * daily follow-through and the filters. The same arithmetic as the tracker's
 * cell, read from tatStanding, so a file the cell marks in warning colour is
 * the file the desk is told about, never one or the other.
 */
export function tatOverdue(code: string | null | undefined, since: Date | null | undefined, now = new Date()) {
  const standing = tatStanding(code, since, now);
  return { over: standing.over, daysOver: standing.daysOver, days: standing.days, step: standing.step };
}

/**
 * The status codes the guide gives a number of days to, with the days each
 * allows. A step whose turnaround depends on something else is left out: it
 * can never be over, so a query for over files has nothing to ask about it.
 */
export function timedStatusCodes(): { code: string; step: number; tatDays: number }[] {
  return AUSBILDUNG_STEPS.filter((s): s is AusbildungStep & { tatDays: number } => s.tatDays != null).flatMap((s) => s.statusCodes.map((code) => ({ code, step: s.step, tatDays: s.tatDays })));
}

/*
 * Who is told when a step runs over, by desk. The documentation mentors own the
 * documentation and language steps between them; the placement, visa and
 * travel steps are the Overseas desk's, run by the application team leader
 * with the admins; the counselling steps are the branch's, so the branch head
 * and the student's own counsellor hear about those. Travel is not named in
 * the brief, and is put with the Overseas desk because the pre-departure and
 * departure work is done from there.
 */
export type TatOwners = {
  /** The staff roles told, every active account in them. Empty for a branch's own step. */
  roles: string[];
  /** Whether the student's branch head and counsellor are the ones told. */
  branch: boolean;
};

export function tatOwners(department: AusbildungDepartment | null | undefined): TatOwners {
  switch (department) {
    case "DOCUMENTATION":
    case "LANGUAGE":
      return { roles: [...DOCUMENTATION_ROLES], branch: false };
    case "PLACEMENT":
    case "VISA":
    case "TRAVEL":
      return { roles: ["APPLICATION_TEAM_LEADER", ...ADMIN_ROLES], branch: false };
    case "COUNSELLING":
      return { roles: [], branch: true };
    default:
      return { roles: [], branch: false };
  }
}

/** The key a turnaround follow-up task is raised under: one per application, per stay in a step. */
export const tatTaskKey = (applicationId: string, step: number, since: Date) => `ausbildung-tat:${applicationId}:${step}:${since.toISOString()}`;

/** Every turnaround task key starts with this, which is how a stay is checked for one. */
export const TAT_TASK_KEY_PREFIX = "ausbildung-tat:";

/** The turnaround in words: "T+7", "same day", or the guide's note. */
export function tatText(step: AusbildungStep | null) {
  if (!step) return "";
  if (step.tatDays == null) return step.tatNote ?? "No turnaround set";
  if (step.tatDays === 0) return step.tatNote ?? "Same day";
  return `T+${step.tatDays}${step.tatNote ? ` (${step.tatNote.toLowerCase()})` : ""}`;
}

/*
 * When the service charge falls due, as the guide has it: a registration fee
 * at step 2, half before the interview readiness assessment, the balance 30
 * percent (80 in all) when the training contract comes, and the whole of it
 * before the visa file goes in. Percentages of the charge raised on the
 * student; the registration fee is a separate one-time amount the guide does
 * not put a figure on, so none is shown.
 */
export type PaymentMilestone = { step: number; label: string; percent: number | null; when: string };

export const AUSBILDUNG_PAYMENT_MILESTONES: PaymentMilestone[] = [
  { step: 2, label: "Registration fee", percent: null, when: "At registration, with the consultancy agreement" },
  { step: 7, label: "50% of the service charge", percent: 50, when: "Before the interview readiness assessment" },
  { step: 11, label: "80% of the service charge", percent: 80, when: "When the training contract is issued (the balance 30%)" },
  { step: 12, label: "100% of the service charge", percent: 100, when: "Before the visa file is submitted" },
];

/** Whole percent of what was raised that has come in; null where nothing was raised. */
export function percentPaid(owed: number, received: number): number | null {
  if (owed <= 0) return null;
  return Math.min(100, Math.floor((received / owed) * 100));
}

/**
 * Each milestone against what has come in: the amount it needs and whether it
 * is met. With nothing raised there is no figure to measure, so the amounts
 * are null and nothing is marked met.
 */
export function paymentMilestones(owed: number, received: number) {
  return AUSBILDUNG_PAYMENT_MILESTONES.map((m) => {
    const amount = m.percent != null && owed > 0 ? Math.round((owed * m.percent) / 100) : null;
    return { ...m, amount, met: amount != null && received >= amount };
  });
}

/**
 * The milestone the file should have reached by a status, so the tab can say
 * "the guide expects 50% paid before interview readiness" beside the status
 * the file is actually at. Null before any payment milestone applies.
 */
export function milestoneDueAt(code: string | null | undefined): PaymentMilestone | null {
  const step = stepOfStatus(code);
  if (!step) return null;
  const due = AUSBILDUNG_PAYMENT_MILESTONES.filter((m) => m.percent != null && m.step <= step.step);
  return due.length ? due[due.length - 1] : null;
}

/**
 * The hand-over addresses the guide names, and what each receives. These are
 * the starting rows for the Contacts list, under one area, where the team
 * edits them; the tracker reads the list and falls back to these only while
 * the list has no row for the area.
 */
export const AUSBILDUNG_CONTACT_AREA = "Ausbildung (Germany)";

export const AUSBILDUNG_TEAM: { name: string; title: string; email: string; level: number; sortOrder: number }[] = [
  { name: "Ausbildung documentation team", title: "Receives the registration hand-over from the counsellor, with the branch head in copy", email: "ausbildung@miak.in", level: 1, sortOrder: 10 },
  { name: "Translation desk, Germany", title: "Receives the documents for German translation", email: "translation.germany@miak.in", level: 1, sortOrder: 20 },
  { name: "Placement team manager", title: "Receives the interview-ready confirmation from the student mentor", email: "placementassistant@miak.in", level: 1, sortOrder: 30 },
  { name: "Regional head, South", title: "In copy on every placement hand-over", email: "regionalhead.south@miak.in", level: 2, sortOrder: 40 },
];
