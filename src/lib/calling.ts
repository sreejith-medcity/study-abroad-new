/**
 * Calling mode: the rules that decide who is called next and what a call's
 * outcome does to the record.
 *
 * Pure, so the queue the page shows, the action that logs a call and the
 * tests all read the same rules. Days are India days as YYYY-MM-DD text.
 */

import type { ContactOutcome, EnquiryStage } from "@/db/schema";

/** Why a record is in somebody's queue. */
export type CallReason = "NEVER_CONTACTED" | "OVERDUE" | "DUE_TODAY";

export const REASON_LABEL: Record<CallReason, string> = {
  NEVER_CONTACTED: "Not contacted yet",
  OVERDUE: "Follow-up overdue",
  DUE_TODAY: "Follow-up due today",
};

/** First the people nobody has spoken to, then the ones we are late for, then today's. */
export const REASON_RANK: Record<CallReason, number> = { NEVER_CONTACTED: 0, OVERDUE: 1, DUE_TODAY: 2 };

export type CallKind = "ENQUIRY" | "STUDENT";

/**
 * Whether a record needs a call today, and why.
 *
 * Never contacted wins over a date: a lead nobody has spoken to is the most
 * urgent call whatever date was typed against it. A follow-up date in the
 * future, or none, with some contact already made, means no call today.
 */
export function callReason(r: { contacted: boolean; dueOn: string | null }, today: string): CallReason | null {
  if (!r.contacted) return "NEVER_CONTACTED";
  if (!r.dueOn) return null;
  if (r.dueOn < today) return "OVERDUE";
  if (r.dueOn === today) return "DUE_TODAY";
  return null;
}

export type QueueEntry = {
  key: string;
  kind: CallKind;
  reason: CallReason;
  dueOn: string | null;
  createdAt: Date | string;
};

/**
 * The order the queue is worked in: by reason, then the follow-up that has
 * waited longest, then enquiries ahead of students (an enquiry has not yet
 * chosen us), then the newest record, because a lead goes cold by the hour.
 * The key settles anything left, so two loads of the page agree.
 */
export function compareQueue(a: QueueEntry, b: QueueEntry): number {
  const r = REASON_RANK[a.reason] - REASON_RANK[b.reason];
  if (r) return r;
  if (a.dueOn !== b.dueOn) {
    if (a.dueOn === null) return -1;
    if (b.dueOn === null) return 1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  if (a.kind !== b.kind) return a.kind === "ENQUIRY" ? -1 : 1;
  const t = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (t) return t;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export const orderQueue = <T extends QueueEntry>(items: T[]): T[] => [...items].sort(compareQueue);

/** The seven things that can come of a call in calling mode. */
export const CALL_OUTCOMES = [
  "INTERESTED",
  "NOT_INTERESTED",
  "CALL_BACK",
  "NOT_REACHABLE",
  "SWITCHED_OFF",
  "WRONG_NUMBER",
  "ENROLLED_ELSEWHERE",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  INTERESTED: "Connected, interested",
  NOT_INTERESTED: "Connected, not interested",
  CALL_BACK: "Call back later",
  NOT_REACHABLE: "Not reachable",
  SWITCHED_OFF: "Switched off",
  WRONG_NUMBER: "Wrong number",
  ENROLLED_ELSEWHERE: "Already enrolled elsewhere",
};

/** How each is written to the contact history, which every report reads. */
export const CALL_OUTCOME_CONTACT: Record<CallOutcome, ContactOutcome> = {
  INTERESTED: "REACHED",
  NOT_INTERESTED: "NOT_INTERESTED",
  CALL_BACK: "WANTS_TIME",
  NOT_REACHABLE: "NO_ANSWER",
  SWITCHED_OFF: "SWITCHED_OFF",
  WRONG_NUMBER: "WRONG_NUMBER",
  ENROLLED_ELSEWHERE: "ENROLLED_ELSEWHERE",
};

export const isCallOutcome = (v: string): v is CallOutcome => (CALL_OUTCOMES as readonly string[]).includes(v);

/** The day `days` after `day`. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const OPEN: EnquiryStage[] = ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"];

export type CallPlan = {
  /** What goes on the contact history. */
  contact: ContactOutcome;
  /** The next follow-up day, or null for none. */
  nextOn: string | null;
  /** For an enquiry: the stage after the call, where it moves. */
  stage: EnquiryStage | null;
  /** For an enquiry closed by the call: why. */
  lostReason: string | null;
  /** What the person is told, and what the follow-up task says. */
  next: string | null;
};

/**
 * What one outcome does.
 *
 * Interested: qualified, and called again in two days while it is warm.
 * Not interested, or already enrolled elsewhere: an enquiry is closed as lost
 * with that reason; a student is not, since a registered file is closed on
 * purpose rather than by one call, so a student told us "not interested" is
 * looked at again in a month and one enrolled elsewhere is not chased.
 * Call back later: the day they asked for, or tomorrow when none was given;
 * never a day already gone.
 * Not reachable or switched off: tomorrow, and nobody was reached, so the
 * stage stays where it was.
 * Wrong number: no date, because calling the same wrong number tomorrow helps
 * nobody; the number has to be corrected first.
 */
export function planCall(
  outcome: CallOutcome,
  r: { kind: CallKind; stage?: EnquiryStage | null; today: string; callbackOn?: string | null },
): CallPlan {
  const contact = CALL_OUTCOME_CONTACT[outcome];
  const enquiry = r.kind === "ENQUIRY";
  const stage = r.stage ?? null;
  const open = !!stage && OPEN.includes(stage);
  const touched = (to: EnquiryStage | null): EnquiryStage | null => (enquiry && open ? to : null);
  const firstContact = enquiry && stage === "NEW" ? "CONTACTED" : null;
  switch (outcome) {
    case "INTERESTED":
      return {
        contact,
        nextOn: addDays(r.today, 2),
        stage: touched(stage === "NEW" || stage === "CONTACTED" ? "QUALIFIED" : null),
        lostReason: null,
        next: "Send the details and book a counselling session",
      };
    case "NOT_INTERESTED":
      return enquiry
        ? { contact, nextOn: null, stage: touched("LOST"), lostReason: "Not interested, said on a call", next: null }
        : { contact, nextOn: addDays(r.today, 30), stage: null, lostReason: null, next: "Check whether they are still not interested" };
    case "ENROLLED_ELSEWHERE":
      return enquiry
        ? { contact, nextOn: null, stage: touched("LOST"), lostReason: "Already enrolled elsewhere", next: null }
        : { contact, nextOn: null, stage: null, lostReason: null, next: null };
    case "CALL_BACK": {
      const asked = r.callbackOn && /^\d{4}-\d{2}-\d{2}$/.test(r.callbackOn) && r.callbackOn >= r.today ? r.callbackOn : addDays(r.today, 1);
      return { contact, nextOn: asked, stage: touched(firstContact), lostReason: null, next: "Call back as agreed" };
    }
    case "NOT_REACHABLE":
    case "SWITCHED_OFF":
      return { contact, nextOn: addDays(r.today, 1), stage: null, lostReason: null, next: "Try the call again" };
    case "WRONG_NUMBER":
      return { contact, nextOn: null, stage: null, lostReason: null, next: null };
  }
}

/**
 * Whether logging this outcome needs a lost reason picked from the list: it
 * does exactly when the call closes an open enquiry as lost. A student is
 * never closed by a call, and the other outcomes keep the enquiry open.
 */
export const needsLostReason = (outcome: CallOutcome, r: { kind: CallKind; stage?: EnquiryStage | null }) =>
  planCall(outcome, { ...r, today: "2000-01-01" }).stage === "LOST";

/** Digits only, for a tel: link and wa.me. A number without a country code is taken as Indian. */
export function dialDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d;
}

export const telHref = (phone: string) => `tel:+${dialDigits(phone)}`;
export const whatsappHref = (phone: string) => `https://wa.me/${dialDigits(phone)}`;

/** The key a record is carried under in the address, so the queue can skip and open it. */
export const queueKey = (kind: CallKind, id: string) => `${kind === "ENQUIRY" ? "e" : "s"}:${id}`;
export function parseQueueKey(key: string): { kind: CallKind; id: string } | null {
  const m = /^([es]):([A-Za-z0-9_-]{1,64})$/.exec(key);
  if (!m) return null;
  return { kind: m[1] === "e" ? "ENQUIRY" : "STUDENT", id: m[2] };
}

/** The roles that work a calling queue: the branch's counsellors and its head. */
export const CALLING_ROLES = ["PARTNER", "COUNSELLOR", "SENIOR_COUNSELLOR", "TRAINEE_COUNSELLOR", "SUB_AGENT_COUNSELLOR"] as const;
export const callsFromQueue = (role: string) => (CALLING_ROLES as readonly string[]).includes(role);
/** Who reads the team queue: the branch head. */
export const readsTeamQueue = (role: string) => role === "PARTNER";
