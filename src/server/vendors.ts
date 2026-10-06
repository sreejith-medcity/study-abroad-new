import "server-only";
import { and, asc, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { routeCommission, type ProgramMoney, type RouteCommission, type RouteLike } from "@/lib/vendors";
import { rateOf } from "@/server/program-search";

const { vendors: v, programRoutes: pr, programs: p, universities: u, countries: c } = schema;

export type VendorRow = typeof schema.vendors.$inferSelect;

/** Every vendor, with how many live routes each one carries. */
export async function listVendors() {
  const rows = await db
    .select({
      vendor: v,
      routes: sql<number>`count(${pr.id}) filter (where ${pr.active})`.mapWith(Number),
      allRoutes: count(pr.id),
    })
    .from(v)
    .leftJoin(pr, eq(pr.vendorId, v.id))
    .groupBy(v.id)
    .orderBy(sql`${v.active} desc`, asc(v.name));
  return rows;
}

/** The vendors a screen may filter by: live ones, cheapest possible query. */
export async function liveVendors() {
  return db.select({ id: v.id, name: v.name, code: v.code, colour: v.colour, isDirect: v.isDirect }).from(v).where(eq(v.active, true)).orderBy(asc(v.name));
}

export type RouteWithVendor = { route: typeof schema.programRoutes.$inferSelect; vendor: VendorRow; commission: RouteCommission };

/** Every route to one course, with what each pays, live ones first. */
export async function routesForProgram(programId: string, program: ProgramMoney): Promise<RouteWithVendor[]> {
  const rows = await db
    .select({ route: pr, vendor: v })
    .from(pr)
    .innerJoin(v, eq(pr.vendorId, v.id))
    .where(eq(pr.programId, programId))
    .orderBy(sql`${pr.active} desc`, asc(v.name));
  return rows.map((r) => ({ ...r, commission: routeCommission(r.route as RouteLike, program) }));
}

export type RouteChip = { vendorId: string; code: string; colour: string; name: string; active: boolean; isDirect: boolean; commission: RouteCommission };

/**
 * The routes behind a list of courses, for rows in search and the finder. One
 * query for the page, not one per row.
 */
export async function routeChips(programs: { id: string; tuitionPerYear: number | null; tuitionTotal: number | null; applicationFee: number | null; offerTatDays: number | null; currency: string }[]) {
  const out = new Map<string, RouteChip[]>();
  if (!programs.length) return out;
  const rows = await db
    .select({ programId: pr.programId, route: pr, vendorId: v.id, code: v.code, colour: v.colour, name: v.name, isDirect: v.isDirect })
    .from(pr)
    .innerJoin(v, eq(pr.vendorId, v.id))
    .where(and(inArray(pr.programId, programs.map((x) => x.id)), eq(v.active, true)))
    // Our own agreement first in the row as well, so the chips read in the same
    // order the list itself is sorted in.
    .orderBy(sql`${v.isDirect} desc`, asc(v.name));
  const byId = new Map(programs.map((x) => [x.id, x]));
  for (const r of rows) {
    const program = byId.get(r.programId);
    if (!program) continue;
    const list = out.get(r.programId) ?? [];
    list.push({
      vendorId: r.vendorId,
      code: r.code,
      colour: r.colour,
      name: r.name,
      active: r.route.active,
      isDirect: r.isDirect,
      commission: routeCommission(r.route as RouteLike, program),
    });
    out.set(r.programId, list);
  }
  return out;
}

/** How many live courses each vendor reaches, for the vendors screen. */
export async function vendorCoverage() {
  const rows = await db
    .select({ vendorId: pr.vendorId, countries: sql<number>`count(distinct ${c.id})`.mapWith(Number), programs: count(pr.id) })
    .from(pr)
    .innerJoin(p, eq(pr.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(and(eq(pr.active, true), eq(p.status, "LIVE")))
    .groupBy(pr.vendorId);
  return new Map(rows.map((r) => [r.vendorId, r]));
}

/* ---------------- Search, one row per route ---------------- */

/**
 * What this route pays Medcity, in rupees, as SQL.
 *
 * The same arithmetic as `routeCommission`, written for the database so a
 * search over 27,000 courses can be ordered by it without reading them all
 * into the application first. A route whose rate is not recorded, or whose
 * course has only a whole-course fee, comes out null and sorts last: an
 * unknown is not a zero, and it is not a maximum either.
 */
export function routeCommissionInr(rates: Record<string, number>): SQL {
  return sql`(case
    when ${pr.basis} = 'FLAT' and ${pr.flatAmount} is not null
      then ${pr.flatAmount} * ${rateOf(sql`coalesce(${pr.currency}, ${c.currency})`, rates)}
    when ${pr.basis} = 'PERCENT_TUITION' and ${pr.percentOfTuition} is not null and ${p.tuitionPerYear} is not null
      then ${p.tuitionPerYear} * ${pr.percentOfTuition} / 100 * ${rateOf(c.currency, rates)}
    else null end)`;
}

export type RouteSearchRow = Awaited<ReturnType<typeof routeSearchRows>>[number];

/**
 * The matches of a search, one row per road rather than one per course.
 *
 * A counsellor comparing two aggregators on the same course is comparing rows,
 * not hovering over chips, and the figures that differ between them, what the
 * route pays and how long their offers take, belong in columns of their own.
 * Courses with no route at all are not here: this view is about the roads, and
 * the vendor filter already has a "no route recorded" setting for the gaps.
 */
export async function routeSearchRows(
  where: SQL | undefined,
  opts: { rates: Record<string, number>; sort?: string; limit: number; offset: number; vendorIds?: string[] },
) {
  const money = routeCommissionInr(opts.rates);
  const tat = sql`coalesce(${pr.offerTatDays}, ${p.offerTatDays})`;
  const order =
    opts.sort === "commission"
      ? [sql`${money} desc nulls last`, asc(p.name)]
      : opts.sort === "tat"
        ? [sql`${tat} asc nulls last`, asc(p.name)]
        : opts.sort === "rank"
          ? [sql`${u.rankSort} asc nulls last`, asc(u.name), asc(p.name)]
          : opts.sort === "fee"
            ? [sql`${p.tuitionPerYear} is null`, asc(p.tuitionPerYear), sql`${p.tuitionTotal} is null`, asc(p.tuitionTotal), asc(p.name)]
            : opts.sort === "name"
              ? [asc(p.name), asc(u.name)]
              : [asc(c.name), asc(u.name), asc(p.name)];
  return db
    .select({
      programId: p.id,
      name: p.name,
      level: p.level,
      pathway: p.pathway,
      studyArea: p.studyArea,
      durationMonths: p.durationMonths,
      tuitionPerYear: p.tuitionPerYear,
      tuitionTotal: p.tuitionTotal,
      applicationFee: p.applicationFee,
      offerTatDays: p.offerTatDays,
      typicalScholarship: p.typicalScholarship,
      feeWaiver: p.feeWaiver,
      intakeMonths: p.intakeMonths,
      universityId: u.id,
      university: u.name,
      city: sql<string | null>`coalesce(${p.campus}, ${u.city})`,
      isPublic: u.isPublic,
      qsRank: u.qsRank,
      qsYear: u.qsYear,
      theRank: u.theRank,
      theYear: u.theYear,
      country: c.name,
      countryId: c.id,
      currency: c.currency,
      route: pr,
      vendorId: v.id,
      code: v.code,
      colour: v.colour,
      vendor: v.name,
      isDirect: v.isDirect,
      commissionInr: sql<number | null>`${money}`.mapWith(Number),
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .innerJoin(pr, eq(pr.programId, p.id))
    .innerJoin(v, eq(v.id, pr.vendorId))
    .where(and(where, eq(pr.active, true), eq(v.active, true), onlyVendors(opts.vendorIds)))
    // Ours first where nothing else was asked for. An explicit sort is obeyed,
    // because a control that does not do what it says is worse than no control;
    // the row carries "Our own agreement" in every order either way.
    .orderBy(...(opts.sort ? [] : [sql`${v.isDirect} desc`]), ...order)
    .limit(opts.limit)
    .offset(opts.offset);
}

/**
 * The route filter, applied to the roads themselves.
 *
 * In the programs view it keeps the courses a chosen vendor reaches; here it has
 * to keep the chosen vendor's own rows too, or filtering by KC would still list
 * every other road to the courses KC happens to reach.
 */
const onlyVendors = (vendorIds?: string[]) => {
  const ids = (vendorIds ?? []).filter((x) => x && x !== "none");
  return ids.length ? inArray(pr.vendorId, ids) : undefined;
};

/** How many roads the same filters reach, for the count beside the view. */
export async function routeSearchCount(where: SQL | undefined, vendorIds?: string[]) {
  const [row] = await db
    .select({ total: count(), courses: sql<number>`count(distinct ${p.id})`.mapWith(Number) })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .innerJoin(pr, eq(pr.programId, p.id))
    .innerJoin(v, eq(v.id, pr.vendorId))
    .where(and(where, eq(pr.active, true), eq(v.active, true), onlyVendors(vendorIds)));
  return row;
}
