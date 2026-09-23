/**
 * Ranking the finder's matches.
 *
 * Search answers "which programs pass these filters". The finder answers
 * "which of them suits this student best", which needs an order and, more
 * importantly, a reason for it. Every point below comes from something the
 * catalogue records or the student's own file; nothing is estimated, and a
 * figure that is not recorded scores nothing rather than being guessed at.
 * The reasons are what the counsellor reads out to the family, so they are
 * written as sentences, not as scores.
 */

import type { Eligibility } from "./eligibility";
import { dayText, daysUntil, tuitionText } from "./catalogue";
import { MONTHS } from "./format";
import { PROGRAM_TAGS } from "./program-tags";
import { parseRank } from "./rankings";

export type ScoreProgram = {
  level: string;
  studyArea: string | null;
  tuitionPerYear: number | null;
  tuitionTotal: number | null;
  durationMonths: number | null;
  currency: string;
  intakeMonths: number[];
  tags: string[];
  workRights: string;
  feeWaiver: string | null;
  applicationFee: number | null;
  initialDeposit: number | null;
  moiAccepted: boolean;
  typicalScholarship: string | null;
  /** Days this institution has been taking to answer, as the team records it. */
  offerTatDays: number | null;
  qsRank: string | null;
  theRank: string | null;
};

export type Wants = {
  /** Intake months asked for, from the seasons or a single month. */
  months: number[];
  field: string | null;
  /** Yearly tuition budget in rupees, or null when none was given. */
  budgetInr: number | null;
  /** Quick-filter keys the counsellor said mattered. */
  prefs: string[];
};

export type Match = {
  score: number;
  band: "strong" | "possible" | "stretch";
  reasons: string[];
  cautions: string[];
};

export const BAND_LABEL = {
  strong: "Strong match",
  possible: "Worth a look",
  stretch: "A stretch",
} as const;

export const BAND_NOTE = {
  strong: "Meets what is recorded and fits the plan.",
  possible: "Fits most of the plan; read the notes on each one.",
  stretch: "Something recorded does not line up. Keep these for later.",
} as const;

/** The rupee value of a fee, or null when the currency has no rate set. */
export function yearlyInr(p: Pick<ScoreProgram, "tuitionPerYear" | "tuitionTotal" | "durationMonths" | "currency">, rates: Record<string, number>) {
  const rate = p.currency === "INR" ? 1 : rates[p.currency];
  if (!rate || rate <= 0) return null;
  if (p.tuitionPerYear != null) return { inr: p.tuitionPerYear * rate, perYear: true };
  // A whole-course fee is never presented as a yearly figure. Its average year
  // is used only to compare against a budget, and is marked as an average.
  if (p.tuitionTotal != null && p.durationMonths && p.durationMonths > 0) return { inr: (p.tuitionTotal * rate * 12) / p.durationMonths, perYear: false };
  return null;
}

export function scoreMatch(
  p: ScoreProgram,
  opts: {
    fit: Eligibility | null;
    wants: Wants;
    rates: Record<string, number>;
    /** The next recorded deadline for this program, if any. */
    deadline: { deadline: string; intakeMonth: number; intakeYear: number } | null;
    hasScholarship?: boolean;
    today?: Date;
  },
): Match {
  const reasons: string[] = [];
  const cautions: string[] = [];
  let score = 0;
  let blocked = false;

  const fit = opts.fit;
  if (fit) {
    if (fit.verdict === "eligible") {
      score += 40;
      reasons.push(`Meets every requirement on record${fit.met.length ? `: ${fit.met.join(", ")}` : ""}`);
    } else if (fit.verdict === "on-track") {
      score += 26;
      reasons.push(`On track: ${fit.onTrack.join("; ")}`);
      if (fit.met.length) reasons.push(`Already meets ${fit.met.join(", ")}`);
    } else if (fit.verdict === "blocked") {
      blocked = true;
      cautions.push(...fit.missing);
    } else {
      score += 12;
      cautions.push("Entry requirements are not recorded for this program");
    }
  } else {
    score += 12;
  }

  const money = yearlyInr(p, opts.rates);
  if (opts.wants.budgetInr) {
    if (!money) {
      score += 4;
      cautions.push(p.tuitionPerYear == null && p.tuitionTotal == null ? "Tuition is not recorded, so the budget could not be checked" : "No rate is set for this currency, so the budget could not be checked");
    } else if (money.inr <= opts.wants.budgetInr) {
      score += 20;
      reasons.push(`Tuition ${tuitionText(p.tuitionPerYear, p.tuitionTotal, p.currency)}, inside the budget`);
    } else {
      cautions.push(`Tuition ${tuitionText(p.tuitionPerYear, p.tuitionTotal, p.currency)}, over the budget`);
    }
  } else if (money && p.tuitionPerYear != null) {
    // Without a budget, a cheaper program still deserves a nudge upwards.
    score += 6;
  }

  if (opts.wants.months.length) {
    const hit = p.intakeMonths.filter((m) => opts.wants.months.includes(m));
    if (hit.length) {
      score += 15;
      reasons.push(`${hit.map((m) => MONTHS[m - 1]).join(", ")} intake`);
    } else if (p.intakeMonths.length) {
      cautions.push(`Intakes on record are ${p.intakeMonths.map((m) => MONTHS[m - 1]).join(", ")}`);
    } else {
      cautions.push("Intakes are not recorded");
    }
  }

  if (opts.deadline) {
    const left = daysUntil(opts.deadline.deadline, opts.today ?? new Date());
    if (left >= 0) {
      score += 8;
      reasons.push(`${MONTHS[opts.deadline.intakeMonth - 1]} ${opts.deadline.intakeYear}: apply by ${dayText(opts.deadline.deadline)}${left <= 21 ? `, ${left === 0 ? "today" : `${left} days left`}` : ""}`);
    } else {
      cautions.push(`The recorded deadline for ${MONTHS[opts.deadline.intakeMonth - 1]} ${opts.deadline.intakeYear} has passed`);
    }
  }

  if (opts.wants.field && p.studyArea && p.studyArea.toLowerCase() === opts.wants.field.toLowerCase()) {
    score += 8;
    reasons.push(p.studyArea);
  }

  for (const pref of opts.wants.prefs) {
    const hit = PREF_REASON[pref]?.(p, opts.hasScholarship ?? false);
    if (hit) {
      score += 4;
      reasons.push(hit);
    }
  }

  // A fast answer matters to a family deciding between offers, and it only
  // counts where the team has recorded one.
  if (p.offerTatDays != null && p.offerTatDays <= 7) {
    score += 4;
    reasons.push(`Offer usually in ${p.offerTatDays === 1 ? "1 day" : `${p.offerTatDays} days`}`);
  }

  // A published rank as it was published, never tidied into a number for show.
  const ranked = [
    { label: "QS", raw: p.qsRank, sort: parseRank(p.qsRank)?.sort },
    { label: "THE", raw: p.theRank, sort: parseRank(p.theRank)?.sort },
  ]
    .filter((r): r is { label: string; raw: string; sort: number } => !!r.raw && r.sort != null)
    .sort((a, b) => a.sort - b.sort)[0];
  if (ranked && ranked.sort <= 500) {
    score += 5;
    const text = parseRank(ranked.raw)!.text;
    reasons.push(`${ranked.label} ${/^\d+$/.test(text) ? `#${text}` : text}`);
  }

  const band: Match["band"] = blocked ? "stretch" : score >= 70 ? "strong" : score >= 45 ? "possible" : "stretch";
  return { score, band, reasons, cautions };
}

/** What each preference is worth saying out loud when the program has it. */
const PREF_REASON: Record<string, (p: ScoreProgram, hasScholarship: boolean) => string | null> = {
  workRights: (p) => (p.workRights === "ELIGIBLE" ? "Post-study work, as the institution states" : null),
  scholarship: (p, has) => (has ? "A scholarship is open" : p.typicalScholarship ? `Typical scholarship: ${p.typicalScholarship}` : null),
  noAppFee: (p) => (p.applicationFee === 0 ? "No application fee" : null),
  waiver: (p) => (p.feeWaiver ? `Fee waiver: ${p.feeWaiver}` : null),
  moi: (p) => (p.moiAccepted ? "Takes a Medium of Instruction letter" : null),
  lowDeposit: (p) => (p.initialDeposit != null && p.initialDeposit <= 1500 ? "Small initial deposit" : null),
  noEnglish: () => null,
  noGre: () => null,
  noGmat: () => null,
  ausbildung: () => null,
  nursing: () => null,
  closing: () => null,
  commission: () => null,
};

/** Labels the team put on a program, as the finder shows them. */
export const tagLabels = (tags: string[]) => tags.filter((t) => t in PROGRAM_TAGS).map((t) => PROGRAM_TAGS[t as keyof typeof PROGRAM_TAGS]);
