/**
 * The nine stages, and what a document on a student's list is at this moment.
 *
 * Everything here is pure: the same rules decide the gate on a student file, in
 * the documentation queue, in the student's own portal and in a test. Dates are
 * measured against the course start, never against today, which is the mistake
 * that costs a visa.
 */

import type { ChecklistState, JourneyStage, OwedBy, RequirementSource } from "@/db/schema";

export const STAGES: { value: JourneyStage; number: number; label: string; blurb: string }[] = [
  { value: "PROFILE", number: 1, label: "Profile", blurb: "Who the student is, and what they have studied" },
  { value: "SHORTLIST", number: 2, label: "Shortlist", blurb: "Courses chosen, nothing new asked for" },
  { value: "APPLICATION", number: 3, label: "Application", blurb: "What the university and the route ask for" },
  { value: "OFFER", number: 4, label: "Offer", blurb: "The offer, its conditions and the acceptance" },
  { value: "DEPOSIT", number: 5, label: "Deposit", blurb: "The tuition deposit and where the money came from" },
  { value: "CONFIRMATION", number: 6, label: "Confirmation", blurb: "CAS, I-20, CoE or LOA, by destination" },
  { value: "VISA", number: 7, label: "Visa", blurb: "The visa file, funds and the tests" },
  { value: "DEPARTURE", number: 8, label: "Departure", blurb: "Ticket, insurance, accommodation, forex, SIM" },
  { value: "ARRIVED", number: 9, label: "Arrived", blurb: "Enrolment, residence permit and a local account" },
];

export const STAGE_ORDER = STAGES.map((s) => s.value);
export const stageInfo = (stage: JourneyStage) => STAGES[STAGE_ORDER.indexOf(stage)];
export const stageLabel = (stage: JourneyStage) => `${stageInfo(stage).number}. ${stageInfo(stage).label}`;
export const stageRank = (stage: JourneyStage) => STAGE_ORDER.indexOf(stage);
export const nextStage = (stage: JourneyStage): JourneyStage | null => STAGE_ORDER[stageRank(stage) + 1] ?? null;

export const SOURCE_LABEL: Record<RequirementSource, string> = {
  ALWAYS: "Always",
  DESTINATION: "The destination",
  ROUTE: "The route",
  UNIVERSITY: "The university",
  STUDENT: "Added for this student",
};

export const OWED_BY_LABEL: Record<OwedBy, string> = {
  STUDENT: "Student",
  MEDCITY: "Medcity",
  UNIVERSITY: "University",
  VENDOR: "Vendor",
};

export const STATE_LABEL: Record<ChecklistState, string> = {
  NOT_NEEDED: "Not needed",
  NOT_ASKED: "Not asked",
  ASKED: "Asked",
  UPLOADED: "Uploaded",
  IN_REVIEW: "In review",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
};

/** What each state means, shown once on the screen so a new joiner reads the same rules. */
export const STATE_MEANS: Record<ChecklistState, string> = {
  NOT_NEEDED: "On the list for the stage, but not for this student, with a reason",
  NOT_ASKED: "Needed, nobody has asked the student yet",
  ASKED: "Requested, with the date and the channel it went out on",
  UPLOADED: "A file is in, nobody has checked it",
  IN_REVIEW: "Claimed by somebody in the documentation team",
  ACCEPTED: "Good enough to send to the university or the vendor",
  REJECTED: "Sent back with a reason the student can act on",
};

/** How a document reads once its dates are weighed against the course start. */
export type Standing = "DONE" | "EXPIRING" | "EXPIRED" | "OUTSTANDING" | "SKIPPED";

export type ItemDates = {
  state: ChecklistState;
  /** The day it stops being good for. Null where no date is on record. */
  validTo: Date | string | null;
};

/** A document expiring inside this many days of the course start is flagged. */
export const EXPIRY_WARNING_DAYS = 60;

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const days = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / 86_400_000);

/**
 * Where one item stands.
 *
 * An accepted document that runs out before the course starts is not done: it
 * counts as missing at the gate, and says so. Where no course start is known
 * the date is weighed against today instead, which is the best that can be said.
 */
export function standing(item: ItemDates, courseStart: Date | string | null, today = new Date()): { standing: Standing; expiresInDays: number | null } {
  if (item.state === "NOT_NEEDED") return { standing: "SKIPPED", expiresInDays: null };
  const validTo = asDate(item.validTo);
  const against = asDate(courseStart) ?? today;
  const expiresInDays = validTo ? days(today, validTo) : null;
  if (item.state !== "ACCEPTED") return { standing: "OUTSTANDING", expiresInDays };
  if (!validTo) return { standing: "DONE", expiresInDays: null };
  if (validTo.getTime() < against.getTime()) return { standing: "EXPIRED", expiresInDays };
  if (days(against, validTo) <= EXPIRY_WARNING_DAYS) return { standing: "EXPIRING", expiresInDays };
  return { standing: "DONE", expiresInDays };
}

/** What the row says about its own dates, in words a counsellor can repeat. */
export function standingText(s: Standing, courseStart: Date | string | null) {
  switch (s) {
    case "EXPIRED":
      return courseStart ? "Expires before the course starts" : "Out of date";
    case "EXPIRING":
      return courseStart ? "Runs out soon after the course starts" : "Runs out soon";
    case "SKIPPED":
      return "Not needed for this student";
    case "DONE":
      return "In hand";
    default:
      return "Outstanding";
  }
}

export type GateItem = ItemDates & {
  typeCode: string;
  label: string;
  required: boolean;
  /** Set on the requirement: this one is never let through, whoever is asking. */
  neverWaive?: boolean;
  owedBy: OwedBy;
};

export type Gate = {
  clear: boolean;
  /** Required items that are missing, rejected or out of date. */
  missing: { typeCode: string; label: string; owedBy: OwedBy; why: string; neverWaive: boolean }[];
  done: number;
  total: number;
  withStudent: number;
  withUs: number;
  expiring: { typeCode: string; label: string; expiresInDays: number | null }[];
  rejected: number;
};

/**
 * Whether a stage can be left. Only required items gate it; the rest are asked
 * for and chased, but nobody is held up by a nice-to-have.
 */
export function gate(items: GateItem[], courseStart: Date | string | null, today = new Date()): Gate {
  const missing: Gate["missing"] = [];
  const expiring: Gate["expiring"] = [];
  let done = 0;
  let total = 0;
  let withStudent = 0;
  let withUs = 0;
  let rejected = 0;
  for (const item of items) {
    const s = standing(item, courseStart, today);
    if (s.standing === "SKIPPED") continue;
    if (item.required) total += 1;
    if (s.standing === "EXPIRING") expiring.push({ typeCode: item.typeCode, label: item.label, expiresInDays: s.expiresInDays });
    if (item.state === "REJECTED") rejected += 1;
    if (s.standing === "DONE" || s.standing === "EXPIRING") {
      if (item.required) done += 1;
      continue;
    }
    if (item.owedBy === "STUDENT") withStudent += 1;
    else withUs += 1;
    if (!item.required) continue;
    const why =
      s.standing === "EXPIRED"
        ? standingText("EXPIRED", courseStart)
        : item.state === "REJECTED"
          ? "Sent back"
          : item.state === "UPLOADED" || item.state === "IN_REVIEW"
            ? "Waiting to be checked"
            : item.state === "ASKED"
              ? "Asked for, nothing back"
              : "Not asked for yet";
    missing.push({ typeCode: item.typeCode, label: item.label, owedBy: item.owedBy, why, neverWaive: item.neverWaive === true });
  }
  return { clear: missing.length === 0, missing, done, total, withStudent, withUs, expiring, rejected };
}

/**
 * The missing items nobody may let a student past.
 *
 * An override exists because a branch sometimes knows something the list does
 * not. It is not a way around a passport that is not on file, so these are
 * refused with the same words to everybody, admin or not, and no reason is
 * asked for: there is no reason that would change the answer.
 */
export const lockedMissing = (g: Gate) => g.missing.filter((m) => m.neverWaive);

/** Whether this gate can be let through at all, with a reason. */
export const canWaive = (g: Gate) => g.clear || lockedMissing(g).length === 0;

/** What to say when it cannot. */
export function waiveRefusal(g: Gate): string {
  const locked = lockedMissing(g);
  if (locked.length === 0) return "";
  const list = locked.map((m) => m.label).join(", ");
  return `${list} cannot be waived by anybody. ${locked.length === 1 ? "It has" : "They have"} been marked as a gate that is never let through, so this has to wait until ${locked.length === 1 ? "it is" : "they are"} in.`;
}

/** The states the team may move an item to by hand, and what each is called on a button. */
export const CLAIM_MINUTES = 20;
export const claimHeld = (claimedAt: Date | string | null, today = new Date()) => {
  const at = asDate(claimedAt);
  return at != null && today.getTime() - at.getTime() < CLAIM_MINUTES * 60_000;
};

/**
 * When a document stops being good for, worked out from the date printed on it
 * plus the validity the team recorded. Where either is missing the portal says
 * so rather than inventing a date.
 */
export function validUntil(issuedOn: Date | string | null, validityMonths: number | null): Date | null {
  const issued = asDate(issuedOn);
  if (!issued || validityMonths == null) return null;
  const d = new Date(issued.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + validityMonths);
  // A short month must not roll into the next one: 31 August plus six months is
  // the end of February, not the first of March.
  if (d.getDate() < day) d.setDate(0);
  return d;
}
