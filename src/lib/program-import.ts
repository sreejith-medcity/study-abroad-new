import { TAG_KEYS } from "./program-tags";
import Papa from "papaparse";
import { MONTHS } from "./format";

/** Sample shown in the admin paste box. Kept here so a test can prove it parses. */
export const PROGRAM_CSV_TEMPLATE = `program,university,city,country_code,pathway,level,study_area,duration_months,tuition_per_year,application_fee,initial_deposit,intakes,min_ielts,min_pte,min_oet_grade,min_german_level,max_backlogs,max_gap_years,moi_accepted,work_rights,work_rights_note,required_docs,status
MSc Public Health,University of Westbridge,Leeds,GB,DEGREE,PG,Health,12,17800,0,2000,Jan|Sep,6.5,58,,,5,4,no,ELIGIBLE,Graduate Route; university confirms eligibility,PASSPORT|MARKSHEET_12|DEGREE_MARKSHEETS|ENGLISH_TEST|SOP,LIVE`;

export const IMPORT_COLUMNS = [
  "program", "university", "city", "country_code", "pathway", "level", "study_area", "duration_months",
  "tuition_per_year", "application_fee", "initial_deposit", "intakes", "min_ielts", "min_pte", "min_oet_grade",
  "min_german_level", "max_backlogs", "max_gap_years", "moi_accepted", "work_rights", "work_rights_note",
  "required_docs", "status",
  // Optional: leave the column out and a re-import keeps what is already recorded.
  "min_toefl", "min_duolingo", "min_gre", "min_gmat", "min_sat", "min_academic_percent", "fee_waiver", "deadlines",
  "program_url", "min_ielts_band", "entry_requirements", "balance_deposit", "typical_scholarship", "tags",
] as const;

const PATHWAYS = ["DEGREE", "AUSBILDUNG", "NURSING"] as const;
const LEVELS = ["SCHOOL", "UG_DIPLOMA", "UG", "PG_DIPLOMA", "PG", "PHD", "VOCATIONAL", "REGISTRATION", "CERTIFICATE"] as const;
const STATUSES = ["DRAFT", "LIVE", "ARCHIVED"] as const;
const WORK_RIGHTS = ["UNKNOWN", "ELIGIBLE", "INELIGIBLE"] as const;

/**
 * Accepts what a researcher or a university actually writes, rather than making
 * them learn three keywords. Anything unrecognised stays UNKNOWN, because on
 * this column a wrong yes is far more expensive than a missing answer.
 */
function parseWorkRights(v: string | undefined) {
  const t = (v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!t) return "UNKNOWN" as const;
  if (["ELIGIBLE", "YES", "TRUE", "Y", "1", "PGWP", "PGWP_ELIGIBLE", "STEM", "STEM_OPT", "STEM_OPT_ELIGIBLE", "GRADUATE_ROUTE"].includes(t)) return "ELIGIBLE" as const;
  if (["INELIGIBLE", "NO", "FALSE", "N", "0", "NOT_ELIGIBLE", "PGWP_INELIGIBLE", "NOT_PGWP_ELIGIBLE"].includes(t)) return "INELIGIBLE" as const;
  if (WORK_RIGHTS.includes(t as (typeof WORK_RIGHTS)[number])) return t as (typeof WORK_RIGHTS)[number];
  return null;
}

export type ImportRow = {
  line: number;
  program: string;
  university: string;
  city: string | null;
  countryCode: string;
  pathway: (typeof PATHWAYS)[number];
  level: (typeof LEVELS)[number];
  studyArea: string | null;
  durationMonths: number | null;
  tuitionPerYear: number | null;
  applicationFee: number | null;
  initialDeposit: number | null;
  intakeMonths: number[];
  minIelts: number | null;
  minPte: number | null;
  minOetGrade: string | null;
  minGermanLevel: string | null;
  /** Left undefined when the file has no such column, so a re-import keeps what is there. */
  minToefl?: number | null;
  minDuolingo?: number | null;
  minGre?: number | null;
  minGmat?: number | null;
  minSat?: number | null;
  minAcademicPercent?: number | null;
  feeWaiver?: string | null;
  programUrl?: string | null;
  minIeltsBand?: number | null;
  entryRequirements?: string | null;
  balanceDeposit?: number | null;
  typicalScholarship?: string | null;
  tags?: string[];
  /** Deadlines per intake from the optional `deadlines` column: 2027-09=2027-06-30|2028-01=2027-10-31. */
  deadlines?: { month: number; year: number; deadline: string }[];
  maxBacklogs: number | null;
  maxGapYears: number | null;
  moiAccepted: boolean;
  workRights: (typeof WORK_RIGHTS)[number];
  workRightsNote: string | null;
  requiredDocs: string[];
  status: (typeof STATUSES)[number];
};

export type ImportError = { line: number; message: string };

function parseTags(v: string, errors: string[]) {
  const tags = v.split("|").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const bad = tags.filter((t) => !(TAG_KEYS as string[]).includes(t));
  if (bad.length) errors.push(`tags: ${bad.join(", ")} not known (use ${TAG_KEYS.join(", ")})`);
  return tags.filter((t) => (TAG_KEYS as string[]).includes(t)).sort();
}

function parseDeadlines(v: string, errors: string[]) {
  const out: { month: number; year: number; deadline: string }[] = [];
  for (const part of v.split("|").map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{4})-(\d{1,2})\s*=\s*(\d{4}-\d{2}-\d{2})$/);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
      errors.push(`deadlines: "${part}" should look like 2027-09=2027-06-30`);
      continue;
    }
    out.push({ year: Number(m[1]), month: Number(m[2]), deadline: m[3] });
  }
  return out;
}

function num(v: string | undefined, field: string, errors: string[], opts: { int?: boolean } = {}) {
  const t = (v ?? "").replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isNaN(n) || n < 0 || (opts.int && !Number.isInteger(n))) {
    errors.push(`${field} must be a ${opts.int ? "whole " : ""}number`);
    return null;
  }
  return n;
}

function parseIntakes(v: string, errors: string[]) {
  const out: number[] = [];
  for (const part of v.split(/[|;/ ]+/).filter(Boolean)) {
    const asNum = Number(part);
    const idx = Number.isInteger(asNum) ? asNum : MONTHS.findIndex((m) => m.toLowerCase() === part.slice(0, 3).toLowerCase()) + 1;
    if (idx < 1 || idx > 12) errors.push(`Unknown intake month "${part}"`);
    else if (!out.includes(idx)) out.push(idx);
  }
  return out.sort((a, b) => a - b);
}

export function parseProgramCsv(text: string, validDocCodes: string[]): { rows: ImportRow[]; errors: ImportError[] } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
  const rows: ImportRow[] = [];
  const errors: ImportError[] = [];

  const missing = ["program", "university", "country_code", "level", "intakes"].filter((c) => !parsed.meta.fields?.includes(c));
  if (missing.length) return { rows, errors: [{ line: 1, message: `Missing required columns: ${missing.join(", ")}` }] };

  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const e: string[] = [];
    const optional = (v: string | undefined, field: string, opts: { int?: boolean }) => (v === undefined ? undefined : num(v, field, e, opts));
    const pathway = ((r.pathway || "DEGREE").trim().toUpperCase()) as ImportRow["pathway"];
    const level = (r.level ?? "").trim().toUpperCase() as ImportRow["level"];
    const status = ((r.status || "LIVE").trim().toUpperCase()) as ImportRow["status"];
    if (!r.program?.trim()) e.push("program is required");
    if (!r.university?.trim()) e.push("university is required");
    if (!/^[A-Za-z]{2}$/.test(r.country_code ?? "")) e.push("country_code must be a 2-letter code");
    if (!PATHWAYS.includes(pathway)) e.push(`pathway must be one of ${PATHWAYS.join(", ")}`);
    if (!LEVELS.includes(level)) e.push(`level must be one of ${LEVELS.join(", ")}`);
    if (!STATUSES.includes(status)) e.push(`status must be one of ${STATUSES.join(", ")}`);
    const intakeMonths = parseIntakes(r.intakes ?? "", e);
    // A draft may still be missing its intake months; a live program may not,
    // because nobody can apply to a program with no intake.
    if (!intakeMonths.length && status !== "DRAFT") e.push("at least one intake month is required");
    const requiredDocs = (r.required_docs ?? "").split(/[|;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
    const badDocs = requiredDocs.filter((d) => !validDocCodes.includes(d));
    if (badDocs.length) e.push(`unknown document codes: ${badDocs.join(", ")}`);
    const cefr = (r.min_german_level ?? "").trim().toUpperCase();
    if (cefr && !["A1", "A2", "B1", "B2", "C1", "C2"].includes(cefr)) e.push("min_german_level must be A1 to C2");
    const workRights = parseWorkRights(r.work_rights);
    if (workRights === null) e.push(`work_rights must be one of ${WORK_RIGHTS.join(", ")}`);

    const row: ImportRow = {
      line,
      program: (r.program ?? "").trim(),
      university: (r.university ?? "").trim(),
      city: r.city?.trim() || null,
      countryCode: (r.country_code ?? "").trim().toUpperCase(),
      pathway, level, status,
      studyArea: r.study_area?.trim() || null,
      durationMonths: num(r.duration_months, "duration_months", e, { int: true }),
      tuitionPerYear: num(r.tuition_per_year, "tuition_per_year", e, { int: true }),
      applicationFee: num(r.application_fee, "application_fee", e, { int: true }),
      initialDeposit: num(r.initial_deposit, "initial_deposit", e, { int: true }),
      intakeMonths,
      minIelts: num(r.min_ielts, "min_ielts", e),
      minPte: num(r.min_pte, "min_pte", e, { int: true }),
      minOetGrade: r.min_oet_grade?.trim().toUpperCase() || null,
      minGermanLevel: cefr || null,
      minToefl: optional(r.min_toefl, "min_toefl", { int: true }),
      minDuolingo: optional(r.min_duolingo, "min_duolingo", { int: true }),
      minGre: optional(r.min_gre, "min_gre", { int: true }),
      minGmat: optional(r.min_gmat, "min_gmat", { int: true }),
      minSat: optional(r.min_sat, "min_sat", { int: true }),
      minAcademicPercent: optional(r.min_academic_percent, "min_academic_percent", {}),
      feeWaiver: r.fee_waiver === undefined ? undefined : r.fee_waiver.trim() || null,
      programUrl: r.program_url === undefined ? undefined : r.program_url.trim() || null,
      minIeltsBand: optional(r.min_ielts_band, "min_ielts_band", {}),
      entryRequirements: r.entry_requirements === undefined ? undefined : r.entry_requirements.trim() || null,
      balanceDeposit: optional(r.balance_deposit, "balance_deposit", { int: true }),
      typicalScholarship: r.typical_scholarship === undefined ? undefined : r.typical_scholarship.trim() || null,
      tags: r.tags === undefined ? undefined : parseTags(r.tags, e),
      deadlines: r.deadlines === undefined ? undefined : parseDeadlines(r.deadlines, e),
      maxBacklogs: num(r.max_backlogs, "max_backlogs", e, { int: true }),
      maxGapYears: num(r.max_gap_years, "max_gap_years", e, { int: true }),
      moiAccepted: ["yes", "true", "1", "y"].includes((r.moi_accepted ?? "").trim().toLowerCase()),
      workRights: workRights ?? "UNKNOWN",
      workRightsNote: r.work_rights_note?.trim() || null,
      requiredDocs,
    };
    if (e.length) errors.push({ line, message: e.join("; ") });
    else rows.push(row);
  });

  return { rows, errors };
}
