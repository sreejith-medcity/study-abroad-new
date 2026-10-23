import { durationText, feeText, intakesText, LEVEL_LABEL, PATHWAY_LABEL } from "./catalogue";
import { PROGRAM_TAGS } from "./program-tags";
import { publishProblems } from "./publish-rules";

/**
 * The pure half of the catalogue's change history: which fields changed, what
 * each is called, and how a stored value reads. Kept apart from the database
 * so it can be tested on its own and used by the page as well as the server.
 */

export type CatalogueEntity = "program" | "university";
export type ChangeSource = "edit" | "bulk" | "review" | "import" | "cricos" | "registry" | "mioc" | "restore";
export type FieldChange = { field: string; before: unknown; after: unknown };

/** Bookkeeping columns that move on every write and say nothing about the course. */
const ALWAYS_IGNORED = new Set(["id", "createdAt", "updatedAt"]);

/** Turns what was read or written into what jsonb can hold and compare. */
export function storable(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  if (Array.isArray(v)) return v.map(storable);
  return v;
}

/** Text as it reads: Unix line endings, and no spaces at the end of a line or of the whole. */
export function plainText(v: unknown): unknown {
  if (typeof v !== "string") return v;
  return v.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
}

/**
 * Whether two stored values mean the same thing.
 *
 * Blank text, null and an empty list all mean "nothing recorded", so moving
 * between them is not a change worth a row. A list is compared without regard
 * to order, because the edit screen sorts intakes and tags while a sync may
 * not, and reordering is not a change anybody made. Numbers allow for the
 * rounding a real column brings back (6.1 can return as 6.0999999), and a number
 * that came back from jsonb as text still matches itself. Text is compared
 * without Windows line endings or trailing spaces, because a browser sends a
 * text box back with CRLF and an import may have left spaces at line ends, and
 * saving some other field must not record the About text as changed.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  a = plainText(a);
  b = plainText(b);
  const empty = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (a instanceof Date || b instanceof Date) return storable(a) === storable(b);
  const asNumber = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
  if (typeof a === "number" || typeof b === "number") {
    const x = asNumber(a);
    const y = asNumber(b);
    if (x == null || y == null) return false;
    return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const key = (v: unknown) => JSON.stringify(storable(v));
    const left = a.map(key).sort();
    const right = b.map(key).sort();
    return left.every((v, i) => v === right[i]);
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  if (typeof a === "object" && typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/**
 * The fields of `next` that differ from `current`, with both values as they
 * will be stored. Only keys present in `next` are looked at, so a caller passes
 * exactly what it is about to write and the columns it leaves alone never show
 * up as changes.
 */
export function diffFields(current: Record<string, unknown>, next: Record<string, unknown>, ignore: readonly string[] = []): FieldChange[] {
  const skip = new Set([...ALWAYS_IGNORED, ...ignore]);
  const out: FieldChange[] = [];
  for (const [field, after] of Object.entries(next)) {
    if (skip.has(field) || after === undefined) continue;
    const before = current[field];
    if (sameValue(before, after)) continue;
    out.push({ field, before: storable(before), after: storable(after) });
  }
  return out;
}

/**
 * One entry per row and field. A CSV that lists a program twice, or a register
 * that names one institution twice, changes the same field twice in one batch;
 * kept as two entries, a restore of the batch could put back the middle value.
 * The merged entry runs from the earliest before to the latest after, and is
 * dropped when those two are the same, since the batch then changed nothing.
 */
export function mergeRepeats<T extends FieldChange & { entity: string; entityId: string }>(changes: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const c of changes) {
    const key = JSON.stringify([c.entity, c.entityId, c.field]);
    const seen = byKey.get(key);
    byKey.set(key, seen ? { ...seen, after: c.after } : c);
  }
  return [...byKey.values()].filter((c) => !sameValue(c.before, c.after));
}

export type SkippedField = { field: string; now: unknown };

/**
 * What a restore may write. A field goes back to its old value only while it
 * still holds the value the change gave it: if somebody, or a sync, has
 * changed it again since, writing the old value would silently throw that
 * newer value away, so the field is left alone and reported. A field already
 * back at its old value needs nothing and is not reported.
 */
export function planRestore(current: Record<string, unknown>, rows: readonly FieldChange[]): { values: Record<string, unknown>; skipped: SkippedField[] } {
  const byField = new Map<string, FieldChange>();
  for (const r of rows) {
    const seen = byField.get(r.field);
    byField.set(r.field, seen ? { ...seen, after: r.after } : r);
  }
  const values: Record<string, unknown> = {};
  const skipped: SkippedField[] = [];
  for (const r of byField.values()) {
    const now = current[r.field];
    if (sameValue(now, r.before)) continue;
    if (sameValue(now, r.after)) values[r.field] = r.before;
    else skipped.push({ field: r.field, now: storable(now) });
  }
  return { values, skipped };
}

/** Why each skipped field was left, in the words the history card uses for it. */
export function skippedText(entity: CatalogueEntity, skipped: readonly SkippedField[], ctx: { currency: string; docLabels?: Record<string, string> }): string {
  return skipped
    .map((s) => {
      const label = fieldLabel(entity, s.field);
      const shown = formatValue(entity, s.field, s.now, ctx);
      return shown === NOT_RECORDED
        ? `${label} was changed again since and is now not recorded; it was left as it is.`
        : `${label} was changed again since, to ${shown}; it was left as it is.`;
    })
    .join(" ");
}

export const PROGRAM_FIELD_LABEL: Record<string, string> = {
  name: "Name",
  level: "Level",
  pathway: "Pathway",
  status: "Status",
  studyArea: "Study area",
  campus: "Campus",
  durationMonths: "Duration",
  tuitionPerYear: "Tuition per year",
  tuitionTotal: "Tuition, whole course",
  applicationFee: "Application fee",
  initialDeposit: "Deposit",
  balanceDeposit: "Balance deposit",
  intakeMonths: "Intake months",
  minIelts: "IELTS overall",
  minIeltsBand: "IELTS lowest band",
  minPte: "PTE Academic",
  minOetGrade: "OET grade",
  minGermanLevel: "German level",
  minToefl: "TOEFL iBT",
  minDuolingo: "Duolingo",
  minGre: "GRE",
  minGmat: "GMAT",
  minSat: "SAT",
  minAcademicPercent: "Minimum marks",
  maxBacklogs: "Backlogs allowed",
  maxGapYears: "Study gap allowed",
  moiAccepted: "Medium of instruction letter accepted",
  feeWaiver: "Application fee waiver",
  programUrl: "Program page",
  entryRequirements: "Entry requirements",
  typicalScholarship: "Typical scholarship",
  offerTatDays: "Offer turnaround",
  tags: "Labels",
  workRights: "Post-study work",
  workRightsNote: "Post-study work evidence",
  requiredDocs: "Required documents",
  externalCode: "Register code",
};

export const UNIVERSITY_FIELD_LABEL: Record<string, string> = {
  name: "Name",
  city: "City",
  website: "Website",
  isPublic: "Public institution",
  externalCode: "Register code",
  qsRank: "QS ranking",
  qsYear: "QS edition",
  theRank: "THE ranking",
  theYear: "THE edition",
  about: "About",
  facts: "Facts",
};

/**
 * Fields a restore may write back. A register code is left out: it is how a
 * sync recognises its own rows, and putting an old one back could collide
 * with the row that holds it now.
 */
export function restorable(entity: CatalogueEntity, field: string) {
  if (field === "externalCode") return false;
  return entity === "program" ? field in PROGRAM_FIELD_LABEL : field in UNIVERSITY_FIELD_LABEL;
}

const STATUSES = ["DRAFT", "LIVE", "ARCHIVED"];
const WORK_RIGHTS = ["UNKNOWN", "ELIGIBLE", "INELIGIBLE"];

/**
 * Why putting old values back would leave a program the edit screen would
 * refuse to save, or null when it is fine. A rule is only applied when the
 * restore touches one of its fields: thousands of register courses are live
 * with no intake recorded, and restoring a fee on one of those must not be
 * blocked by a rule about intakes.
 */
export function programRestoreProblem(
  row: { name: unknown; level: unknown; pathway: unknown; status: unknown; intakeMonths: unknown; workRights: unknown; workRightsNote: unknown },
  touched: Iterable<string>,
): string | null {
  const t = new Set(touched);
  if (t.has("name") && (typeof row.name !== "string" || !row.name.trim())) return "A program needs a name, so a blank one cannot come back.";
  if (t.has("level") && !(String(row.level) in LEVEL_LABEL)) return "That level is not one the catalogue uses any more.";
  if (t.has("pathway") && !(String(row.pathway) in PATHWAY_LABEL)) return "That pathway is not one the catalogue uses any more.";
  if (t.has("status") && !STATUSES.includes(String(row.status))) return "That status is not one the catalogue uses any more.";
  if (t.has("workRights") && !WORK_RIGHTS.includes(String(row.workRights))) return "That post-study work answer is not one the catalogue uses any more.";
  // The shared publish rules, read from a row whose values came out of the
  // history as plain JSON and so may be of any type.
  const problems = publishProblems({
    intakeMonths: Array.isArray(row.intakeMonths) ? (row.intakeMonths as number[]) : null,
    workRights: String(row.workRights),
    workRightsNote: typeof row.workRightsNote === "string" ? row.workRightsNote : null,
  });
  if ((t.has("status") || t.has("intakeMonths")) && row.status === "LIVE" && problems.includes("intakes")) {
    return "That would leave a live program with no intake, and nobody could apply. Restore the intakes too, or set it to draft first.";
  }
  // Evidence is asked for whatever the status, as the edit screen asks for it.
  if ((t.has("workRights") || t.has("workRightsNote")) && problems.includes("evidence")) {
    return "That would leave a post-study work answer with no evidence behind it. Restore the evidence too.";
  }
  return null;
}

export function fieldLabel(entity: CatalogueEntity, field: string) {
  return (entity === "program" ? PROGRAM_FIELD_LABEL : UNIVERSITY_FIELD_LABEL)[field] ?? field;
}

export const SOURCE_LABEL: Record<string, string> = {
  edit: "Edited",
  bulk: "Bulk change",
  review: "Draft review",
  import: "CSV import",
  cricos: "CRICOS sync",
  registry: "Register sync",
  mioc: "MIOC import",
  restore: "Restored",
};

const STATUS_LABEL: Record<string, string> = { DRAFT: "Draft", LIVE: "Live", ARCHIVED: "Archived" };
const WORK_RIGHTS_LABEL: Record<string, string> = { UNKNOWN: "Not confirmed", ELIGIBLE: "Eligible", INELIGIBLE: "Not eligible" };
const MONEY_ZERO: Record<string, string> = {
  tuitionPerYear: "No tuition fee",
  tuitionTotal: "No tuition fee",
  applicationFee: "No application fee",
  initialDeposit: "None",
  balanceDeposit: "None",
};

const NOT_RECORDED = "Not recorded";
const clip = (s: string, max = 160) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One stored value as the rest of the admin screens would show it. */
export function formatValue(entity: CatalogueEntity, field: string, value: unknown, ctx: { currency: string; docLabels?: Record<string, string> }): string {
  if (value == null || value === "") return NOT_RECORDED;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (entity === "university") return Array.isArray(value) ? (value.length ? clip(value.map(String).join("; ")) : "None") : clip(String(value));

  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  if (field in MONEY_ZERO) return n == null ? clip(String(value)) : feeText(n, ctx.currency, { zero: MONEY_ZERO[field] });
  if (field === "durationMonths") return n == null ? clip(String(value)) : durationText(n);
  if (field === "intakeMonths") return Array.isArray(value) ? intakesText(value.map(Number)) : clip(String(value));
  if (field === "tags") return Array.isArray(value) ? (value.length ? value.map((t) => PROGRAM_TAGS[t as keyof typeof PROGRAM_TAGS] ?? String(t)).join(", ") : "None") : clip(String(value));
  if (field === "requiredDocs") return Array.isArray(value) ? (value.length ? value.map((d) => ctx.docLabels?.[String(d)] ?? String(d)).join(", ") : "None") : clip(String(value));
  if (field === "level") return LEVEL_LABEL[String(value)] ?? String(value);
  if (field === "pathway") return PATHWAY_LABEL[String(value)] ?? String(value);
  if (field === "status") return STATUS_LABEL[String(value)] ?? String(value);
  if (field === "workRights") return WORK_RIGHTS_LABEL[String(value)] ?? String(value);
  if (field === "offerTatDays" && n != null) return plural(n, "day", "days");
  if (field === "maxGapYears" && n != null) return plural(n, "year", "years");
  if (field === "minAcademicPercent" && n != null) return `${n}%`;
  if (Array.isArray(value)) return value.length ? clip(value.map(String).join(", ")) : "None";
  return clip(String(value));
}
