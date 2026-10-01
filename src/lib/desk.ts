/**
 * The hand-over between a branch and the Overseas desk.
 *
 * A counsellor builds the file and collects the paper. They do not choose which
 * road the application goes down: the desk does that once the documents are in,
 * lodges it in the vendor's own portal, and records what comes back by hand,
 * because none of those portals tell us anything by themselves.
 *
 * Everything here is pure, so the same rules hold on the application card, in
 * the desk's queue and in a test.
 */

import type { DeskStage, StatusGroup, VendorOutcome } from "@/db/schema";

export const DESK_STAGE_LABEL: Record<DeskStage, string> = {
  PREPARING: "With the branch",
  READY: "Waiting for the desk",
  CHOSEN: "Route chosen",
  SUBMITTED: "Lodged with the vendor",
  RETURNED: "Sent back to the branch",
};

/** One line each, so a counsellor reads the card without being taught it. */
export const DESK_STAGE_MEANS: Record<DeskStage, string> = {
  PREPARING: "The branch is still collecting documents. Nothing has been sent anywhere.",
  READY: "Handed to the Overseas desk. They choose the vendor and lodge it.",
  CHOSEN: "The desk has picked the road. Lodging it is the next step.",
  SUBMITTED: "In the vendor's own portal. Everything from here is what they tell us.",
  RETURNED: "The desk sent it back with a reason. Fix that and hand it over again.",
};

export const OUTCOME_LABEL: Record<VendorOutcome, string> = {
  ACKNOWLEDGED: "Acknowledged by the vendor",
  DOCUMENTS_ASKED: "More documents asked for",
  INTERVIEW_SET: "Interview set",
  OFFER_ISSUED: "Offer issued",
  CONDITIONS_MET: "Conditions accepted as met",
  REJECTED: "Rejected",
  DEFERRED: "Deferred to a later intake",
  WITHDRAWN: "Withdrawn",
  OTHER: "Something else",
};

/**
 * Where each outcome belongs in the status flow. A group rather than a status,
 * because every pathway keeps its own list and the team edits it: the desk picks
 * the status itself, and this only decides which ones to offer first.
 *
 * Null means the update is worth recording but moves nothing on its own.
 */
export const OUTCOME_GROUP: Record<VendorOutcome, StatusGroup | null> = {
  ACKNOWLEDGED: "IN_PROGRESS",
  DOCUMENTS_ASKED: "PENDING_PARTNER",
  INTERVIEW_SET: "IN_PROGRESS",
  OFFER_ISSUED: "OFFER",
  CONDITIONS_MET: "OFFER",
  REJECTED: "CLOSED",
  DEFERRED: "HOLD",
  WITHDRAWN: "CLOSED",
  OTHER: null,
};

/** Outcomes the branch should hear about the moment they are recorded. */
export const TELLS_THE_BRANCH: VendorOutcome[] = ["DOCUMENTS_ASKED", "INTERVIEW_SET", "OFFER_ISSUED", "REJECTED", "DEFERRED"];

/** Outcomes that end the waiting, so turnaround can be counted to them. */
export const SETTLES_IT: VendorOutcome[] = ["OFFER_ISSUED", "REJECTED", "WITHDRAWN"];

export type HandoverCheck = { ready: boolean; why: string | null };

/**
 * Whether a counsellor may hand this file over.
 *
 * The gate is the documents, not somebody's judgement: a file that goes to the
 * desk short of paper only comes back, which costs the student a week each time.
 */
export function canHandOver(args: { deskStage: DeskStage; gateClear: boolean; missing: string[]; closed: boolean }): HandoverCheck {
  if (args.closed) return { ready: false, why: "This application is closed." };
  if (args.deskStage === "READY") return { ready: false, why: "Already with the desk." };
  if (args.deskStage === "CHOSEN" || args.deskStage === "SUBMITTED") return { ready: false, why: "The desk has it in hand." };
  if (!args.gateClear) {
    return { ready: false, why: `Still needed before this can go: ${args.missing.join(", ")}.` };
  }
  return { ready: true, why: null };
}

/**
 * How long the vendor took, counted from the day it was lodged to the day they
 * acted, in their dates rather than ours. Null where either end is unknown,
 * because a turnaround figure built on a guess is worse than none.
 */
export function vendorTurnaround(submittedAt: Date | string | null, settledOn: Date | string | null): number | null {
  if (!submittedAt || !settledOn) return null;
  const from = submittedAt instanceof Date ? submittedAt : new Date(submittedAt);
  const to = settledOn instanceof Date ? settledOn : new Date(settledOn);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const days = Math.round((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000);
  return days < 0 ? null : days;
}

/** How the turnaround reads beside the promised one, where there is one. */
export function turnaroundText(actual: number | null, promised: number | null) {
  if (actual == null) return promised == null ? "Not recorded" : `Promised within ${promised} days`;
  const took = `Took ${actual} day${actual === 1 ? "" : "s"}`;
  if (promised == null) return took;
  if (actual <= promised) return `${took}, inside the ${promised} they quote`;
  return `${took}, ${actual - promised} past the ${promised} they quote`;
}

/**
 * Whether a vendor has gone quiet on something lodged with them. The desk
 * chases vendors the way the portal chases students, and a week is the point at
 * which somebody should pick up the phone.
 */
export const VENDOR_SILENCE_DAYS = 7;
export function vendorSilence(args: { submittedAt: Date | null; lastUpdateAt: Date | null; settled: boolean }, today = new Date()) {
  if (args.settled || !args.submittedAt) return { quiet: false, days: null as number | null };
  const since = args.lastUpdateAt && args.lastUpdateAt > args.submittedAt ? args.lastUpdateAt : args.submittedAt;
  const days = Math.floor((today.getTime() - since.getTime()) / 86_400_000);
  return { quiet: days >= VENDOR_SILENCE_DAYS, days };
}
