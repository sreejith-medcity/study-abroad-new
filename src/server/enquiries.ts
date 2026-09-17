import "server-only";
import { and, asc, count, desc, eq, gte, ilike, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff, orgScope } from "@/lib/permissions";
import type { EnquirySource, EnquiryStage } from "@/db/schema";

const { enquiries: e, users: us, organizations: og } = schema;

export const STAGE_LABEL: Record<EnquiryStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  COUNSELLING: "In counselling",
  CONVERTED: "Converted",
  LOST: "Lost",
};

export const STAGE_TONE: Record<EnquiryStage, "neutral" | "info" | "warn" | "ok" | "bad" | "brand"> = {
  NEW: "neutral",
  CONTACTED: "info",
  QUALIFIED: "brand",
  COUNSELLING: "warn",
  CONVERTED: "ok",
  LOST: "bad",
};

/** Stages that still need a follow-up. */
export const OPEN_STAGES: EnquiryStage[] = ["NEW", "CONTACTED", "QUALIFIED", "COUNSELLING"];

export const SOURCE_LABEL: Record<EnquirySource, string> = {
  WALK_IN: "Walk in",
  PHONE: "Phone call",
  WHATSAPP: "WhatsApp",
  WEBSITE: "Website",
  REFERRAL: "Referral",
  EVENT: "Event or seminar",
  SOCIAL: "Social media",
  OTHER: "Other",
};

export type EnquiryFilters = {
  q?: string;
  stage?: string;
  source?: string;
  assignedTo?: string;
  org?: string;
  due?: string;
  country?: string;
  pathway?: string;
  page?: string;
};

export function readEnquiryFilters(sp: Record<string, string | string[] | undefined>): EnquiryFilters {
  const keys = ["q", "stage", "source", "assignedTo", "org", "due", "country", "pathway", "page"] as const;
  const out: Record<string, string> = {};
  for (const k of keys) {
    const raw = sp[k];
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v) out[k] = v;
  }
  return out as EnquiryFilters;
}

export function enquiryWhere(user: SessionUser, f: EnquiryFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [orgScope(user, e.orgId)];
  if (f.q) {
    const like = `%${f.q}%`;
    conds.push(or(ilike(e.name, like), ilike(e.phone, like), ilike(e.email, like), ilike(e.city, like)));
  }
  if (f.stage === "OPEN") conds.push(sql`${e.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')`);
  else if (f.stage) conds.push(eq(e.stage, f.stage as EnquiryStage));
  if (f.source) conds.push(eq(e.source, f.source as EnquirySource));
  if (f.assignedTo) conds.push(eq(e.assignedToId, f.assignedTo));
  if (f.org && isStaff(user)) conds.push(eq(e.orgId, f.org));
  if (f.country) conds.push(eq(e.interestCountry, f.country));
  if (f.pathway) conds.push(eq(e.interestPathway, f.pathway as schema.Pathway));
  if (f.due === "overdue") conds.push(and(isNotNull(e.nextFollowUpAt), lt(e.nextFollowUpAt, new Date()), sql`${e.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')`));
  if (f.due === "today") {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    conds.push(and(isNotNull(e.nextFollowUpAt), lte(e.nextFollowUpAt, end), sql`${e.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')`));
  }
  if (f.due === "none") conds.push(sql`${e.nextFollowUpAt} is null`);
  return and(...conds.filter(Boolean));
}

export function enquiryBase() {
  return db
    .select({
      id: e.id,
      name: e.name,
      phone: e.phone,
      email: e.email,
      city: e.city,
      source: e.source,
      stage: e.stage,
      interestCountry: e.interestCountry,
      interestPathway: e.interestPathway,
      intakeMonth: e.intakeMonth,
      intakeYear: e.intakeYear,
      nextFollowUpAt: e.nextFollowUpAt,
      lastContactedAt: e.lastContactedAt,
      createdAt: e.createdAt,
      studentId: e.studentId,
      assignedToId: e.assignedToId,
      assignedToName: us.name,
      orgId: e.orgId,
      orgName: og.name,
    })
    .from(e)
    .innerJoin(og, eq(e.orgId, og.id))
    .leftJoin(us, eq(e.assignedToId, us.id))
    .$dynamic();
}

/** Headline counts for the list page and the dashboards. */
export async function enquiryCounts(user: SessionUser, extra?: SQL) {
  // postgres-js will not bind a Date inside a raw fragment, so pass ISO text and cast.
  const now = new Date().toISOString();
  const endOfTodayDate = new Date();
  endOfTodayDate.setHours(23, 59, 59, 999);
  const endOfToday = endOfTodayDate.toISOString();
  const open = sql`${e.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')`;
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`(count(*) filter (where ${open}))::int`,
      overdue: sql<number>`(count(*) filter (where ${open} and ${e.nextFollowUpAt} < ${now}::timestamptz))::int`,
      dueToday: sql<number>`(count(*) filter (where ${open} and ${e.nextFollowUpAt} between ${now}::timestamptz and ${endOfToday}::timestamptz))::int`,
      unscheduled: sql<number>`(count(*) filter (where ${open} and ${e.nextFollowUpAt} is null))::int`,
      converted: sql<number>`(count(*) filter (where ${e.stage} = 'CONVERTED'))::int`,
      lost: sql<number>`(count(*) filter (where ${e.stage} = 'LOST'))::int`,
    })
    .from(e)
    .where(and(orgScope(user, e.orgId), extra));
  return row;
}

export async function stageCounts(user: SessionUser) {
  const rows = await db
    .select({ stage: e.stage, n: count() })
    .from(e)
    .where(orgScope(user, e.orgId))
    .groupBy(e.stage);
  const out = { NEW: 0, CONTACTED: 0, QUALIFIED: 0, COUNSELLING: 0, CONVERTED: 0, LOST: 0 } as Record<EnquiryStage, number>;
  for (const r of rows) out[r.stage] = Number(r.n);
  return out;
}

export async function sourceMix(user: SessionUser) {
  const rows = await db
    .select({ source: e.source, n: count() })
    .from(e)
    .where(orgScope(user, e.orgId))
    .groupBy(e.source)
    .orderBy(desc(count()));
  return rows.map((r) => ({ label: SOURCE_LABEL[r.source], value: Number(r.n), href: `/enquiries?source=${r.source}` }));
}

/** Enquiries this user should call next: theirs first, oldest follow-up first. */
export async function followUpQueue(user: SessionUser, limit = 6) {
  return enquiryBase()
    .where(
      and(
        orgScope(user, e.orgId),
        sql`${e.stage} in ('NEW','CONTACTED','QUALIFIED','COUNSELLING')`,
        isStaff(user) ? undefined : or(eq(e.assignedToId, user.id), sql`${e.assignedToId} is null`),
      ),
    )
    .orderBy(sql`${e.nextFollowUpAt} asc nulls last`, asc(e.createdAt))
    .limit(limit);
}

export async function getEnquiryForUser(user: SessionUser, id: string) {
  const row = await db.query.enquiries.findFirst({
    where: eq(e.id, id),
    with: { assignedTo: true, createdBy: true, org: true, student: true, notes: { with: { author: true } } },
  });
  if (!row) notFound();
  if (!isStaff(user) && row.orgId !== user.orgId) notFound();
  return row;
}

/** New enquiries per month, for the conversion chart. */
export async function enquiryTrend(user: SessionUser, months = 6) {
  const from = new Date();
  from.setMonth(from.getMonth() - (months - 1), 1);
  from.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      m: sql<string>`to_char(${e.createdAt}, 'YYYY-MM')`,
      total: sql<number>`count(*)::int`,
      converted: sql<number>`(count(*) filter (where ${e.stage} = 'CONVERTED'))::int`,
    })
    .from(e)
    .where(and(orgScope(user, e.orgId), gte(e.createdAt, from)))
    .groupBy(sql`1`);
  const map = new Map(rows.map((r) => [r.m, r]));
  const out: { label: string; a: number; b: number }[] = [];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const hit = map.get(key);
    out.push({ label: MONTHS[d.getMonth()], a: Number(hit?.total ?? 0), b: Number(hit?.converted ?? 0) });
  }
  return out;
}
