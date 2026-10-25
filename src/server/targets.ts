import "server-only";
import { and, asc, count, eq, gte, inArray, lt, min, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { ADMIN_ROLES, COUNSELLING_ROLES } from "@/lib/permissions";
import { monthBounds, shiftMonth, thisMonth } from "@/lib/month";
import type { Lens } from "./dashboard-lens";

const { targets: tg, students: s, applications: a, statusHistory: sh, statusDefinitions: sd, users: us, organizations: og } = schema;

/*
 * Monthly targets: registrations, applications and visas, for a branch and
 * for each person in it, set against what actually happened that month.
 *
 * What counts is the same as the dashboards count: a branch's registrations
 * are the students registered into it that month, its applications the ones
 * made that month, and its visas the files that first reached a visa that
 * month. A person's are the same for the students assigned to them.
 */

export const METRICS = [
  { key: "REGISTRATIONS", label: "Registrations" },
  { key: "APPLICATIONS", label: "Applications" },
  { key: "VISAS", label: "Visas" },
] as const;
export type Metric = (typeof METRICS)[number]["key"];
export type Numbers = Record<Metric, number>;
const zero = (): Numbers => ({ REGISTRATIONS: 0, APPLICATIONS: 0, VISAS: 0 });

/*
 * The month helpers live in src/lib/month.ts so the day end figures and the
 * suites can share them; they are re-exported here for the screens that
 * already import them from the targets.
 */
export { isMonth, monthText, shiftMonth, thisMonth } from "@/lib/month";
/** The month's first and last instants, in India time. */
const bounds = monthBounds;

const VISA = ["VISA_RECEIVED", "PRE_DEPARTURE", "ENROLLED", "JOINED", "HAPPY_CALL", "DEPLOYED"];

/** What actually happened in the month, per branch. */
export async function branchActuals(orgIds: string[], month: string) {
  const out = new Map<string, Numbers>(orgIds.map((id) => [id, zero()]));
  if (!orgIds.length) return out;
  const { from, to } = bounds(month);
  const firstVisa = db
    .select({ app: sh.applicationId, at: min(sh.createdAt).as("at") })
    .from(sh)
    .innerJoin(sd, eq(sh.toStatusId, sd.id))
    .where(inArray(sd.code, VISA))
    .groupBy(sh.applicationId)
    .as("first_visa");
  const [regs, apps, visas] = await Promise.all([
    db.select({ k: s.orgId, n: count() }).from(s).where(and(inArray(s.orgId, orgIds), eq(s.archived, false), gte(s.createdAt, from), lt(s.createdAt, to))).groupBy(s.orgId),
    db.select({ k: a.orgId, n: count() }).from(a).where(and(inArray(a.orgId, orgIds), gte(a.createdAt, from), lt(a.createdAt, to))).groupBy(a.orgId),
    db
      .select({ k: a.orgId, n: count() })
      .from(firstVisa)
      .innerJoin(a, eq(firstVisa.app, a.id))
      .where(and(inArray(a.orgId, orgIds), sql`${firstVisa.at} >= ${from.toISOString()}::timestamptz`, sql`${firstVisa.at} < ${to.toISOString()}::timestamptz`))
      .groupBy(a.orgId),
  ]);
  for (const r of regs) out.get(r.k)!.REGISTRATIONS = Number(r.n);
  for (const r of apps) out.get(r.k)!.APPLICATIONS = Number(r.n);
  for (const r of visas) out.get(r.k)!.VISAS = Number(r.n);
  return out;
}

/** What actually happened in the month, per person, for the students assigned to them. */
export async function personActuals(userIds: string[], month: string) {
  const out = new Map<string, Numbers>(userIds.map((id) => [id, zero()]));
  if (!userIds.length) return out;
  const { from, to } = bounds(month);
  const firstVisa = db
    .select({ app: sh.applicationId, at: min(sh.createdAt).as("at") })
    .from(sh)
    .innerJoin(sd, eq(sh.toStatusId, sd.id))
    .where(inArray(sd.code, VISA))
    .groupBy(sh.applicationId)
    .as("first_visa");
  const [regs, apps, visas] = await Promise.all([
    db.select({ k: s.assignedToId, n: count() }).from(s).where(and(inArray(s.assignedToId, userIds), eq(s.archived, false), gte(s.createdAt, from), lt(s.createdAt, to))).groupBy(s.assignedToId),
    db
      .select({ k: s.assignedToId, n: count() })
      .from(a)
      .innerJoin(s, eq(a.studentId, s.id))
      .where(and(inArray(s.assignedToId, userIds), gte(a.createdAt, from), lt(a.createdAt, to)))
      .groupBy(s.assignedToId),
    db
      .select({ k: s.assignedToId, n: count() })
      .from(firstVisa)
      .innerJoin(a, eq(firstVisa.app, a.id))
      .innerJoin(s, eq(a.studentId, s.id))
      .where(and(inArray(s.assignedToId, userIds), sql`${firstVisa.at} >= ${from.toISOString()}::timestamptz`, sql`${firstVisa.at} < ${to.toISOString()}::timestamptz`))
      .groupBy(s.assignedToId),
  ]);
  for (const r of regs) if (r.k) out.get(r.k)!.REGISTRATIONS = Number(r.n);
  for (const r of apps) if (r.k) out.get(r.k)!.APPLICATIONS = Number(r.n);
  for (const r of visas) if (r.k) out.get(r.k)!.VISAS = Number(r.n);
  return out;
}

/** The targets set for these subjects in a month; a metric with no target is absent. */
export async function targetsFor(subjects: string[], month: string) {
  const out = new Map<string, Partial<Numbers>>();
  if (!subjects.length) return out;
  const rows = await db.select({ subject: tg.subject, metric: tg.metric, value: tg.value }).from(tg).where(and(inArray(tg.subject, subjects), eq(tg.month, month)));
  for (const r of rows) out.set(r.subject, { ...(out.get(r.subject) ?? {}), [r.metric]: r.value });
  return out;
}

export const orgSubject = (id: string) => `org:${id}`;
export const userSubject = (id: string) => `user:${id}`;

/** The branches and sub-agents the desk sets targets for. */
export async function targetBranches() {
  return db
    .select({ id: og.id, name: og.name, type: og.type })
    .from(og)
    .where(and(inArray(og.type, ["BRANCH", "SUB_AGENT"]), eq(og.active, true)))
    .orderBy(asc(og.type), asc(og.name));
}

/** The people in one branch who carry students, for their branch head's targets. */
export async function targetPeople(orgId: string) {
  return db
    .select({ id: us.id, name: us.name, role: us.role })
    .from(us)
    .where(and(eq(us.orgId, orgId), eq(us.active, true), inArray(us.role, ["PARTNER", ...COUNSELLING_ROLES.filter((r) => r !== "DESK_COUNSELLOR")])))
    .orderBy(asc(us.name));
}

/** Who may set what: the desk any branch's and anybody's, a branch head their own people's. */
export const setsBranchTargets = (user: SessionUser) => (ADMIN_ROLES as readonly string[]).includes(user.role);
export const setsPeopleTargets = (user: SessionUser) => setsBranchTargets(user) || user.role === "PARTNER";

/**
 * Save a month's targets in one go. Each entry is a subject, a metric and a
 * number; an empty box clears that target. Anything the person may not set is
 * refused as a whole rather than half saved.
 */
export async function saveTargets(user: SessionUser, month: string, entries: { subject: string; metric: Metric; value: number | null }[]) {
  const orgIds = [...new Set(entries.filter((e) => e.subject.startsWith("org:")).map((e) => e.subject.slice(4)))];
  const userIds = [...new Set(entries.filter((e) => e.subject.startsWith("user:")).map((e) => e.subject.slice(5)))];
  if (orgIds.length && !setsBranchTargets(user)) return { ok: false as const, error: "Only the Overseas desk sets a branch's targets." };
  if (userIds.length) {
    if (!setsPeopleTargets(user)) return { ok: false as const, error: "Only a branch head or the Overseas desk sets people's targets." };
    if (!setsBranchTargets(user)) {
      const theirs = await db.select({ id: us.id }).from(us).where(and(inArray(us.id, userIds), eq(us.orgId, user.orgId)));
      if (theirs.length !== userIds.length) return { ok: false as const, error: "You can only set targets for your own branch's people." };
    }
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const e of entries) {
      const owner = e.subject.startsWith("org:") ? { orgId: e.subject.slice(4), userId: null } : { orgId: null, userId: e.subject.slice(5) };
      if (e.value == null) {
        await tx.delete(tg).where(and(eq(tg.subject, e.subject), eq(tg.month, month), eq(tg.metric, e.metric)));
      } else {
        await tx
          .insert(tg)
          .values({ subject: e.subject, ...owner, month, metric: e.metric, value: e.value, setById: user.id, updatedAt: now })
          .onConflictDoUpdate({ target: [tg.subject, tg.month, tg.metric], set: { value: e.value, setById: user.id, updatedAt: now } });
      }
    }
  });
  return { ok: true as const };
}

/** Copy last month's targets into this one, leaving anything already set this month alone. */
export async function copyLastMonth(user: SessionUser, month: string, subjects: string[]) {
  const last = await targetsFor(subjects, shiftMonth(month, -1));
  const now = await targetsFor(subjects, month);
  const entries: { subject: string; metric: Metric; value: number | null }[] = [];
  for (const [subject, values] of last) {
    for (const [metric, value] of Object.entries(values) as [Metric, number][]) {
      if (now.get(subject)?.[metric] == null) entries.push({ subject, metric, value });
    }
  }
  if (!entries.length) return { ok: true as const, copied: 0 };
  const saved = await saveTargets(user, month, entries);
  return saved.ok ? { ok: true as const, copied: entries.length } : saved;
}

export type Progress = { metric: Metric; label: string; actual: number; target: number | null };
export function progress(actual: Numbers, target: Partial<Numbers> | undefined): Progress[] {
  return METRICS.map((m) => ({ metric: m.key, label: m.label, actual: actual[m.key], target: target?.[m.key] ?? null }));
}

/** How far into the month we are, so a bar can say whether it is on pace. */
export function monthElapsed(month: string, now = new Date()) {
  const { from, to } = bounds(month);
  if (now <= from) return 0;
  if (now >= to) return 1;
  return (now.getTime() - from.getTime()) / (to.getTime() - from.getTime());
}


/**
 * The targets card for a dashboard, by what the dashboard is looking at.
 * Leadership: every branch with a target this month, or the one picked. A
 * branch: its own, and each of its people's. A counsellor: their own. Null
 * where there is nothing to set against, such as somebody at the desk viewing
 * as a branch without picking one.
 */
export async function targetCard(lens: Lens) {
  const month = thisMonth();
  if (lens.kind === "leadership") {
    const branches = (await targetBranches()).filter((b) => !lens.org || b.id === lens.org);
    const set = await targetsFor(branches.map((b) => orgSubject(b.id)), month);
    const withTargets = branches.filter((b) => set.has(orgSubject(b.id)));
    const actual = await branchActuals(withTargets.map((b) => b.id), month);
    return { month, kind: "branches" as const, rows: withTargets.map((b) => ({ id: b.id, name: b.name, progress: progress(actual.get(b.id)!, set.get(orgSubject(b.id))) })) };
  }
  if (lens.kind === "branch") {
    const orgId = lens.viewingAs ? lens.org : lens.user.orgId;
    if (!orgId) return null;
    const people = await targetPeople(orgId);
    const [own, theirs, ownActual, peopleActual] = await Promise.all([
      targetsFor([orgSubject(orgId)], month),
      targetsFor(people.map((p) => userSubject(p.id)), month),
      branchActuals([orgId], month),
      personActuals(people.map((p) => p.id), month),
    ]);
    return {
      month,
      kind: "branch" as const,
      own: progress(ownActual.get(orgId)!, own.get(orgSubject(orgId))),
      rows: people.filter((p) => theirs.has(userSubject(p.id))).map((p) => ({ id: p.id, name: p.name, progress: progress(peopleActual.get(p.id)!, theirs.get(userSubject(p.id))) })),
    };
  }
  if (lens.kind === "counsellor" && lens.person) {
    const [set, actual] = await Promise.all([targetsFor([userSubject(lens.person.id)], month), personActuals([lens.person.id], month)]);
    return { month, kind: "person" as const, own: progress(actual.get(lens.person.id)!, set.get(userSubject(lens.person.id))), rows: [] };
  }
  return null;
}
