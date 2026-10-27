/**
 * What the students list shows about a student's applications, worked out
 * from rows the page has already fetched.
 *
 * Kept here, away from the screen, so the wording of "+2 more" and the choice
 * between where a student is applying and where they once said they would like
 * to go are decided once and tested, rather than written into a table cell.
 */

/** One application as the list needs it: the programme and who teaches it. */
export type AppliedProgramme = { programme: string; university: string };

/**
 * A university's name short enough to sit beside a programme in a narrow
 * column. There is no short name on record, so it is the name itself, less a
 * leading "The" and a bracketed note at the end ("(training partner)",
 * "(sample)"), which say what kind of place it is, not which one. A name that
 * is nothing but a bracket is left as it was.
 */
export function shortUniversity(name: string): string {
  const trimmed = name.trim();
  const shorter = trimmed
    .replace(/\s*\([^()]*\)\s*$/, "")
    .replace(/^the\s+/i, "")
    .trim();
  return shorter || trimmed;
}

/**
 * The first one or two programmes a student has applied to, each with its
 * university, and how many more there are. `total` is the student's count of
 * applications, which can be more than the rows passed in: the page only
 * fetches the first few.
 */
export function programmesSummary(apps: AppliedProgramme[], total: number, show = 2): { shown: string[]; more: number; moreLabel: string | null } {
  const shown = apps.slice(0, Math.max(0, show)).map((a) => `${a.programme} (${shortUniversity(a.university)})`);
  const more = Math.max(0, total - shown.length);
  return { shown, more, moreLabel: more > 0 ? `+${more} more` : null };
}

/**
 * The countries to show for a student: the ones their applications are for,
 * or, when they have none, the country they said they would prefer, marked as
 * a preference so nobody reads it as somewhere they have applied. Nothing at
 * all when neither is known.
 */
export function countryCell(applied: (string | null | undefined)[], preferred: string | null | undefined): { names: string[]; preference: boolean } {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of applied) {
    const name = raw?.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  if (names.length) return { names, preference: false };
  const pref = preferred?.trim();
  return pref ? { names: [pref], preference: true } : { names: [], preference: false };
}
