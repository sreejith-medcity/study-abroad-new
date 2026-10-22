import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { orgScope } from "@/lib/permissions";
import { moduleStanding, type ModuleState } from "@/lib/ausbildung";
import { nclexStanding, type NclexResult } from "@/lib/nclex";

const { nclexCases: nc, nclexSteps: ns } = schema;
const { students: s, countries: c, organizations: og, users: us, germanModules: gm, ausbildungProfiles: ap, incomeLines: il } = schema;

/*
 * Who this is about.
 *
 * Two kinds of student carry a service charge and a German record: everybody
 * going for Ausbildung, and anybody bound for a country Medcity has ticked as
 * one that collects a service charge. A student is on the first list if they
 * registered for Ausbildung or have an application on an Ausbildung course,
 * and on the second if the country they named or any country they applied to
 * is ticked. Read from the file every time, never stored, so ticking a
 * country in Settings changes the lists the moment it is saved.
 */

// The fragments below name "students" outright rather than through the
// column objects: in a select from one table the columns are written bare,
// and a bare "id" inside a subquery that joins applications is ambiguous.

/** Registered for Ausbildung, or applied to an Ausbildung course. */
export const isAusbildungSql = sql<boolean>`(
  "students"."preferred_pathway" = 'AUSBILDUNG'
  or exists (select 1 from applications xa join programs xp on xp.id = xa.program_id where xa.student_id = "students"."id" and xp.pathway = 'AUSBILDUNG')
)`;

/** On the NCLEX-RN (USA) process: a case has been opened for them. */
export const hasNclexCaseSql = sql<boolean>`exists (select 1 from nclex_cases xn where xn.student_id = "students"."id")`;

/**
 * A nursing student: registered for nursing, applied to a nursing course, or
 * already on the NCLEX-RN process. These are the files the NCLEX-RN steps are
 * offered on.
 */
export const isNursingSql = sql<boolean>`(
  "students"."preferred_pathway" = 'NURSING'
  or exists (select 1 from applications xa join programs xp on xp.id = xa.program_id where xa.student_id = "students"."id" and xp.pathway = 'NURSING')
  or exists (select 1 from nclex_cases xn where xn.student_id = "students"."id")
)`;

/** Named, or applied to, a country that collects a service charge. */
export const goesToChargingCountrySql = sql<boolean>`(
  exists (select 1 from countries xc where xc.collects_service_charge and lower(xc.name) = lower(trim("students"."preferred_country")))
  or exists (
    select 1 from applications xa
    join programs xp on xp.id = xa.program_id
    join universities xu on xu.id = xp.university_id
    join countries xc on xc.id = xu.country_id
    where xa.student_id = "students"."id" and xc.collects_service_charge
  )
)`;

/** Where this student is headed, in words: the countries they applied to, else the one they named. */
const destinationSql = sql<string | null>`coalesce(
  (select string_agg(distinct xc.name, ', ') from applications xa
    join programs xp on xp.id = xa.program_id
    join universities xu on xu.id = xp.university_id
    join countries xc on xc.id = xu.country_id
    where xa.student_id = "students"."id"),
  nullif(trim("students"."preferred_country"), '')
)`;

export type TrackerTab = "ausbildung" | "nclex" | "service";
export type TrackerShow = "all" | "interview" | "contract" | "german" | "unpaid";
export type TrackerFilters = { tab: TrackerTab; org?: string; counsellor?: string; q?: string; show?: TrackerShow };

export type ServiceCharge = {
  /** Per currency, what was raised (invoiced where it was, else expected) and what came in. */
  byCurrency: { currency: string; owed: number; received: number }[];
  /** Lines raised with no amount on them yet, which count towards nothing. */
  unpriced: number;
  /** Whether any line exists at all. */
  any: boolean;
};

const emptyCharge = (): ServiceCharge => ({ byCurrency: [], unpriced: 0, any: false });

/**
 * The service charge for each student, from their service-fee lines on the
 * Income tab, which is where a payment is recorded. Written-off and
 * not-applicable lines are left out: neither is owed.
 */
export async function serviceCharges(studentIds: string[]) {
  const out = new Map<string, ServiceCharge>();
  if (!studentIds.length) return out;
  const rows = await db
    .select({
      studentId: il.studentId,
      currency: il.currency,
      owed: sql<number>`coalesce(sum(coalesce(${il.invoicedAmount}, ${il.expectedAmount})), 0)::int`,
      received: sql<number>`coalesce(sum(${il.receivedAmount}), 0)::int`,
      unpriced: sql<number>`count(*) filter (where ${il.invoicedAmount} is null and ${il.expectedAmount} is null)::int`,
      lines: sql<number>`count(*)::int`,
    })
    .from(il)
    .where(and(inArray(il.studentId, studentIds), eq(il.kind, "SERVICE_FEE"), sql`${il.state} not in ('WRITTEN_OFF', 'NOT_APPLICABLE')`))
    .groupBy(il.studentId, il.currency);
  for (const r of rows) {
    const held = out.get(r.studentId) ?? emptyCharge();
    held.byCurrency.push({ currency: r.currency, owed: Number(r.owed), received: Number(r.received) });
    held.unpriced += Number(r.unpriced);
    held.any = held.any || Number(r.lines) > 0;
    out.set(r.studentId, held);
  }
  return out;
}

/** One row per student on the tracker. */
export async function trackerRows(user: SessionUser, f: TrackerFilters, limit = 300) {
  const conds: (SQL | undefined)[] = [
    orgScope(user, s.orgId),
    eq(s.archived, false),
    f.tab === "ausbildung"
      ? isAusbildungSql
      : f.tab === "nclex"
        ? isNursingSql
        : and(goesToChargingCountrySql, sql`not ${isAusbildungSql}`, sql`not ${hasNclexCaseSql}`),
  ];
  if (f.org) conds.push(eq(s.orgId, f.org));
  if (f.counsellor) conds.push(eq(s.assignedToId, f.counsellor));
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(s.firstName, like), ilike(s.lastName, like), ilike(sql`${s.firstName} || ' ' || ${s.lastName}`, like), ilike(s.medcityId, like), ilike(s.phone, like)));
  }
  if (f.show === "interview") conds.push(sql`${ap.interviewOn} >= now() - interval '1 day' and ${ap.contractReceivedOn} is null`);
  if (f.show === "contract") conds.push(sql`${ap.contractReceivedOn} is not null`);
  if (f.show === "german") conds.push(sql`(select count(*) from german_modules xg where xg.student_id = "students"."id" and xg.state = 'COMPLETED') < 4`);

  const rows = await db
    .select({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      medcityId: s.medcityId,
      registeredAt: s.createdAt,
      branch: og.name,
      counsellor: sql<string | null>`coalesce(${us.deskLabel}, ${us.name})`,
      destination: destinationSql,
      preference1: ap.preference1,
      preference2: ap.preference2,
      preference3: ap.preference3,
      applicationSubmittedOn: ap.applicationSubmittedOn,
      interviewOn: ap.interviewOn,
      interviewWith: ap.interviewWith,
      contractReceivedOn: ap.contractReceivedOn,
      contractEmployer: ap.contractEmployer,
      nclexOpened: nc.createdAt,
      boardState: nc.boardState,
      nclexResult: nc.result,
    })
    .from(s)
    .innerJoin(og, eq(s.orgId, og.id))
    .leftJoin(us, eq(s.assignedToId, us.id))
    .leftJoin(ap, eq(ap.studentId, s.id))
    .leftJoin(nc, eq(nc.studentId, s.id))
    .where(and(...conds))
    .orderBy(asc(ap.interviewOn), desc(s.createdAt))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  const [modules, charges, steps] = await Promise.all([
    ids.length ? db.select({ studentId: gm.studentId, level: gm.level, state: gm.state }).from(gm).where(inArray(gm.studentId, ids)) : Promise.resolve([]),
    serviceCharges(ids),
    ids.length && f.tab === "nclex"
      ? db.select({ studentId: ns.studentId, step: ns.step }).from(ns).where(and(inArray(ns.studentId, ids), eq(ns.completed, true)))
      : Promise.resolve([]),
  ]);
  const doneBy = new Map<string, Set<string>>();
  for (const st of steps) doneBy.set(st.studentId, (doneBy.get(st.studentId) ?? new Set()).add(st.step));
  const modulesBy = new Map<string, { level: string; state: ModuleState }[]>();
  for (const m of modules) modulesBy.set(m.studentId, [...(modulesBy.get(m.studentId) ?? []), { level: m.level, state: m.state }]);

  let out = rows.map((r) => ({
    ...r,
    german: moduleStanding(modulesBy.get(r.id) ?? []),
    charge: charges.get(r.id) ?? emptyCharge(),
    nclex: nclexStanding(doneBy.get(r.id) ?? new Set(), (r.nclexResult as NclexResult | null) ?? null),
  }));
  // Unpaid is read off the money, which is summed here rather than in SQL.
  if (f.show === "unpaid") out = out.filter((r) => !r.charge.any || r.charge.byCurrency.some((b) => b.received < b.owed) || r.charge.unpriced > 0);
  return out;
}

export type TrackerRow = Awaited<ReturnType<typeof trackerRows>>[number];

/** Everything the student's own Ausbildung tab shows. */
export async function studentAusbildung(studentId: string) {
  const [[flags], profile, modules, charges, lines] = await Promise.all([
    db
      .select({ ausbildung: isAusbildungSql, charging: goesToChargingCountrySql, nursing: isNursingSql, destination: destinationSql })
      .from(s)
      .where(eq(s.id, studentId)),
    db.query.ausbildungProfiles.findFirst({ where: eq(ap.studentId, studentId) }),
    db.select({ level: gm.level, state: gm.state, completedOn: gm.completedOn, note: gm.note }).from(gm).where(eq(gm.studentId, studentId)),
    serviceCharges([studentId]),
    db
      .select({ id: il.id, currency: il.currency, expected: il.expectedAmount, invoiced: il.invoicedAmount, received: il.receivedAmount, receivedOn: il.receivedOn, dueOn: il.dueOn, state: il.state, note: il.note })
      .from(il)
      .where(and(eq(il.studentId, studentId), eq(il.kind, "SERVICE_FEE")))
      .orderBy(asc(il.createdAt)),
  ]);
  const [nclexCase, nclexRows] = await Promise.all([
    db.query.nclexCases.findFirst({ where: eq(nc.studentId, studentId) }),
    db
      .select({ step: ns.step, completed: ns.completed, completedOn: ns.completedOn, documentId: ns.documentId, fileName: schema.documents.fileName })
      .from(ns)
      .leftJoin(schema.documents, eq(schema.documents.id, ns.documentId))
      .where(eq(ns.studentId, studentId)),
  ]);
  const done = new Set(nclexRows.filter((r) => r.completed).map((r) => r.step));
  return {
    isNursing: Boolean(flags?.nursing),
    nclexCase: nclexCase ?? null,
    nclexSteps: nclexRows,
    nclex: nclexStanding(done, (nclexCase?.result as NclexResult | null) ?? null),
    isAusbildung: Boolean(flags?.ausbildung),
    goesToChargingCountry: Boolean(flags?.charging),
    destination: flags?.destination ?? null,
    profile: profile ?? null,
    modules,
    german: moduleStanding(modules),
    charge: charges.get(studentId) ?? emptyCharge(),
    lines,
  };
}

/** Whether a student belongs on the tab at all: Ausbildung, nursing, or a charging country. */
export async function showsAusbildungTab(studentId: string) {
  const [row] = await db
    .select({ ausbildung: isAusbildungSql, charging: goesToChargingCountrySql, nursing: isNursingSql })
    .from(s)
    .where(eq(s.id, studentId));
  return { ausbildung: Boolean(row?.ausbildung), charging: Boolean(row?.charging), nursing: Boolean(row?.nursing) };
}

/** The branches and counsellors the tracker can be narrowed to, for this user. */
export async function trackerChoices(user: SessionUser) {
  const [orgs, people] = await Promise.all([
    db
      .select({ id: og.id, name: og.name })
      .from(og)
      .where(and(orgScope(user, og.id), sql`${og.type} <> 'HQ'`, eq(og.active, true)))
      .orderBy(asc(og.name)),
    db
      .select({ id: us.id, name: sql<string>`coalesce(${us.deskLabel}, ${us.name})` })
      .from(us)
      .where(and(orgScope(user, us.orgId), eq(us.active, true), sql`exists (select 1 from students xs where xs.assigned_to_id = "users"."id" and not xs.archived)`))
      .orderBy(asc(us.name)),
  ]);
  return { orgs, people };
}

/** The countries ticked as collecting a service charge, for saying so on screen. */
export async function chargingCountries() {
  return db.select({ id: c.id, name: c.name, serviceChargeInr: c.serviceChargeInr }).from(c).where(eq(c.collectsServiceCharge, true)).orderBy(asc(c.name));
}

