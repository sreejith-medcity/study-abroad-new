import "server-only";
import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { orgScope } from "@/lib/permissions";
import { rate } from "@/lib/money";

export { rate };

const {
  applications: a,
  statusDefinitions: sd,
  programs: pr,
  universities: un,
  countries: co,
  organizations: og,
  users: us,
  enquiries: en,
  commissions: cm,
} = schema;

export type InsightFilters = { from?: string; to?: string; country?: string; pathway?: string; org?: string; year?: string };

export function readInsightFilters(sp: Record<string, string | string[] | undefined>): InsightFilters {
  const out: Record<string, string> = {};
  for (const k of ["from", "to", "country", "pathway", "org", "year"]) {
    const v = sp[k];
    const val = Array.isArray(v) ? v[0] : v;
    if (val) out[k] = val;
  }
  return out as InsightFilters;
}

/** Scope plus the report's own filters. Every query in this module uses it. */
function where(user: SessionUser, f: InsightFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [orgScope(user, a.orgId)];
  if (f.from) conds.push(gte(a.createdAt, new Date(f.from)));
  if (f.to) conds.push(lte(a.createdAt, new Date(`${f.to}T23:59:59`)));
  if (f.country) conds.push(eq(co.code, f.country));
  if (f.pathway) conds.push(eq(sd.pathway, f.pathway as schema.Pathway));
  if (f.org) conds.push(eq(a.orgId, f.org));
  if (f.year) conds.push(eq(a.intakeYear, Number(f.year)));
  return and(...conds.filter(Boolean));
}

function joined() {
  return db
    .select({
      total: sql<number>`count(*)::int`,
      offers: sql<number>`(count(*) filter (where ${sd.group} in ('OFFER','SUCCESS')))::int`,
      visas: sql<number>`(count(*) filter (where ${sd.code} in ('VISA_RECEIVED','ENROLLED','JOINED','DEPLOYED')))::int`,
      enrolled: sql<number>`(count(*) filter (where ${sd.code} in ('ENROLLED','JOINED','DEPLOYED')))::int`,
      closed: sql<number>`(count(*) filter (where ${sd.group} = 'CLOSED'))::int`,
      live: sql<number>`(count(*) filter (where ${sd.group} in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER')))::int`,
    })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .$dynamic();
}

export async function headline(user: SessionUser, f: InsightFilters) {
  const [row] = await joined().where(where(user, f));
  return row;
}

type Dimension = "country" | "pathway" | "partner" | "officer" | "university";

const DIMENSION_COLUMN = {
  country: co.name,
  pathway: sd.pathway,
  partner: og.name,
  officer: us.name,
  university: un.name,
} as const;

/** The same conversion columns, grouped by whichever dimension the user picked. */
export async function breakdown(user: SessionUser, f: InsightFilters, dim: Dimension) {
  const column = DIMENSION_COLUMN[dim];
  let q = db
    .select({
      label: sql<string>`coalesce(${column}::text, 'Unassigned')`,
      total: sql<number>`count(*)::int`,
      offers: sql<number>`(count(*) filter (where ${sd.group} in ('OFFER','SUCCESS')))::int`,
      visas: sql<number>`(count(*) filter (where ${sd.code} in ('VISA_RECEIVED','ENROLLED','JOINED','DEPLOYED')))::int`,
      closed: sql<number>`(count(*) filter (where ${sd.group} = 'CLOSED'))::int`,
      live: sql<number>`(count(*) filter (where ${sd.group} in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER')))::int`,
    })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .$dynamic();
  if (dim === "partner") q = q.innerJoin(og, eq(a.orgId, og.id));
  if (dim === "officer") q = q.leftJoin(us, eq(a.officerId, us.id));
  const rows = await q.where(where(user, f)).groupBy(sql`1`).orderBy(sql`2 desc`).limit(15);
  return rows.map((r) => ({
    label: r.label,
    total: Number(r.total),
    offers: Number(r.offers),
    visas: Number(r.visas),
    closed: Number(r.closed),
    live: Number(r.live),
  }));
}

/**
 * Median days from the application being created to its first offer and to a
 * visa, read from the status history rather than the current status.
 */
export async function speed(user: SessionUser, f: InsightFilters) {
  const [row] = await db
    .select({
      toOffer: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (
        (select min(sh2.created_at) from status_history sh2 join status_definitions sd2 on sd2.id = sh2.to_status_id
          where sh2.application_id = ${a.id} and sd2.group in ('OFFER','SUCCESS')) - ${a.createdAt})) / 86400)`,
      toVisa: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (
        (select min(sh2.created_at) from status_history sh2 join status_definitions sd2 on sd2.id = sh2.to_status_id
          where sh2.application_id = ${a.id} and sd2.code = 'VISA_RECEIVED') - ${a.createdAt})) / 86400)`,
      inStage: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from (now() - ${a.statusChangedAt})) / 86400)`,
    })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .where(where(user, f));
  return {
    toOffer: row?.toOffer === null || row?.toOffer === undefined ? null : Math.round(Number(row.toOffer)),
    toVisa: row?.toVisa === null || row?.toVisa === undefined ? null : Math.round(Number(row.toVisa)),
    inStage: row?.inStage === null || row?.inStage === undefined ? null : Math.round(Number(row.inStage)),
  };
}

/** Which enquiry sources actually turn into students. */
export async function enquiryEffectiveness(user: SessionUser) {
  const rows = await db
    .select({
      source: en.source,
      total: sql<number>`count(*)::int`,
      converted: sql<number>`(count(*) filter (where ${en.stage} = 'CONVERTED'))::int`,
      lost: sql<number>`(count(*) filter (where ${en.stage} = 'LOST'))::int`,
    })
    .from(en)
    .where(orgScope(user, en.orgId))
    .groupBy(en.source)
    .orderBy(sql`2 desc`);
  return rows.map((r) => ({ source: r.source, total: Number(r.total), converted: Number(r.converted), lost: Number(r.lost) }));
}

/** Intake spread: where the volume is going next. */
export async function intakeSpread(user: SessionUser, f: InsightFilters) {
  const rows = await db
    .select({
      month: a.intakeMonth,
      year: a.intakeYear,
      total: sql<number>`count(*)::int`,
    })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .where(where(user, f))
    .groupBy(a.intakeYear, a.intakeMonth)
    .orderBy(asc(a.intakeYear), asc(a.intakeMonth))
    .limit(12);
  return rows.map((r) => ({ month: r.month, year: r.year, total: Number(r.total) }));
}

/** Commission earned per destination, for the revenue view. */
export async function revenueByCountry(user: SessionUser, f: InsightFilters) {
  const rows = await db
    .select({
      label: co.name,
      placements: sql<number>`count(*)::int`,
      partnerInr: sql<number>`coalesce(sum(coalesce(${cm.partnerAmountInr}, 0)), 0)::int`,
    })
    .from(cm)
    .innerJoin(a, eq(cm.applicationId, a.id))
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .where(where(user, f))
    .groupBy(co.name)
    .orderBy(sql`3 desc`);
  return rows.map((r) => ({ label: r.label, placements: Number(r.placements), partnerInr: Number(r.partnerInr) }));
}

