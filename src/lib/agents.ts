/**
 * Sub-agents: what a referral earns, and whether money may leave.
 *
 * All pure. The same rules answer the sub-agent asking "why can I not withdraw"
 * and the desk asking "why has this not been paid", so the two screens cannot
 * drift into different stories about the same balance.
 */

import type { AgentApplicationStatus, AgentFeeKind, ReferralEarningState } from "@/db/schema";

/**
 * What somebody agrees to when they send the application form. Kept here rather
 * than beside the action, because a "use server" module may export only async
 * functions, and because the words are also printed on the form itself.
 */
export const AGENT_CONSENT =
  "I confirm the details above are mine, and I agree to Medcity Overseas holding them to consider my application to work as a sub-agent and to contact me about it.";

export const APPLICATION_STATUS_LABEL: Record<AgentApplicationStatus, string> = {
  NEW: "New",
  REVIEWING: "Being looked at",
  APPROVED: "Approved",
  REJECTED: "Turned down",
};

export const FEE_KIND_LABEL: Record<AgentFeeKind, string> = {
  SHARE_OF_COMMISSION: "A share of what Medcity earns",
  FLAT_PER_ENROLMENT: "A fixed amount per enrolment",
};

export const EARNING_STATE_LABEL: Record<ReferralEarningState, string> = {
  PENDING: "Not yet earned",
  PAYABLE: "Ready to withdraw",
  PAID: "Paid out",
  CANCELLED: "Cancelled",
};

/** What each state means, said once on the screen so nobody has to guess. */
export const EARNING_STATE_MEANS: Record<ReferralEarningState, string> = {
  PENDING: "The student is on their way. Nothing is owed until Medcity has been paid for them.",
  PAYABLE: "Medcity has been paid, so this is in your balance and can be withdrawn.",
  PAID: "Withdrawn, or part of a withdrawal that has been sent.",
  CANCELLED: "The student did not go, or the referral was not Medcity's to pay. The reason is on the row.",
};

// ---------- Rates ----------

export type AgentRate = {
  id: string;
  orgId: string | null;
  kind: AgentFeeKind;
  percent: number | null;
  flatAmountInr: number | null;
  activeFrom: string | Date;
};

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The rate that applies to one sub-agent on one day.
 *
 * A rate of their own beats the platform default, however old it is: a figure
 * agreed with one partner is not overruled by a later platform change. Within
 * one scope the newest rate that has already started wins, so a rate dated next
 * month sits there until the month turns.
 */
export function rateFor(rates: AgentRate[], orgId: string, on: Date | string = new Date()): AgentRate | null {
  const day = asDate(on) ?? new Date();
  const started = rates.filter((r) => {
    const from = asDate(r.activeFrom);
    return from != null && from.getTime() <= day.getTime();
  });
  const pick = (rows: AgentRate[]) =>
    rows.sort((a, b) => (asDate(b.activeFrom)?.getTime() ?? 0) - (asDate(a.activeFrom)?.getTime() ?? 0))[0] ?? null;
  return pick(started.filter((r) => r.orgId === orgId)) ?? pick(started.filter((r) => r.orgId == null));
}

/**
 * What a referral is worth under a rate.
 *
 * Null where the rate cannot answer: no rate at all, a share with no percentage
 * on it, a flat fee with no amount, or a share of a commission nobody has worked
 * out yet. Null is shown as "Not recorded", never as nought, because a figure of
 * nought reads as "earned nothing" when the truth is "nobody has said".
 */
export function earningFrom(rate: AgentRate | null, commissionInr: number | null): number | null {
  if (!rate) return null;
  if (rate.kind === "FLAT_PER_ENROLMENT") return rate.flatAmountInr ?? null;
  if (rate.percent == null || commissionInr == null) return null;
  return Math.round((commissionInr * rate.percent) / 100);
}

/** How a rate reads on a screen, including when it has not been filled in. */
export function rateText(rate: AgentRate | null): string {
  if (!rate) return "Not recorded";
  if (rate.kind === "FLAT_PER_ENROLMENT") return rate.flatAmountInr == null ? "A fixed amount, not recorded" : `₹${rate.flatAmountInr.toLocaleString("en-IN")} per enrolment`;
  return rate.percent == null ? "A share, not recorded" : `${rate.percent}% of what Medcity earns`;
}

// ---------- Withdrawal ----------

/** One thing that has to be true before money may be asked for. */
export type Condition = {
  key: "MOU" | "BANK" | "MINIMUM" | "RECEIVED" | "NOTHING_PENDING";
  met: boolean;
  /** What the condition is, in the partner's own terms. */
  what: string;
  /** What to do about it when it is not met. Empty when it is. */
  fix: string;
};

export type WithdrawalFacts = {
  /** The wallet balance, which only ever holds money Medcity has been paid. */
  balanceInr: number;
  /** The floor on one request. Null means there is none. */
  minimumInr: number | null;
  /** Whether the organisation has accepted the MOU version being asked for. */
  mouAccepted: boolean;
  /** Whether there is an MOU to accept at all. */
  mouPublished: boolean;
  /** A billing company with an account number, IFSC and PAN on it. */
  hasBankDetails: boolean;
  /** A request already with the desk, which must be settled before another. */
  pendingRequestInr: number | null;
};

const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * The four conditions, each with its own answer.
 *
 * They are returned whether met or not, because a partner who cannot withdraw
 * deserves to see the whole list and which line is stopping them, not one error
 * at a time as they work through it.
 */
export function withdrawalConditions(f: WithdrawalFacts): Condition[] {
  const out: Condition[] = [];

  out.push({
    key: "MOU",
    // Nothing published means nothing to sign, so the condition cannot be the
    // thing holding a partner up. The desk is told its MOU is missing instead.
    met: !f.mouPublished || f.mouAccepted,
    what: "The current agreement is accepted",
    fix: f.mouPublished && !f.mouAccepted ? "Read the agreement and accept it." : "",
  });

  out.push({
    key: "BANK",
    met: f.hasBankDetails,
    what: "Bank details and PAN are on file",
    fix: f.hasBankDetails ? "" : "Add a company with its account number, IFSC and PAN in Settings.",
  });

  const minimum = f.minimumInr;
  out.push({
    key: "MINIMUM",
    met: minimum == null || f.balanceInr >= minimum,
    what: minimum == null ? "No minimum is set" : `At least ${rupees(minimum)} in the balance`,
    fix: minimum != null && f.balanceInr < minimum ? `Your balance is ${rupees(f.balanceInr)}. ${rupees(minimum - f.balanceInr)} to go.` : "",
  });

  out.push({
    key: "RECEIVED",
    // The wallet is only ever credited once the money is in, so a balance above
    // nought is itself the proof. The row is here to say so rather than to test
    // something the ledger could contradict.
    met: f.balanceInr > 0,
    what: "Medcity has been paid for the students behind it",
    fix: f.balanceInr > 0 ? "" : "Nothing is in your balance yet. A referral is only credited once Medcity has been paid for that student.",
  });

  out.push({
    key: "NOTHING_PENDING",
    met: f.pendingRequestInr == null,
    what: "No request is already with the desk",
    fix: f.pendingRequestInr != null ? `${rupees(f.pendingRequestInr)} is already waiting to be decided.` : "",
  });

  return out;
}

/**
 * Which of the conditions an organisation is actually held to.
 *
 * A sub-agent is held to all of them, which is what they were introduced for. A
 * branch is held only to the one that was always there: nothing may be asked for
 * while a request is already waiting. A branch has no agreement to accept and no
 * minimum was ever set for one, and quietly applying either to a branch mid-season
 * would stop a payout somebody is expecting this week.
 */
export const HELD_TO_EVERY_CONDITION = ["SUB_AGENT"] as const;

export const heldToEveryCondition = (orgType: string) => (HELD_TO_EVERY_CONDITION as readonly string[]).includes(orgType);

export function conditionsFor(f: WithdrawalFacts, orgType: string): Condition[] {
  const all = withdrawalConditions(f);
  return heldToEveryCondition(orgType) ? all : all.filter((c) => c.key === "NOTHING_PENDING");
}

export const canWithdraw = (f: WithdrawalFacts) => withdrawalConditions(f).every((c) => c.met);

/** The most a partner may ask for in one request, given the floor and the balance. */
export function withdrawableNow(f: WithdrawalFacts): number {
  if (!canWithdraw(f)) return 0;
  return Math.max(0, f.balanceInr);
}

/** The one line a partner reads first: either go ahead, or the reason not to. */
export function withdrawalSummary(f: WithdrawalFacts, orgType = "SUB_AGENT"): string {
  const blocking = conditionsFor(f, orgType).filter((c) => !c.met);
  if (blocking.length === 0) return `${rupees(f.balanceInr)} is ready to withdraw.`;
  if (blocking.length === 1) return blocking[0].fix || blocking[0].what;
  return `${blocking.length} things to sort out before you can withdraw.`;
}

// ---------- Referrals a sub-agent can see ----------

/**
 * What a sub-agent is told about a lead they sent, which is less than the file
 * says. They see the stage and who holds it, never the student's documents,
 * notes or money.
 */
export const REFERRAL_STAGE_LABEL: Record<string, string> = {
  NEW: "With Medcity, not looked at yet",
  CONTACTED: "Medcity has spoken to them",
  QUALIFIED: "Taken on",
  COUNSELLING: "Choosing a course",
  CONVERTED: "Registered as a student",
  LOST: "Did not go ahead",
};

/** Whether a referral is still live, for the counts above the list. */
export const stillLive = (stage: string) => stage !== "LOST";

/* ---------------- Who they are, on paper ---------------- */

export const OWNER_ID_LABEL: Record<string, string> = {
  PAN: "PAN card",
  PASSPORT: "Passport",
  DRIVING_LICENCE: "Driving licence",
  VOTER_ID: "Voter ID",
  AADHAAR: "Aadhaar",
};

export const OWNER_ID_KINDS = ["PAN", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "AADHAAR"] as const;
export type OwnerIdKind = (typeof OWNER_ID_KINDS)[number];

/**
 * The shape each kind of number comes in.
 *
 * Shape only. None of this proves the number belongs to the person, and the
 * portal never says it does: it catches a typed digit and a pasted placeholder,
 * which is what a form can honestly do.
 */
const ID_SHAPE: Record<OwnerIdKind, { re: RegExp; says: string }> = {
  PAN: { re: /^[A-Z]{5}\d{4}[A-Z]$/, says: "Ten characters, like ABCDE1234F" },
  PASSPORT: { re: /^[A-Z][0-9]{7}$/, says: "One letter and seven digits, like K1234567" },
  DRIVING_LICENCE: { re: /^[A-Z]{2}[0-9]{2}\s?[0-9]{4}[0-9]{7}$/, says: "Like KL07 20110012345" },
  VOTER_ID: { re: /^[A-Z]{3}[0-9]{7}$/, says: "Three letters and seven digits, like ABC1234567" },
  AADHAAR: { re: /^[2-9][0-9]{11}$/, says: "Twelve digits, not starting with 0 or 1" },
};

export const tidyId = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();

/** Whether a number could be the kind of number it is offered as. */
export function checkOwnerId(kind: string, raw: string): { ok: true; value: string } | { ok: false; says: string } {
  const shape = ID_SHAPE[kind as OwnerIdKind];
  if (!shape) return { ok: false, says: "Choose what the number is from" };
  const value = tidyId(raw);
  return shape.re.test(value) ? { ok: true, value } : { ok: false, says: shape.says };
}

/**
 * The last few characters, for everybody who has no business reading the whole
 * number. The same rule the portal already uses for a student's passport.
 */
export function maskOwnerId(value: string | null | undefined) {
  if (!value) return "Not recorded";
  if (value.length <= 3) return "•••";
  // The same shape as a student's passport on screen, so one habit covers both.
  return value[0] + "•".repeat(Math.max(3, value.length - 3)) + value.slice(-2);
}
