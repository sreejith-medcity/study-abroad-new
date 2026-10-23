import { groupInr } from "./format";

/**
 * When a course may go live, and the words for why it may not.
 *
 * Nobody can apply to a course with no intake, and a post-study work answer
 * (eligible or not eligible) is only worth showing with the evidence behind
 * it. Every path that can set a course live applies these two rules: the
 * course's edit screen, the per-row status control and the bulk buttons on
 * the Programs list, the draft review screens, the CSV import, the CRICOS
 * sync's publish option and restoring an old status from the history.
 *
 * This file is the rule for one row. The same rule as SQL, for updates that
 * touch thousands of rows at once, is in src/server/publish-rules.ts; keep the
 * two in step.
 */

export type PublishProblem = "intakes" | "evidence";

export type PublishFacts = { intakeMonths: readonly number[] | null | undefined; workRights: string; workRightsNote: string | null | undefined };

/** Why this course cannot go live yet, or an empty list when it can. */
export function publishProblems(row: PublishFacts): PublishProblem[] {
  const out: PublishProblem[] = [];
  if (!row.intakeMonths?.length) out.push("intakes");
  if (row.workRights !== "UNKNOWN" && !row.workRightsNote?.trim()) out.push("evidence");
  return out;
}

export const canGoLive = (row: PublishFacts) => publishProblems(row).length === 0;

/** Short labels for a chip next to a course. */
export const PROBLEM_LABEL: Record<PublishProblem, string> = {
  intakes: "No intakes",
  evidence: "Work rights with no evidence",
};

/** Courses held back from going live, and how many broke each rule. One course can break both. */
export type HeldBack = { left: number; noIntakes: number; noEvidence: number };

/** One reason, worded for how many it covers. */
function reasonText(problem: PublishProblem, n: number) {
  if (problem === "intakes") return `${groupInr(n)} ${n === 1 ? "has" : "have"} no intakes`;
  return `${groupInr(n)} ${n === 1 ? "has" : "have"} a post-study work answer with no evidence behind ${n === 1 ? "it" : "them"}`;
}

/**
 * The sentence that says how many courses were held back and why, after a
 * phrase saying what happened to them ("4 left as drafts", "1 imported as a
 * draft"). When one reason covers all of them it reads as a because;
 * otherwise each reason is listed with its own count.
 */
export function heldBackText(h: HeldBack, kept: string): string {
  const reasons = ([["intakes", h.noIntakes], ["evidence", h.noEvidence]] as const).filter(([, n]) => n > 0);
  if (reasons.length === 1 && reasons[0][1] === h.left) {
    const [problem] = reasons[0];
    const they = h.left === 1 ? "it has" : "they have";
    return problem === "intakes" ? `${kept} because ${they} no intakes.` : `${kept} because ${they} a post-study work answer with no evidence behind ${h.left === 1 ? "it" : "them"}.`;
  }
  return `${kept}: ${reasons.map(([p, n]) => reasonText(p, n)).join(", ")}.`;
}

export const count = (n: number, one: string, many: string) => `${groupInr(n)} ${n === 1 ? one : many}`;

/**
 * Why one course was not set live, for the line beside its row on the
 * Programs list. The row follows it with a link to the course, where the
 * missing intake or evidence is added.
 */
export function refusalText(problems: readonly PublishProblem[]): string {
  const intakes = problems.includes("intakes");
  const evidence = problems.includes("evidence");
  if (intakes && evidence) return "Not set live: it has no intakes, and its post-study work answer has no evidence behind it.";
  if (intakes) return "Not set live: it has no intakes.";
  if (evidence) return "Not set live: its post-study work answer has no evidence behind it.";
  return "";
}

/** What one press of the bulk status buttons did, counted by the database. */
export type BulkOutcome = {
  to: "LIVE" | "DRAFT" | "ARCHIVED";
  /** Courses whose status changed. */
  done: number;
  /** Matching drafts still drafts because they broke a rule (publishing only). */
  leftDrafts: number;
  /** Matching archived courses still archived because they broke a rule (publishing only). */
  leftArchived: number;
  noIntakes: number;
  noEvidence: number;
  /** Courses the press would have changed but did not reach before its time ran out. */
  unreached: number;
};

/**
 * The answer after a bulk status press on the Programs list: what changed,
 * what was held back and why, and whether pressing again would do more.
 */
export function bulkOutcomeText(o: BulkOutcome): string {
  const parts: string[] = [];
  if (o.to === "LIVE") {
    parts.push(o.done ? `Published ${groupInr(o.done)}.` : "Nothing published.");
    const left = o.leftDrafts + o.leftArchived;
    if (left) {
      const drafts = count(o.leftDrafts, "left as a draft", "left as drafts");
      const archived = `${groupInr(o.leftArchived)} left archived`;
      const kept = o.leftDrafts && o.leftArchived ? `${drafts} and ${archived}` : o.leftDrafts ? drafts : archived;
      parts.push(heldBackText({ left, noIntakes: o.noIntakes, noEvidence: o.noEvidence }, kept));
      parts.push(left === 1 ? "Open it to add what is missing." : "Open each one to add what is missing.");
    }
  } else if (o.to === "DRAFT") {
    parts.push(o.done ? `Moved ${groupInr(o.done)} back to draft.` : "Nothing moved: every match was already a draft.");
  } else {
    parts.push(o.done ? `Archived ${groupInr(o.done)}.` : "Nothing archived: every match was already archived.");
  }
  if (o.unreached) {
    parts.push(`${groupInr(o.unreached)} more ${o.unreached === 1 ? "was" : "were"} not reached before the time limit. Press the button again to carry on.`);
  }
  return parts.join(" ");
}
