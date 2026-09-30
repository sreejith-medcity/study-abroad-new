import "server-only";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { routeCommission, type ProgramMoney, type RouteCommission, type RouteLike } from "@/lib/vendors";

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

export type RouteChip = { vendorId: string; code: string; colour: string; name: string; active: boolean; commission: RouteCommission };

/**
 * The routes behind a list of courses, for rows in search and the finder. One
 * query for the page, not one per row.
 */
export async function routeChips(programs: { id: string; tuitionPerYear: number | null; tuitionTotal: number | null; applicationFee: number | null; offerTatDays: number | null; currency: string }[]) {
  const out = new Map<string, RouteChip[]>();
  if (!programs.length) return out;
  const rows = await db
    .select({ programId: pr.programId, route: pr, vendorId: v.id, code: v.code, colour: v.colour, name: v.name })
    .from(pr)
    .innerJoin(v, eq(pr.vendorId, v.id))
    .where(and(inArray(pr.programId, programs.map((x) => x.id)), eq(v.active, true)))
    .orderBy(asc(v.name));
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
