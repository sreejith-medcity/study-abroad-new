/**
 * The departments a person can be put in, until the head office writes its own
 * list in Settings, Platform. The same list is the column default in the
 * schema, so a fresh database and a settings row that cannot be read agree.
 */
export const DEFAULT_DEPARTMENTS = [
  "Study abroad",
  "Ausbildung",
  "NCLEX-RN",
  "Documentation",
  "Placement",
  "Visa",
  "Travel desk",
  "Finance",
  "Management",
] as const;

export const MAX_DEPARTMENTS = 40;
export const DEPARTMENT_NAME_LENGTH = 40;

/**
 * One department per line, as typed into the settings box. Blank lines go,
 * surrounding spaces go, and a name typed twice (in any case) counts once,
 * keeping the first spelling. Longer names are cut rather than refused,
 * because a list that will not save over one long line is a list nobody
 * finishes editing.
 */
export function parseDepartments(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, DEPARTMENT_NAME_LENGTH);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_DEPARTMENTS) break;
  }
  return out;
}

/**
 * What was typed for a person's department, checked against the list. Empty
 * means none. A name that is not on the list is refused rather than saved,
 * because the filter on the people lists reads the list, and a department
 * nobody can filter by is a department nobody can find.
 *
 * The one exception is the department the person already has. A name taken
 * off the list in Settings stays on the people who had it, and the edit
 * screen offers it back to them, so saving their name or email must not be
 * refused over a department that did not change.
 */
export function departmentChoice(
  value: string | null | undefined,
  list: readonly string[],
  current: string | null | undefined = null,
): { ok: true; department: string | null } | { ok: false; error: string } {
  const typed = (value ?? "").trim();
  if (!typed) return { ok: true, department: null };
  const match = list.find((d) => d.toLowerCase() === typed.toLowerCase());
  if (match) return { ok: true, department: match };
  if (current && current.toLowerCase() === typed.toLowerCase()) return { ok: true, department: current };
  return { ok: false, error: "Pick a department from the list. The list is kept in Settings, Platform." };
}
