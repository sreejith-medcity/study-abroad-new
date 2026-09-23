import { and, eq, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { schema } from "@/db";
import type { EligibilityInput } from "@/lib/eligibility";
import { PROGRAM_TAGS, SEASONS, type ProgramTag } from "@/lib/program-tags";
import { notBlockedWhere } from "@/server/eligibility-sql";
import { hasOpenScholarship } from "@/server/scholarships";
import { closingWithin } from "@/server/deadlines";
import { hasCommissionRule } from "@/server/commission-estimate";

const { programs: p, universities: u, countries: c } = schema;

/** Keys that may carry several values; they travel comma-separated. */
const MULTI = ["level", "season", "tags", "country"] as const;

/**
 * Search parameters as one string per key. Checkbox groups submit a key more
 * than once, so those are joined with commas, which keeps every link on the
 * page a plain query string.
 */
export function readSearch(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k === "id") continue;
    const vals = (Array.isArray(v) ? v : [v]).filter((x): x is string => !!x);
    if (!vals.length) continue;
    out[k] = (MULTI as readonly string[]).includes(k) ? [...new Set(vals.flatMap((x) => x.split(",")).filter(Boolean))].join(",") : vals[0];
  }
  return out;
}

export const listOf = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : []);

export const LEVELS = [
  ["UG", "Bachelor's"],
  ["PG", "Master's"],
  ["PG_DIPLOMA", "PG diploma"],
  ["UG_DIPLOMA", "Diploma"],
  ["PHD", "PhD"],
  ["VOCATIONAL", "Vocational (Ausbildung)"],
  ["REGISTRATION", "Registration route"],
  ["CERTIFICATE", "Certificate"],
] as const;

const noEnglish = () => and(sql`${p.minIelts} is null`, sql`${p.minPte} is null`, sql`${p.minToefl} is null`, sql`${p.minDuolingo} is null`, sql`${p.minOetGrade} is null`)!;

/** One-click filters. Each has the SQL it adds, so the chips can show counts. */
export const QUICK: { key: string; label: string; cond: () => SQL }[] = [
  { key: "noAppFee", label: "No application fee", cond: () => eq(p.applicationFee, 0) },
  { key: "waiver", label: "Application fee waiver", cond: () => sql`${p.feeWaiver} is not null` },
  { key: "moi", label: "MOI accepted", cond: () => eq(p.moiAccepted, true) },
  { key: "noEnglish", label: "No English test needed", cond: noEnglish },
  { key: "noGre", label: "No GRE", cond: () => sql`${p.minGre} is null` },
  { key: "noGmat", label: "No GMAT", cond: () => sql`${p.minGmat} is null` },
  { key: "lowDeposit", label: "Deposit under 1,500", cond: () => or(lte(p.initialDeposit, 1500), sql`${p.initialDeposit} is null`)! },
  { key: "workRights", label: "Post-study work", cond: () => eq(p.workRights, "ELIGIBLE") },
  { key: "scholarship", label: "Scholarship available", cond: () => hasOpenScholarship },
  { key: "closing", label: "Deadline in the next 30 days", cond: () => closingWithin(30) },
  { key: "commission", label: "Commission on offer", cond: () => hasCommissionRule },
  { key: "ausbildung", label: "Ausbildung", cond: () => eq(p.pathway, "AUSBILDUNG") },
  { key: "nursing", label: "Nurse registration", cond: () => eq(p.pathway, "NURSING") },
];

export const tagCond = (tag: string) => sql`${tag} = any(${p.tags})`;

/** Applications open: a recorded deadline still ahead. Closed: deadlines recorded, all passed. */
export const openCond = sql`exists (select 1 from program_deadlines pd where pd.program_id = programs.id and pd.deadline >= current_date)`;
export const closedCond = sql`(exists (select 1 from program_deadlines pd where pd.program_id = programs.id) and not ${openCond})`;

/**
 * A student described on the spot, without a file: scores and marks typed
 * into search. Only official scores; the marks are percentages only.
 */
export function adhocStudent(f: Record<string, string>): (EligibilityInput & { label: string }) | null {
  const num = (k: string) => (f[k] !== undefined && f[k] !== "" && !Number.isNaN(Number(f[k])) ? Number(f[k]) : null);
  const tests: EligibilityInput["tests"] = [];
  const parts: string[] = [];
  for (const [key, test, label] of [["ae_ielts", "IELTS", "IELTS"], ["ae_pte", "PTE", "PTE"], ["ae_toefl", "TOEFL", "TOEFL"], ["ae_duolingo", "DUOLINGO", "Duolingo"], ["ae_gre", "GRE", "GRE"], ["ae_gmat", "GMAT", "GMAT"]] as const) {
    const v = num(key);
    if (v != null) {
      tests.push({ test, overall: String(v), isMock: false });
      parts.push(`${label} ${v}`);
    }
  }
  const academics: NonNullable<EligibilityInput["academics"]> = [];
  const school = num("ae_12");
  const ug = num("ae_ug");
  if (school != null) {
    academics.push({ level: "SCHOOL", gradingSystem: "percentage", score: school });
    parts.push(`12th ${school}%`);
  }
  if (ug != null) {
    academics.push({ level: "UG", gradingSystem: "percentage", score: ug });
    parts.push(`bachelor's ${ug}%`);
  }
  const backlogs = num("ae_backlogs");
  const gapYears = num("ae_gap");
  if (backlogs != null) parts.push(`${backlogs} backlogs`);
  if (gapYears != null) parts.push(`${gapYears}-year gap`);
  if (!parts.length) return null;
  return { tests, academics, backlogs, gapYears, label: parts.join(" · ") };
}

export const AE_KEYS = ["ae_ielts", "ae_pte", "ae_toefl", "ae_duolingo", "ae_gre", "ae_gmat", "ae_12", "ae_ug", "ae_backlogs", "ae_gap"] as const;

/**
 * A yearly budget in rupees, against fees in each destination's currency at
 * the platform's indicative rates. A per-year fee is compared directly. A
 * whole-course fee is only used to rule a program out when its average year
 * is over budget, which is certain without inventing a yearly figure. Programs
 * with no fee on record, or in a currency with no rate, stay in the list.
 */
export function budgetWhere(budgetInr: number, rates: Record<string, number>): SQL {
  const known = Object.entries(rates).filter(([k]) => /^[A-Z]{3}$/.test(k));
  const rate = sql`(case ${c.currency} ${sql.join(known.map(([k, v]) => sql`when ${k} then ${v}::numeric`), sql` `)} end)`;
  return sql`(case
    when ${rate} is null then true
    when ${p.tuitionPerYear} is not null then ${p.tuitionPerYear} * ${rate} <= ${budgetInr}::numeric
    when ${p.tuitionTotal} is not null and ${p.durationMonths} > 0 then ${p.tuitionTotal} * ${rate} * 12 <= ${budgetInr}::numeric * ${p.durationMonths}
    else true end)`;
}

/**
 * The conditions of a search. Search, the comparison and the download all
 * read them from here, so a downloaded list is the list on screen.
 */
export function searchConds(
  f: Record<string, string>,
  student: Pick<EligibilityInput, "backlogs" | "tests" | "academics"> | null,
  rates: Record<string, number>,
): (SQL | undefined)[] {
  const conds: (SQL | undefined)[] = [eq(p.status, "LIVE")];
  const budget = Number(f.budget) > 0 ? Number(f.budget) * 1e5 : null;
  if (budget) conds.push(budgetWhere(budget, rates));
  if (f.q) conds.push(or(ilike(p.name, `%${f.q}%`), ilike(u.name, `%${f.q}%`), ilike(p.studyArea, `%${f.q}%`), ilike(p.campus, `%${f.q}%`)));
  const countries = listOf(f.country);
  if (countries.length === 1) conds.push(eq(c.code, countries[0]));
  else if (countries.length > 1) conds.push(sql`${c.code} in (${sql.join(countries.map((x) => sql`${x}`), sql`, `)})`);
  if (f.uni) conds.push(eq(u.id, f.uni));
  if (f.field) conds.push(eq(p.studyArea, f.field));
  if (f.pathway) conds.push(eq(p.pathway, f.pathway as schema.Pathway));
  const levels = listOf(f.level).filter((l) => LEVELS.some(([k]) => k === l));
  if (levels.length) conds.push(sql`${p.level} in (${sql.join(levels.map((l) => sql`${l}`), sql`, `)})`);
  if (f.intakeMonth) conds.push(sql`${Number(f.intakeMonth)} = any(${p.intakeMonths})`);
  const months = listOf(f.season).flatMap((s) => (s in SEASONS ? [...SEASONS[s as keyof typeof SEASONS]] : []));
  if (months.length) conds.push(sql`${p.intakeMonths} && array[${sql.join(months.map((m) => sql`${m}`), sql`, `)}]::int[]`);
  // Older links carried a figure in the destination's own currency.
  if (f.maxTuition && countries.length === 1) conds.push(or(lte(p.tuitionPerYear, Number(f.maxTuition)), sql`${p.tuitionPerYear} is null`));
  if (f.minIelts) conds.push(or(lte(p.minIelts, Number(f.minIelts)), sql`${p.minIelts} is null`));
  for (const q of QUICK) if (f[q.key]) conds.push(q.cond());
  const tags = listOf(f.tags).filter((t) => t in PROGRAM_TAGS) as ProgramTag[];
  if (tags.length) conds.push(sql`${p.tags} @> array[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]::text[]`);
  if (f.apply === "open") conds.push(openCond);
  if (f.apply === "closed") conds.push(closedCond);
  // Hide what the student cannot meet yet; on-track programs stay.
  if (student && f.fit) conds.push(notBlockedWhere(student));
  return conds;
}
