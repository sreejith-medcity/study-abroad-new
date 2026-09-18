import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { orgScope } from "@/lib/permissions";
import { MONTHS } from "@/lib/format";
import { KPI_WHERE } from "./queries";

const {
  applications: a,
  statusDefinitions: sd,
  statusHistory: sh,
  students: s,
  users: us,
  organizations: og,
  programs: p,
  universities: u,
  countries: c,
  comments: cm,
  documents: dc,
  auditLogs: al,
  outboundMessages: om,
} = schema;

/** Groups that still need someone to act. */
export const ACTIVE_GROUPS = ["NEW", "PENDING_PARTNER", "IN_PROGRESS", "OFFER"] as const;

/** Days a lane may sit untouched before it counts as late. Mirrors the work queue. */
export const SLA_DAYS: Record<string, number> = {
  NEW: 2,
  PENDING_PARTNER: 5,
  IN_PROGRESS: 7,
  OFFER: 10,
  HOLD: 60,
};

export const GROUP_LABEL: Record<string, string> = {
  NEW: "New / assessment",
  PENDING_PARTNER: "Pending from partner",
  IN_PROGRESS: "In progress",
  OFFER: "Offer / contract",
  SUCCESS: "Visa / done",
  HOLD: "On hold",
  CLOSED: "Closed",
};

/** Row scope for every dashboard query: partners see their own organisation only. */
function scope(user: SessionUser) {
  return orgScope(user, a.orgId);
}

function monthKeys(months: number) {
  const now = new Date();
  const keys: { key: string; label: string }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()] });
  }
  return keys;
}

export function monthsAgo(months: number) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
}

/** One count per status group, with zeros filled in. */
export async function groupCounts(user: SessionUser, extra?: SQL) {
  const rows = await db
    .select({ group: sd.group, n: count() })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(and(scope(user), extra))
    .groupBy(sd.group);
  const out: Record<string, number> = { NEW: 0, PENDING_PARTNER: 0, IN_PROGRESS: 0, OFFER: 0, SUCCESS: 0, HOLD: 0, CLOSED: 0 };
  for (const r of rows) out[r.group] = Number(r.n);
  return out;
}

/** Applications sitting past the lane's SLA, per group and in total. */
export async function lateWork(user: SessionUser) {
  const rows = await db
    .select({ group: sd.group, changedAt: a.statusChangedAt })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(and(scope(user), inArray(sd.group, [...ACTIVE_GROUPS])));
  const now = Date.now();
  const perGroup: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const days = (now - r.changedAt.getTime()) / 86400000;
    if (days > (SLA_DAYS[r.group] ?? 9999)) {
      perGroup[r.group] = (perGroup[r.group] ?? 0) + 1;
      total++;
    }
  }
  return { perGroup, total };
}

/** Applications created per month against visas granted per month. */
export async function monthlyPoints(user: SessionUser, months = 6) {
  const from = monthsAgo(months);
  const [created, visas] = await Promise.all([
    db
      .select({ m: sql<string>`to_char(${a.createdAt}, 'YYYY-MM')`, n: count() })
      .from(a)
      .where(and(scope(user), gte(a.createdAt, from)))
      .groupBy(sql`1`),
    db
      .select({ m: sql<string>`to_char(${sh.createdAt}, 'YYYY-MM')`, n: sql<number>`count(distinct ${sh.applicationId})::int` })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      .where(and(scope(user), gte(sh.createdAt, from), inArray(sd.code, ["VISA_RECEIVED", "ENROLLED", "JOINED", "DEPLOYED"])))
      .groupBy(sql`1`),
  ]);
  const createdBy = new Map(created.map((r) => [r.m, Number(r.n)]));
  const visasBy = new Map(visas.map((r) => [r.m, Number(r.n)]));
  return monthKeys(months).map(({ key, label }) => ({ label, a: createdBy.get(key) ?? 0, b: visasBy.get(key) ?? 0 }));
}

/** Registered to enrolled. Offers and visas count anything that ever reached the stage. */
export async function funnel(user: SessionUser) {
  const everReached = (match: SQL) =>
    db
      .select({ n: sql<number>`count(distinct ${sh.applicationId})::int` })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      .where(and(scope(user), match));

  const [[students], [apps], [offers], [fees], [visas], [enrolled]] = await Promise.all([
    db.select({ n: count() }).from(s).where(orgScope(user, s.orgId)),
    db.select({ n: count() }).from(a).where(scope(user)),
    everReached(eq(sd.group, "OFFER")),
    db.select({ n: count() }).from(a).where(and(scope(user), eq(a.feeStatus, "PAID"))),
    everReached(eq(sd.code, "VISA_RECEIVED")),
    everReached(inArray(sd.code, ["ENROLLED", "JOINED", "DEPLOYED"])),
  ]);
  return [
    { label: "Students registered", value: Number(students.n), href: "/students" },
    { label: "Applications created", value: Number(apps.n), href: "/applications" },
    { label: "Offers received", value: Number(offers.n), href: "/applications?group=OFFER" },
    { label: "Fees paid", value: Number(fees.n), href: "/applications?kpi=payments" },
    { label: "Visas received", value: Number(visas.n), href: "/applications?kpi=visa_received" },
    { label: "Enrolled or deployed", value: Number(enrolled.n), href: "/applications?group=SUCCESS" },
  ];
}

export async function kpiTotals(user: SessionUser, where?: SQL) {
  const selection = Object.fromEntries([
    ["all", sql<number>`count(*)::int`],
    ...Object.entries(KPI_WHERE).map(([k, cond]) => [k, sql<number>`(count(*) filter (where ${cond}))::int`]),
  ]) as Record<string, ReturnType<typeof sql<number>>>;
  const [row] = await db
    .select(selection)
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(s, eq(a.studentId, s.id))
    .where(and(scope(user), where));
  return row as Record<string, number>;
}

export async function deadlineList(user: SessionUser, days = 14, limit = 6, extra?: SQL) {
  const now = new Date();
  const until = new Date(Date.now() + days * 86400000);
  return db
    .select({
      id: a.id,
      ackNo: a.ackNo,
      deadline: a.deadline,
      studentId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      program: p.name,
      university: u.name,
    })
    .from(a)
    .innerJoin(s, eq(a.studentId, s.id))
    .innerJoin(p, eq(a.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .where(and(scope(user), isNotNull(a.deadline), gte(a.deadline, now), lte(a.deadline, until), extra))
    .orderBy(asc(a.deadline))
    .limit(limit);
}

export async function recentChanges(user: SessionUser, limit = 6, extra?: SQL) {
  return db
    .select({
      id: a.id,
      ackNo: a.ackNo,
      studentId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      statusLabel: sd.label,
      statusGroup: sd.group,
      changedAt: a.statusChangedAt,
      intakeMonth: a.intakeMonth,
      intakeYear: a.intakeYear,
      orgName: og.name,
    })
    .from(a)
    .innerJoin(s, eq(a.studentId, s.id))
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(og, eq(a.orgId, og.id))
    .where(and(scope(user), extra))
    .orderBy(desc(a.statusChangedAt))
    .limit(limit);
}

/** Active work that has not moved for the longest, oldest first. */
export async function agingList(user: SessionUser, limit = 8, extra?: SQL) {
  return db
    .select({
      id: a.id,
      ackNo: a.ackNo,
      studentId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      statusLabel: sd.label,
      statusGroup: sd.group,
      changedAt: a.statusChangedAt,
      orgName: og.name,
      officerName: us.name,
    })
    .from(a)
    .innerJoin(s, eq(a.studentId, s.id))
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(og, eq(a.orgId, og.id))
    .leftJoin(us, eq(a.officerId, us.id))
    .where(and(scope(user), inArray(sd.group, [...ACTIVE_GROUPS]), extra))
    .orderBy(asc(a.statusChangedAt))
    .limit(limit);
}

export async function countryMix(user: SessionUser, limit = 6) {
  const rows = await db
    .select({ label: c.name, code: c.code, n: count() })
    .from(a)
    .innerJoin(p, eq(a.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(scope(user))
    .groupBy(c.name, c.code)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => ({ label: r.label, value: Number(r.n), href: `/applications?country=${r.code}` }));
}

export async function pathwayMix(user: SessionUser) {
  const rows = await db
    .select({ label: sd.pathway, n: count() })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(scope(user))
    .groupBy(sd.pathway)
    .orderBy(desc(count()));
  const nice: Record<string, string> = { DEGREE: "Degree", AUSBILDUNG: "Ausbildung", NURSING: "Nurse registration" };
  return rows.map((r) => ({ label: nice[r.label] ?? r.label, value: Number(r.n), href: `/applications?pathway=${r.label}` }));
}

/** Per person inside one organisation: students, live applications, work waiting on them. */
export async function teamLoad(orgId: string) {
  const rows = await db
    .select({
      id: us.id,
      name: us.name,
      deskLabel: us.deskLabel,
      role: us.role,
      active: us.active,
      lastSignInAt: us.lastSignInAt,
      students: sql<number>`(select count(*) from students st where st.assigned_to_id = users.id and st.archived = false)::int`,
      live: sql<number>`(
        select count(*) from applications ap
        join students st on st.id = ap.student_id
        join status_definitions s2 on s2.id = ap.status_id
        where st.assigned_to_id = users.id and s2.group in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER')
      )::int`,
      waiting: sql<number>`(
        select count(*) from applications ap
        join students st on st.id = ap.student_id
        join status_definitions s2 on s2.id = ap.status_id
        where st.assigned_to_id = users.id and s2.group = 'PENDING_PARTNER'
      )::int`,
      won: sql<number>`(
        select count(*) from applications ap
        join students st on st.id = ap.student_id
        join status_definitions s2 on s2.id = ap.status_id
        where st.assigned_to_id = users.id and s2.group = 'SUCCESS'
      )::int`,
    })
    .from(us)
    .where(and(eq(us.orgId, orgId), inArray(us.role, ["PARTNER", "COUNSELLOR"])))
    .orderBy(asc(us.name));
  return rows.map((r) => ({ ...r, students: Number(r.students), live: Number(r.live), waiting: Number(r.waiting), won: Number(r.won) }));
}

/** Every partner organisation with its volume, for staff dashboards. */
export async function partnerLeaderboard(limit = 8) {
  const rows = await db
    .select({
      id: og.id,
      name: og.name,
      type: og.type,
      tier: og.tier,
      city: og.city,
      students: sql<number>`(select count(*) from students st where st.org_id = organizations.id and st.archived = false)::int`,
      live: sql<number>`(
        select count(*) from applications ap join status_definitions s2 on s2.id = ap.status_id
        where ap.org_id = organizations.id and s2.group in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER')
      )::int`,
      won: sql<number>`(
        select count(*) from applications ap join status_definitions s2 on s2.id = ap.status_id
        where ap.org_id = organizations.id and s2.group = 'SUCCESS'
      )::int`,
      total: sql<number>`(select count(*) from applications ap where ap.org_id = organizations.id)::int`,
    })
    .from(og)
    .where(ne(og.type, "HQ"))
    .orderBy(desc(sql`(select count(*) from applications ap where ap.org_id = organizations.id)`))
    .limit(limit);
  return rows.map((r) => ({ ...r, students: Number(r.students), live: Number(r.live), won: Number(r.won), total: Number(r.total) }));
}

/** What one counsellor or partner owner personally has to do next. */
export async function myWork(user: SessionUser) {
  const mine = eq(s.assignedToId, user.id);
  const [[students], [waiting], [live], unread, [docs], [orgDocs]] = await Promise.all([
    db.select({ n: count() }).from(s).where(and(orgScope(user, s.orgId), mine, eq(s.archived, false))),
    db
      .select({ n: count() })
      .from(a)
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(scope(user), mine, eq(sd.group, "PENDING_PARTNER"))),
    db
      .select({ n: count() })
      .from(a)
      .innerJoin(s, eq(a.studentId, s.id))
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(scope(user), mine, inArray(sd.group, [...ACTIVE_GROUPS]))),
    db
      .select({ id: cm.id, applicationId: cm.applicationId, body: cm.body, createdAt: cm.createdAt, authorLabel: cm.authorLabel, studentId: s.id, firstName: s.firstName, lastName: s.lastName })
      .from(cm)
      .innerJoin(a, eq(cm.applicationId, a.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .where(and(scope(user), isNull(cm.readAt), isNull(cm.authorId), eq(cm.channel, "STUDENT")))
      .orderBy(desc(cm.createdAt))
      .limit(5),
    db
      .select({ n: count() })
      .from(dc)
      .innerJoin(s, eq(dc.studentId, s.id))
      .where(and(orgScope(user, s.orgId), mine)),
    db
      .select({ n: count() })
      .from(dc)
      .innerJoin(s, eq(dc.studentId, s.id))
      .where(orgScope(user, s.orgId)),
  ]);
  return {
    students: Number(students.n),
    waiting: Number(waiting.n),
    live: Number(live.n),
    documents: Number(docs.n),
    orgDocuments: Number(orgDocs.n),
    replies: unread,
  };
}

/** Accounts, organisations and platform health for the super admin dashboard. */
export async function platformSnapshot() {
  const [roles, orgs, [flags], recentAudit, auditByAction, [messages]] = await Promise.all([
    db.select({ role: us.role, n: count() }).from(us).where(eq(us.active, true)).groupBy(us.role),
    db.select({ type: og.type, n: count() }).from(og).groupBy(og.type),
    db
      .select({
        inactive: sql<number>`(count(*) filter (where ${us.active} = false))::int`,
        // Switched-off accounts are nobody's problem, so they stay out of both
        // of these: the tiles are a to-do list, not a census.
        temporary: sql<number>`(count(*) filter (where ${us.mustChangePassword} = true and ${us.active} = true))::int`,
        neverSignedIn: sql<number>`(count(*) filter (where ${us.lastSignInAt} is null and ${us.active} = true))::int`,
        signedInWeek: sql<number>`(count(*) filter (where ${us.lastSignInAt} > now() - interval '7 days'))::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(us),
    db
      .select({
        id: al.id,
        action: al.action,
        entityType: al.entityType,
        entityId: al.entityId,
        createdAt: al.createdAt,
        actorName: us.name,
      })
      .from(al)
      .leftJoin(us, eq(al.actorId, us.id))
      .orderBy(desc(al.createdAt))
      .limit(8),
    db
      .select({ action: al.action, n: count() })
      .from(al)
      .where(gte(al.createdAt, new Date(Date.now() - 7 * 86400000)))
      .groupBy(al.action)
      .orderBy(desc(count()))
      .limit(6),
    db
      .select({
        queued: sql<number>`(count(*) filter (where ${om.status} = 'queued'))::int`,
        failed: sql<number>`(count(*) filter (where ${om.status} = 'error'))::int`,
        sent: sql<number>`(count(*) filter (where ${om.status} = 'sent'))::int`,
      })
      .from(om),
  ]);
  return {
    roles: Object.fromEntries(roles.map((r) => [r.role, Number(r.n)])) as Record<string, number>,
    orgs: Object.fromEntries(orgs.map((r) => [r.type, Number(r.n)])) as Record<string, number>,
    flags,
    recentAudit,
    auditByAction: auditByAction.map((r) => ({ action: r.action, value: Number(r.n) })),
    messages,
  };
}

/** Counts used by the admin desk: what is on my plate versus the team's. */
export async function officerLoad(user: SessionUser) {
  const [[mine], [unassigned], officers] = await Promise.all([
    db
      .select({ n: count() })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(eq(a.officerId, user.id), inArray(sd.group, [...ACTIVE_GROUPS]))),
    db
      .select({ n: count() })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(isNull(a.officerId), inArray(sd.group, [...ACTIVE_GROUPS]))),
    db
      .select({
        id: us.id,
        name: us.name,
        deskLabel: us.deskLabel,
        live: sql<number>`(
          select count(*) from applications ap join status_definitions s2 on s2.id = ap.status_id
          where ap.officer_id = users.id and s2.group in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER')
        )::int`,
      })
      .from(us)
      .where(and(inArray(us.role, ["SUPER_ADMIN", "ADMIN"]), eq(us.active, true)))
      .orderBy(asc(us.name)),
  ]);
  return {
    mine: Number(mine.n),
    unassigned: Number(unassigned.n),
    officers: officers.map((o) => ({ ...o, live: Number(o.live) })),
  };
}

/** New students and applications registered today, for the "since this morning" strip. */
export async function todayCounts(user: SessionUser) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [[students], [apps], [moves]] = await Promise.all([
    db.select({ n: count() }).from(s).where(and(orgScope(user, s.orgId), gte(s.createdAt, start))),
    db.select({ n: count() }).from(a).where(and(scope(user), gte(a.createdAt, start))),
    db.select({ n: count() }).from(sh).innerJoin(a, eq(sh.applicationId, a.id)).where(and(scope(user), gte(sh.createdAt, start))),
  ]);
  return { students: Number(students.n), applications: Number(apps.n), moves: Number(moves.n) };
}
