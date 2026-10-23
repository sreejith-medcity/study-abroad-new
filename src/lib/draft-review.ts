/**
 * Reviewing draft courses one university at a time.
 *
 * The MIOC app brought about 104,000 courses in as drafts, and the CRICOS
 * register brings more. Publishing all of them from the Programs filter in one
 * press puts every course nobody has looked at in front of counsellors, so the
 * desk works through them university by university instead. This file holds
 * the filters and the wording; the queries are in src/server/draft-review.ts,
 * and the publish rules themselves in src/lib/publish-rules.ts.
 */

/** The sources a draft can be narrowed to. Anything else means any source. */
export const REVIEW_SOURCES = { MIOC: "the MIOC app", CRICOS: "the CRICOS register" } as const;
export type ReviewSource = keyof typeof REVIEW_SOURCES;

export type ReviewFilters = {
  /** Part of a university's name. */
  q?: string;
  /** A country code, as the Programs filter uses. */
  country?: string;
  source?: ReviewSource;
  /** Most drafts first, or by name. */
  sort: "drafts" | "name";
  page: number;
};

import { count, heldBackText } from "./publish-rules";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? "";

export function readReviewFilters(sp: Record<string, string | string[] | undefined>): ReviewFilters {
  const q = one(sp.q).slice(0, 100);
  const country = one(sp.country).toUpperCase();
  const source = one(sp.source);
  const page = Math.floor(Number(one(sp.page)));
  return {
    q: q || undefined,
    country: /^[A-Z]{2}$/.test(country) ? country : undefined,
    source: source in REVIEW_SOURCES ? (source as ReviewSource) : undefined,
    sort: one(sp.sort) === "name" ? "name" : "drafts",
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/**
 * The query string that carries the filters from the list to a university and
 * on to the next one, leaving out whatever is at its default so the links stay
 * short. The page is left out unless asked for: a university's own drafts have
 * pages of their own.
 */
export function reviewQuery(f: Partial<ReviewFilters>, extra: Record<string, string | number | undefined> = {}): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.country) sp.set("country", f.country);
  if (f.source) sp.set("source", f.source);
  if (f.sort === "name") sp.set("sort", "name");
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "" && !(k === "page" && Number(v) <= 1)) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/**
 * The publish rules live in src/lib/publish-rules.ts, shared with every other
 * path that can set a course live. They are re-exported here because the
 * review screens and their tests have always read them from this file.
 */
export { PROBLEM_LABEL, publishProblems, type PublishProblem } from "./publish-rules";

/** What one press did, counted by the database. */
export type ReviewOutcome = {
  op: "publish" | "archive";
  /** Courses whose status changed. */
  done: number;
  /** Drafts in what was asked for that are still drafts because they broke a rule. */
  left: number;
  noIntakes: number;
  noEvidence: number;
  /** Ticked courses that were no longer drafts by the time the press arrived. */
  gone: number;
};

/**
 * The answer after a press, in the words the desk reads: what was done, what
 * was left and why, so the courses still waiting can be opened and fixed.
 */
export function outcomeText(o: ReviewOutcome): string {
  const parts: string[] = [];
  if (o.op === "archive") {
    parts.push(o.done ? `Archived ${o.done}.` : "Nothing archived.");
  } else {
    parts.push(o.done ? `Published ${o.done}.` : "Nothing published.");
    if (o.left) {
      parts.push(heldBackText(o, count(o.left, "left as a draft", "left as drafts")));
      parts.push(o.left === 1 ? "Open it to add what is missing." : "Open each one to add what is missing.");
    }
  }
  if (o.gone) parts.push(o.gone === 1 ? "1 was no longer a draft, so it was left as it was." : `${o.gone} were no longer drafts, so they were left as they were.`);
  return parts.join(" ");
}

/** The first lines of the entry notes, short enough for a table cell. */
export function firstLines(text: string | null | undefined, lines = 2, max = 160): string {
  if (!text) return "";
  const kept = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, lines)
    .join(" ");
  return kept.length > max ? `${kept.slice(0, max - 1).trimEnd()}…` : kept;
}

/** The share of drafts with a figure recorded, as a whole percentage. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
