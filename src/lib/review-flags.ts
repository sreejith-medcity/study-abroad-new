import { nameKey } from "./mioc";
import { durationText, LEVEL_LABEL } from "./catalogue";

/**
 * "Worth a look" flags on draft courses.
 *
 * The MIOC app's 104,000 drafts are mostly sound, and the desk should publish
 * those quickly. A few hundred are odd: a fee ten times its neighbours', a
 * three-month bachelor's, an IELTS of 65, the same course twice under two
 * durations. These flags point at the odd ones so the desk looks hard at them
 * and nowhere else. They are advice: a flag never changes a course, never
 * stops a publish on its own, and an unknown figure stays "Not recorded". The
 * desk decides.
 *
 * This file holds the rules for one row and the words for the chips. The same
 * rules as SQL, over a whole university at once, are in
 * src/server/draft-review.ts; they read their thresholds from the constants
 * here so the two cannot drift apart in number.
 */

export type ReviewFlag = "DUPLICATE" | "FEE_OUTLIER" | "FEE_IN_WORDS" | "NO_INTAKES" | "ODD_DURATION" | "SCORE_ODD";

/** In the order the chips are shown: the most expensive mistake first. */
export const REVIEW_FLAGS: readonly ReviewFlag[] = ["DUPLICATE", "FEE_OUTLIER", "FEE_IN_WORDS", "NO_INTAKES", "ODD_DURATION", "SCORE_ODD"];

/** Short words for a chip. The duplicate's chip names the other course, see duplicateText. */
export const FLAG_LABEL: Record<ReviewFlag, string> = {
  DUPLICATE: "Duplicate",
  FEE_OUTLIER: "Fee far from others",
  FEE_IN_WORDS: "Fee kept in words",
  NO_INTAKES: "No intakes",
  ODD_DURATION: "Course length odd",
  SCORE_ODD: "Score odd",
};

/** The import's own lines in the entry notes, written when a figure could not be taken as one. */
export const FEE_IN_WORDS_NOTE = "Tuition in the MIOC app:";
export const DURATION_NOTE = "Duration in the MIOC app:";

/**
 * A yearly fee far from the median of its level in its country. Below a
 * quarter or above four times is far: fees a third of the median turn up
 * honestly (a public university beside private ones), fees a tenth of it do
 * not. The median must stand on enough courses to mean anything.
 */
export const FEE_OUTLIER_LOW = 0.25;
export const FEE_OUTLIER_HIGH = 4;
export const FEE_MEDIAN_MIN_COURSES = 20;

/** No course on the catalogue runs longer than six years; a master's longer than three is odd. */
export const MAX_DURATION_MONTHS = 72;
export const MAX_PG_MONTHS = 36;
/** A bachelor's shorter than two years is odd, except in a country whose degrees run short. */
export const MIN_UG_MONTHS = 24;
/**
 * Countries where a bachelor's under two years is normal. None so far: the
 * three-year degrees of Britain and Australia are well above the line, so a
 * short bachelor's is odd everywhere. Kept as one list so a country can be
 * added in one place when one turns up.
 */
export const SHORT_UG_COUNTRIES: readonly string[] = [];

/** Scores outside what the tests can give. IELTS runs 0 to 9, PTE 10 to 90, TOEFL 0 to 120. */
export const MIN_IELTS = 4;
export const MAX_IELTS = 8;
export const MIN_PTE = 30;
export const MIN_TOEFL = 40;

export type DurationFacts = { level: string; durationMonths: number | null | undefined; entryRequirements: string | null | undefined; countryCode: string };

/** A course length that cannot be right, or one the import could not read and kept in words. */
export function oddDuration(f: DurationFacts): boolean {
  const months = f.durationMonths;
  if (months == null) return !!f.entryRequirements?.includes(DURATION_NOTE);
  if (months > MAX_DURATION_MONTHS) return true;
  if (f.level === "PG" && months > MAX_PG_MONTHS) return true;
  if (f.level === "UG" && months < MIN_UG_MONTHS && !SHORT_UG_COUNTRIES.includes(f.countryCode)) return true;
  return false;
}

export type ScoreFacts = { minIelts: number | null | undefined; minPte: number | null | undefined; minToefl: number | null | undefined };

/** An English score no test gives, or none a university would ask for. */
export function oddScore(f: ScoreFacts): boolean {
  if (f.minIelts != null && (f.minIelts < MIN_IELTS || f.minIelts > MAX_IELTS)) return true;
  if (f.minPte != null && f.minPte < MIN_PTE) return true;
  if (f.minToefl != null && f.minToefl < MIN_TOEFL) return true;
  return false;
}

/** No yearly fee, but the import left the app's fee in words in the notes. */
export function feeInWords(f: { tuitionPerYear: number | null | undefined; entryRequirements: string | null | undefined }): boolean {
  return f.tuitionPerYear == null && !!f.entryRequirements?.includes(FEE_IN_WORDS_NOTE);
}

/**
 * A yearly fee far from the median for its level in its country. With no fee,
 * no median, or a median on too few courses, nothing is said.
 */
export function feeOutlier(fee: number | null | undefined, median: number | null | undefined, courses: number): boolean {
  if (fee == null || median == null || courses < FEE_MEDIAN_MIN_COURSES) return false;
  if (median <= 0) return fee > 0;
  return fee < median * FEE_OUTLIER_LOW || fee > median * FEE_OUTLIER_HIGH;
}

export type CourseIdentity = { name: string; level: string; durationMonths: number | null | undefined };

/**
 * Two courses at one university that look like the same course entered twice:
 * one name (without case or punctuation) with a different level or a
 * different length. A bachelor's and a master's under one name can both be
 * real, which is why this is a flag and not a merge.
 */
export function looksDuplicate(a: CourseIdentity, b: CourseIdentity): boolean {
  if (nameKey(a.name) !== nameKey(b.name)) return false;
  return a.level !== b.level || (a.durationMonths ?? null) !== (b.durationMonths ?? null);
}

export { nameKey };

export type DuplicateOf = CourseIdentity & { id: string; status: string };

/**
 * The duplicate's chip: "Duplicate of X". When the other course is spelt the
 * same, its name alone would say nothing, so the level or the length that
 * differs is named instead.
 */
export function duplicateText(self: CourseIdentity, other: CourseIdentity): string {
  const differences: string[] = [];
  if (other.level !== self.level) differences.push(LEVEL_LABEL[other.level] ?? other.level);
  if ((other.durationMonths ?? null) !== (self.durationMonths ?? null)) differences.push(durationText(other.durationMonths).toLowerCase());
  const sameSpelling = other.name.trim() === self.name.trim();
  const what = sameSpelling ? `the ${differences.join(", ")} one` : other.name;
  return `Duplicate of ${what}`;
}

/** The words on each chip for one row. */
export function flagText(flag: ReviewFlag, self: CourseIdentity, duplicate: CourseIdentity | null): string {
  if (flag === "DUPLICATE" && duplicate) return duplicateText(self, duplicate);
  return FLAG_LABEL[flag];
}

export type FlagFacts = DurationFacts &
  ScoreFacts & {
    tuitionPerYear: number | null | undefined;
    intakeMonths: readonly number[] | null | undefined;
    feeMedian: number | null | undefined;
    feeCourses: number;
    duplicate: CourseIdentity | null;
  };

/** Every flag one row trips, in chip order. The SQL in the server file must agree with this. */
export function reviewFlags(f: FlagFacts): ReviewFlag[] {
  const out: ReviewFlag[] = [];
  if (f.duplicate) out.push("DUPLICATE");
  if (feeOutlier(f.tuitionPerYear, f.feeMedian, f.feeCourses)) out.push("FEE_OUTLIER");
  if (feeInWords(f)) out.push("FEE_IN_WORDS");
  if (!f.intakeMonths?.length) out.push("NO_INTAKES");
  if (oddDuration(f)) out.push("ODD_DURATION");
  if (oddScore(f)) out.push("SCORE_ODD");
  return out;
}

/** The three ways to see a university's drafts. */
export type ShowFilter = "all" | "flagged" | "clean";

export function readShow(v: string | string[] | undefined): ShowFilter {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "flagged" || s === "clean" ? s : "all";
}

export const SHOW_LABEL: Record<ShowFilter, string> = { all: "All", flagged: "Worth a look", clean: "Clean" };
