import "server-only";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EligibilityInput } from "@/lib/eligibility";
import { SEASONS } from "@/lib/program-tags";
import { budgetWhere, listOf, QUICK, searchConds } from "@/server/program-search";
import { notBlockedWhere } from "@/server/eligibility-sql";
import { hasOpenScholarship } from "@/server/scholarships";

const { programs: p, universities: u, countries: c } = schema;

/** Everything the finder carries from step to step. */
export const FINDER_KEYS = [
  "student", "country", "level", "season", "field", "budget", "fit", "q", "uni", "uniType", "qual", "gapMonths", "tat", "durFrom", "durTo", "intakeMonth", "apply", "sort", "pathway", "tags",
  ...QUICK.map((q) => q.key),
  "ae_ielts", "ae_pte", "ae_toefl", "ae_duolingo", "ae_gre", "ae_gmat", "ae_12", "ae_ug", "ae_backlogs", "ae_gap",
] as const;

/**
 * How many matches are read back when the order is the finder's own. Fit is
 * worked out per program in the application, not in SQL, so the order it gives
 * can only cover what was read: the best of these, by the filters that decide
 * most of the score anyway. Every other order is a plain SQL sort over every
 * match, page by page. The screen says which it is showing.
 */
export const CANDIDATES = 400;
export const PAGE = 25;

/** The orders offered, beside the finder's own. */
export const SORTS = [
  ["", "Best fit first"],
  ["fee", "Lowest tuition first"],
  ["feeHigh", "Highest tuition first"],
  ["rank", "Best university ranking first"],
  ["tat", "Fastest offer first"],
  ["name", "Course name"],
] as const;

/**
 * A program a little over the budget is still worth seeing, with the overshoot
 * said plainly, so the finder looks a quarter past the figure given and scores
 * only the ones inside it as a fit.
 */
export const BUDGET_HEADROOM = 1.25;

export const wantedMonths = (f: Record<string, string>) => {
  const months = listOf(f.season).flatMap((s) => (s in SEASONS ? [...SEASONS[s as keyof typeof SEASONS]] : []));
  return [...new Set(months)].sort((a, b) => a - b);
};

/** The budget in rupees a year, as it was typed in lakhs. */
export const budgetInr = (f: Record<string, string>) => (Number(f.budget) > 0 ? Number(f.budget) * 1e5 : null);

/** The finder's filters: the search conditions, with the budget given headroom. */
export function finderWhere(f: Record<string, string>, checker: Pick<EligibilityInput, "backlogs" | "tests" | "academics"> | null, rates: Record<string, number>) {
  const budget = budgetInr(f);
  const loose = { ...f };
  if (budget) loose.budget = String((budget * BUDGET_HEADROOM) / 1e5);
  return and(...searchConds(loose, checker, rates));
}

export type FinderRow = Awaited<ReturnType<typeof finderCandidates>>[number];

/** The matches themselves, ready to be scored in full. */
export async function finderCandidates(
  where: ReturnType<typeof finderWhere>,
  opts: { checker: Pick<EligibilityInput, "backlogs" | "tests" | "academics"> | null; months: number[]; budget: number | null; rates: Record<string, number>; sort?: string; limit?: number; offset?: number },
) {
  const chosen = SORTS.some(([k]) => k === opts.sort && k !== "") ? opts.sort : "";
  const order = chosen
    ? {
        fee: [sql`${p.tuitionPerYear} is null`, asc(p.tuitionPerYear), sql`${p.tuitionTotal} is null`, asc(p.tuitionTotal), asc(p.name)],
        feeHigh: [sql`${p.tuitionPerYear} desc nulls last`, sql`${p.tuitionTotal} desc nulls last`, asc(p.name)],
        rank: [sql`${u.rankSort} asc nulls last`, asc(u.name), asc(p.name)],
        tat: [sql`${p.offerTatDays} asc nulls last`, asc(p.name)],
        name: [asc(p.name), asc(u.name)],
      }[chosen as "fee" | "feeHigh" | "rank" | "tat" | "name"]
    : [
        opts.checker ? sql`(${notBlockedWhere(opts.checker)}) desc` : undefined,
        opts.months.length ? sql`(${p.intakeMonths} && array[${sql.join(opts.months.map((m) => sql`${m}`), sql`, `)}]::int[]) desc` : undefined,
        opts.budget ? sql`(${budgetWhere(opts.budget, opts.rates)}) desc` : undefined,
        sql`${u.rankSort} asc nulls last`,
        asc(p.name),
      ].filter((x) => x !== undefined);
  return db
    .select({
      id: p.id,
      name: p.name,
      level: p.level,
      pathway: p.pathway,
      studyArea: p.studyArea,
      durationMonths: p.durationMonths,
      tuitionPerYear: p.tuitionPerYear,
      tuitionTotal: p.tuitionTotal,
      applicationFee: p.applicationFee,
      initialDeposit: p.initialDeposit,
      typicalScholarship: p.typicalScholarship,
      feeWaiver: p.feeWaiver,
      offerTatDays: p.offerTatDays,
      tags: p.tags,
      intakeMonths: p.intakeMonths,
      minIelts: p.minIelts,
      minIeltsBand: p.minIeltsBand,
      minPte: p.minPte,
      minToefl: p.minToefl,
      minDuolingo: p.minDuolingo,
      minGre: p.minGre,
      minGmat: p.minGmat,
      minSat: p.minSat,
      minOetGrade: p.minOetGrade,
      minGermanLevel: p.minGermanLevel,
      minAcademicPercent: p.minAcademicPercent,
      maxBacklogs: p.maxBacklogs,
      maxGapYears: p.maxGapYears,
      moiAccepted: p.moiAccepted,
      workRights: p.workRights,
      workRightsNote: p.workRightsNote,
      universityId: u.id,
      university: u.name,
      city: sql<string | null>`coalesce(${p.campus}, ${u.city})`,
      isPublic: u.isPublic,
      qsRank: u.qsRank,
      qsYear: u.qsYear,
      theRank: u.theRank,
      theYear: u.theYear,
      country: c.name,
      countryCode: c.code,
      currency: c.currency,
      scholarship: sql<boolean>`${hasOpenScholarship}`.mapWith(Boolean),
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where)
    .orderBy(...order)
    .limit(opts.limit ?? CANDIDATES)
    .offset(opts.offset ?? 0);
}

/** How many match at all, how many the student can meet, how many sit inside the budget. */
export async function finderCounts(
  where: ReturnType<typeof finderWhere>,
  opts: { checker: Pick<EligibilityInput, "backlogs" | "tests" | "academics"> | null; budget: number | null; rates: Record<string, number> },
) {
  const [row] = await db
    .select({
      total: count(),
      unis: sql<number>`count(distinct ${u.id})`.mapWith(Number),
      meets: opts.checker ? sql<number>`count(*) filter (where ${notBlockedWhere(opts.checker)})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
      inBudget: opts.budget ? sql<number>`count(*) filter (where ${budgetWhere(opts.budget, opts.rates)})`.mapWith(Number) : sql<number>`0`.mapWith(Number),
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where);
  return row;
}

/**
 * The universities behind the matches, with how many each holds, for the panel
 * that narrows a long list. Ordered by size, because that is the order a
 * counsellor scans, and capped so a 27,000-program search still renders.
 */
export async function universityFacets(where: ReturnType<typeof finderWhere>, limit = 60) {
  return db
    .select({ id: u.id, name: u.name, country: c.name, n: count() })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where)
    .groupBy(u.id, u.name, c.name)
    .orderBy(sql`count(*) desc`, asc(u.name))
    .limit(limit);
}

/** The levels behind the matches, with counts, in the order the finder lists them. */
export async function levelFacets(where: ReturnType<typeof finderWhere>) {
  const rows = await db
    .select({ level: p.level, n: count() })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where)
    .groupBy(p.level);
  return new Map(rows.map((r) => [r.level as string, r.n]));
}

/** Destinations with live programs, for the step that asks where. */
export async function destinationCounts() {
  return db
    .select({ code: c.code, name: c.name, n: count() })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(eq(p.status, "LIVE"))
    .groupBy(c.code, c.name)
    .orderBy(asc(c.name));
}

/** Fields of study worth offering as a choice. */
export async function studyFields(min = 5) {
  const rows = await db
    .select({ field: p.studyArea, n: count() })
    .from(p)
    .where(and(eq(p.status, "LIVE"), sql`${p.studyArea} is not null`))
    .groupBy(p.studyArea)
    .having(sql`count(*) >= ${min}`)
    .orderBy(asc(p.studyArea));
  return rows.map((r) => ({ field: r.field as string, n: r.n }));
}
