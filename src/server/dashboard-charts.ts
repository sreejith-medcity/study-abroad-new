import "server-only";
import { and, count, desc, eq, gte, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { isStaff } from "@/lib/permissions";
import { MONTHS } from "@/lib/format";
import { lensApps, lensStudents, type Lens } from "./dashboard-lens";

/** The statuses that mean a visa is in hand, or the student has gone further. */
export const VISA_OR_LATER = ["VISA_RECEIVED", "ENROLLED", "JOINED", "DEPLOYED"] as const;
const ENROLLED = ["ENROLLED", "JOINED", "DEPLOYED"] as const;

const { applications: a, statusDefinitions: sd, statusHistory: sh, students: s, users: us, organizations: og, documents: dc, documentTypes: dt } = schema;

/**
 * The pictures under the dashboard's figures.
 *
 * The board on its own read as blank, so these are the same figures seen
 * over time and as a whole, plus what has just happened: a year month by
 * month, how far students get from registering to enrolling, where the
 * applications stand, how the branches compare, and the latest movement.
 *
 * Every query reads the same lens as the tiles: the desk sees the whole
 * portal or the one branch it picked, a branch or a sub-agent sees its own.
 */

/** Students registered and applications made, a month at a time, oldest first. */
export async function monthly(lens: Lens) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const key = (col: typeof s.createdAt | typeof a.createdAt) => sql<string>`to_char(date_trunc('month', ${col}), 'YYYY-MM')`;
  const [registered, applied] = await Promise.all([
    db
      .select({ month: key(s.createdAt), n: sql<number>`count(*)::int` })
      .from(s)
      .where(and(lensStudents(lens), eq(s.archived, false), gte(s.createdAt, from)))
      .groupBy(key(s.createdAt)),
    db
      .select({ month: key(a.createdAt), n: sql<number>`count(*)::int` })
      .from(a)
      .where(and(lensApps(lens), gte(a.createdAt, from)))
      .groupBy(key(a.createdAt)),
  ]);
  const reg = new Map(registered.map((r) => [r.month, Number(r.n)]));
  const app = new Map(applied.map((r) => [r.month, Number(r.n)]));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { key: k, label: MONTHS[d.getMonth()], year: d.getFullYear(), registrations: reg.get(k) ?? 0, applications: app.get(k) ?? 0 };
  });
}

/**
 * How far the students who registered in the period have got, step by step.
 * Counted in students so the steps compare (three applications are one
 * student who applied), and cumulatively: anybody past a step counts at it,
 * because a visa could not be had without an offer. That is what keeps the
 * shape a funnel.
 */
export async function journey(lens: Lens) {
  const cohort = and(lensStudents(lens), eq(s.archived, false), lens.from ? gte(s.createdAt, lens.from) : undefined);
  const reached = async (match: SQL) => {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${s.id})::int` })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      .where(and(cohort, match));
    return Number(row?.n ?? 0);
  };
  const [[registered], [applied], offer, visa, enrolled] = await Promise.all([
    db.select({ n: count() }).from(s).where(cohort),
    db.select({ n: sql<number>`count(distinct ${s.id})::int` }).from(a).innerJoin(s, eq(a.studentId, s.id)).where(cohort),
    reached(or(eq(sd.group, "OFFER"), inArray(sd.code, [...VISA_OR_LATER]))!),
    reached(inArray(sd.code, [...VISA_OR_LATER])),
    reached(inArray(sd.code, [...ENROLLED])),
  ]);
  return [
    { label: "Registered", value: Number(registered?.n ?? 0), href: "/students" },
    { label: "Applied", value: Number(applied?.n ?? 0), href: "/applications" },
    { label: "Offer", value: offer, href: "/applications?kpi=offers" },
    { label: "Visa", value: visa, href: "/applications?kpi=visa_received" },
    { label: "Enrolled", value: enrolled, href: "/applications?group=SUCCESS" },
  ];
}

/** Where every application stands now, in the order the work moves. */
export const STAGES = [
  { key: "NEW", label: "New", groups: ["NEW"] },
  { key: "PENDING_PARTNER", label: "Waiting on partner", groups: ["PENDING_PARTNER"] },
  { key: "IN_PROGRESS", label: "In progress", groups: ["IN_PROGRESS"] },
  { key: "OFFER", label: "Offer", groups: ["OFFER"] },
  { key: "SUCCESS", label: "Visa or done", groups: ["SUCCESS"] },
  { key: "PARKED", label: "On hold or closed", groups: ["HOLD", "CLOSED"] },
] as const;

export async function stages(lens: Lens) {
  const rows = await db
    .select({ group: sd.group, n: sql<number>`count(*)::int` })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(lensApps(lens))
    .groupBy(sd.group);
  const by = new Map(rows.map((r) => [r.group as string, Number(r.n)]));
  return STAGES.map((st) => ({
    key: st.key,
    label: st.label,
    value: st.groups.reduce((sum, g) => sum + (by.get(g) ?? 0), 0),
    href: st.key === "PARKED" ? "/applications?group=HOLD" : `/applications?group=${st.key}`,
  }));
}

/**
 * The branches and sub-agents side by side, for the desk: who registered
 * most in the period, how many applied, how many got a visa, and the share of
 * applications that turned into one. Only for somebody who sees more than one
 * branch, and left out when the desk has already narrowed to one.
 */
export async function branchesCompared(lens: Lens, limit = 8) {
  if (!isStaff(lens.user) || lens.org) return [];
  const inPeriod = (col: typeof s.createdAt | typeof a.createdAt | typeof sh.createdAt) => (lens.from ? gte(col, lens.from) : undefined);
  const [orgs, regs, apps, visas] = await Promise.all([
    db.select({ id: og.id, name: og.name, type: og.type }).from(og).where(and(inArray(og.type, ["BRANCH", "SUB_AGENT"]), eq(og.active, true))),
    db.select({ org: s.orgId, n: count() }).from(s).where(and(eq(s.archived, false), inPeriod(s.createdAt))).groupBy(s.orgId),
    db.select({ org: a.orgId, n: count() }).from(a).where(inPeriod(a.createdAt)).groupBy(a.orgId),
    db
      .select({ org: a.orgId, n: sql<number>`count(distinct ${a.id})::int` })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      .where(and(inArray(sd.code, [...VISA_OR_LATER]), inPeriod(sh.createdAt)))
      .groupBy(a.orgId),
  ]);
  const map = (rows: { org: string; n: number }[]) => new Map(rows.map((r) => [r.org, Number(r.n)]));
  const r = map(regs);
  const p = map(apps);
  const v = map(visas);
  return orgs
    .map((o) => ({ id: o.id, name: o.name, subAgent: o.type === "SUB_AGENT", registered: r.get(o.id) ?? 0, applied: p.get(o.id) ?? 0, visas: v.get(o.id) ?? 0 }))
    .filter((o) => o.registered + o.applied + o.visas > 0)
    .sort((x, y) => y.registered - x.registered || y.applied - x.applied)
    .slice(0, limit);
}

/**
 * Where students want to go, from what was written on their registration.
 * Free text, so it is grouped as typed, and a student who did not say is
 * counted as not recorded rather than left out.
 */
export async function destinations(lens: Lens, limit = 6) {
  const rows = await db
    .select({
      country: sql<string>`coalesce(nullif(trim(${s.preferredCountry}), ''), 'Not recorded')`,
      n: sql<number>`count(*)::int`,
    })
    .from(s)
    .where(and(lensStudents(lens), eq(s.archived, false), lens.from ? gte(s.createdAt, lens.from) : undefined))
    .groupBy(sql`1`)
    .orderBy(desc(sql`2`));
  const named = rows.filter((r) => r.country !== "Not recorded");
  const missing = rows.find((r) => r.country === "Not recorded");
  const top = named.slice(0, limit).map((r) => ({ label: r.country, value: Number(r.n) }));
  const rest = named.slice(limit).reduce((sum, r) => sum + Number(r.n), 0);
  if (rest > 0) top.push({ label: "Everywhere else", value: rest });
  return { rows: top, notRecorded: Number(missing?.n ?? 0) };
}

export type ActivityItem = {
  id: string;
  kind: "status" | "registered" | "document";
  at: Date;
  studentId: string;
  student: string;
  what: string;
  who: string | null;
  group?: string;
  /** How many documents came in together, when several are folded into one line. */
  count?: number;
};

/** The latest things that happened, whatever kind, newest first. */
export async function activity(lens: Lens, limit = 10): Promise<ActivityItem[]> {
  const fetch = limit * 3;
  const name = sql<string>`${s.firstName} || ' ' || ${s.lastName}`;
  const [moves, joined, uploads] = await Promise.all([
    db
      .select({ id: sh.id, at: sh.createdAt, studentId: s.id, student: name, what: sd.label, group: sd.group, who: us.name })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      .leftJoin(us, eq(sh.changedById, us.id))
      .where(lensApps(lens))
      .orderBy(desc(sh.createdAt))
      .limit(fetch),
    db
      .select({ id: s.id, at: s.createdAt, studentId: s.id, student: name, org: og.name })
      .from(s)
      .innerJoin(og, eq(s.orgId, og.id))
      .where(and(lensStudents(lens), eq(s.archived, false)))
      .orderBy(desc(s.createdAt))
      .limit(fetch),
    db
      .select({ id: dc.id, at: dc.createdAt, studentId: s.id, student: name, what: sql<string>`coalesce(${dc.label}, ${dt.label}, ${dc.fileName})`, who: us.name })
      .from(dc)
      .innerJoin(s, eq(dc.studentId, s.id))
      .leftJoin(dt, eq(dc.typeCode, dt.code))
      .leftJoin(us, eq(dc.uploadedById, us.id))
      .where(and(lensStudents(lens), isNotNull(dc.uploadedById)))
      .orderBy(desc(dc.createdAt))
      .limit(fetch),
  ]);

  const items: ActivityItem[] = [
    ...moves.map((m) => ({ id: `s-${m.id}`, kind: "status" as const, at: m.at, studentId: m.studentId, student: m.student, what: m.what, who: m.who, group: m.group })),
    ...joined.map((j) => ({ id: `r-${j.id}`, kind: "registered" as const, at: j.at, studentId: j.studentId, student: j.student, what: "Registered", who: j.org })),
    ...uploads.map((u) => ({ id: `d-${u.id}`, kind: "document" as const, at: u.at, studentId: u.studentId, student: u.student, what: u.what, who: u.who })),
  ];
  items.sort((x, y) => y.at.getTime() - x.at.getTime());

  // Six documents uploaded for one student in a sitting are one event to
  // whoever reads this, not six lines that push everything else off the end.
  const folded: ActivityItem[] = [];
  for (const it of items) {
    const last = folded[folded.length - 1];
    if (last && it.kind === "document" && last.kind === "document" && last.studentId === it.studentId) {
      last.count = (last.count ?? 1) + 1;
      continue;
    }
    folded.push({ ...it });
  }
  return folded.slice(0, limit);
}
