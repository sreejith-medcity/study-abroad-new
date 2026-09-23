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
export const FINDER_KEYS = ["student", "country", "level", "season", "field", "budget", "fit", "q", ...QUICK.map((q) => q.key), "ae_ielts", "ae_pte", "ae_toefl", "ae_duolingo", "ae_gre", "ae_gmat", "ae_12", "ae_ug", "ae_backlogs", "ae_gap"] as const;

/** How many matches are read back and scored. The counts below cover them all. */
export const CANDIDATES = 120;

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

/** The matches themselves, best candidates first, ready to be scored in full. */
export async function finderCandidates(
  where: ReturnType<typeof finderWhere>,
  opts: { checker: Pick<EligibilityInput, "backlogs" | "tests" | "academics"> | null; months: number[]; budget: number | null; rates: Record<string, number> },
) {
  const order = [
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
      theRank: u.theRank,
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
    .limit(CANDIDATES);
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
