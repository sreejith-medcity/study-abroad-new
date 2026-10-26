import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { orgScope } from "@/lib/permissions";
import { ownStudentsOnly, ownedByPerson } from "@/server/scope";
import { AUSBILDUNG_CONTACT_AREA, AUSBILDUNG_STEPS, AUSBILDUNG_TEAM, MENTOR_PART, departmentOfStatus, moduleStanding, timedStatusCodes, type AusbildungDepartment, type ModuleState } from "@/lib/ausbildung";
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

/**
 * Where the student's Ausbildung application stands: the live one that moved
 * most recently, so a file with a closed first round and a live second reads
 * from the live one, and a finished placement (joined, deployed) gives way to
 * a round still being worked. Null where there is no Ausbildung application
 * yet, which the tracker says in words.
 */
const currentAusbildungStatus = <T>(column: "code" | "label" | "status_changed_at" | "id" | "handed_over_at") => sql<T>`(
  select ${sql.raw(column === "code" || column === "label" ? `xs.${column}` : `xa.${column}`)}
  from applications xa
  join programs xp on xp.id = xa.program_id
  join status_definitions xs on xs.id = xa.status_id
  where xa.student_id = "students"."id" and xp.pathway = 'AUSBILDUNG' and xs."group" <> 'CLOSED'
  order by (xs."group" = 'SUCCESS') asc, xa.status_changed_at desc
  limit 1
)`;

/**
 * Whether a status entered at a moment is over the guide's turnaround, as SQL,
 * so a list, a count and the daily follow-through can all ask the database
 * the one question. The tracker's cell says "over" once the whole days in the
 * status exceed the days allowed, which is the same as the status having been
 * entered at least tatDays + 1 days ago; written that way here so the cell and
 * the filter never disagree about a file. The day counts are constants from
 * the code, so they are written into the SQL rather than bound.
 */
export const overTurnaroundSql = (code: SQL | PgColumn, since: SQL | PgColumn) => {
  const timed = timedStatusCodes();
  if (!timed.length) return sql`false`;
  return sql`(${sql.join(
    timed.map((t) => sql`(${code} = ${t.code} and ${since} <= now() - make_interval(days => ${sql.raw(String(t.tatDays + 1))}))`),
    sql` or `,
  )})`;
};

/*
 * The documentation mentor named on the file: the person on the student's file
 * under the mentor's part. Read with the student rows, so the tracker says who
 * carries each file without a query per row. One mentor at a time: naming a
 * new one replaces the row, and the latest row is read in case two ever exist.
 * The person's own name, not their desk label: a desk label reads "Documentation",
 * and the guide's mentor is a person the counsellor can ring.
 */
const mentorSql = <T>(column: "name" | "user_id") => sql<T>`(
  select ${sql.raw(column === "name" ? "xu.name" : "xsp.user_id")}
  from student_people xsp
  join users xu on xu.id = xsp.user_id
  where xsp.student_id = "students"."id" and xsp.part = ${MENTOR_PART} and xu.active
  order by xsp.created_at desc
  limit 1
)`;

/** Whether the student's current Ausbildung application is over its step's turnaround. */
const currentAusbildungOver = sql<boolean>`coalesce((
  select ${overTurnaroundSql(sql`xs.code`, sql`xa.status_changed_at`)}
  from applications xa
  join programs xp on xp.id = xa.program_id
  join status_definitions xs on xs.id = xa.status_id
  where xa.student_id = "students"."id" and xp.pathway = 'AUSBILDUNG' and xs."group" <> 'CLOSED'
  order by (xs."group" = 'SUCCESS') asc, xa.status_changed_at desc
  limit 1
), false)`;

export type TrackerTab = "ausbildung" | "nclex" | "service";
export type TrackerShow = "all" | "interview" | "contract" | "german" | "unpaid" | "over";
export type TrackerFilters = {
  tab: TrackerTab;
  org?: string;
  /** The counsellor named on the file, which is the tracker's own picker. */
  counsellor?: string;
  /**
   * One person's own students, by the rule their students list applies
   * (registered by them, assigned to them, or worked by them). A dashboard's
   * placement figures link through this, so the list opened holds exactly
   * what the figure counted; the counsellor picker alone would drop the
   * students they registered and nobody has been given yet.
   */
  of?: string;
  q?: string;
  show?: TrackerShow;
  department?: AusbildungDepartment;
};

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
  // The tracker is a list of students, so it applies the students list's
  // rule about whose: a counsellor without "See every student" is shown
  // their own files here too, not the whole branch's.
  const conds: (SQL | undefined)[] = [
    orgScope(user, s.orgId),
    await ownStudentsOnly(user),
    eq(s.archived, false),
    f.tab === "ausbildung"
      ? isAusbildungSql
      : f.tab === "nclex"
        ? isNursingSql
        : and(goesToChargingCountrySql, sql`not ${isAusbildungSql}`, sql`not ${hasNclexCaseSql}`),
  ];
  if (f.org) conds.push(eq(s.orgId, f.org));
  if (f.counsellor) conds.push(eq(s.assignedToId, f.counsellor));
  if (f.of) conds.push(await ownedByPerson(f.of));
  if (f.q) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(s.firstName, like), ilike(s.lastName, like), ilike(sql`${s.firstName} || ' ' || ${s.lastName}`, like), ilike(s.medcityId, like), ilike(s.phone, like)));
  }
  if (f.show === "interview") conds.push(sql`${ap.interviewOn} >= now() - interval '1 day' and ${ap.contractReceivedOn} is null`);
  if (f.show === "contract") conds.push(sql`${ap.contractReceivedOn} is not null`);
  if (f.show === "german") conds.push(sql`(select count(*) from german_modules xg where xg.student_id = "students"."id" and xg.state = 'COMPLETED') < 4`);
  // Over turnaround is asked in SQL, with the same arithmetic as the cell, so
  // the limit below never cuts off a late file in favour of one that is fine.
  if (f.show === "over") conds.push(currentAusbildungOver);
  // A desk's files are the ones whose current status the guide puts with that
  // desk. The map lives in code, so the codes are listed here rather than
  // joined.
  if (f.department) {
    const codes = AUSBILDUNG_STEPS.filter((st) => st.department === f.department).flatMap((st) => st.statusCodes);
    conds.push(codes.length ? sql`${currentAusbildungStatus("code")} in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})` : sql`false`);
  }

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
      statusCode: currentAusbildungStatus<string | null>("code"),
      statusLabel: currentAusbildungStatus<string | null>("label"),
      // The driver hands a timestamp back as text, the way the other raw
      // fragments here are read, so it is made a Date below.
      statusSince: currentAusbildungStatus<string | Date | null>("status_changed_at"),
      handedOverAt: currentAusbildungStatus<string | Date | null>("handed_over_at"),
      mentor: mentorSql<string | null>("name"),
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
    statusSince: r.statusSince ? new Date(r.statusSince) : null,
    handedOverAt: r.handedOverAt ? new Date(r.handedOverAt) : null,
    department: departmentOfStatus(r.statusCode),
    german: moduleStanding(modulesBy.get(r.id) ?? []),
    charge: charges.get(r.id) ?? emptyCharge(),
    nclex: nclexStanding(doneBy.get(r.id) ?? new Set(), (r.nclexResult as NclexResult | null) ?? null),
  }));
  // Unpaid is read off the money, which is summed here rather than in SQL.
  if (f.show === "unpaid") out = out.filter((r) => !r.charge.any || r.charge.byCurrency.some((b) => b.received < b.owed) || r.charge.unpriced > 0);
  return out;
}

export type TrackerRow = Awaited<ReturnType<typeof trackerRows>>[number];

/**
 * How many of the Ausbildung files this person can see are past their step's
 * turnaround: the tile on the tracker and the line on the documentation desk's
 * dashboard. Counted with the same SQL the "Over turnaround" filter uses, so
 * the tile and the list it opens always agree.
 */
export async function overTurnaroundCount(user: SessionUser) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s)
    .where(and(orgScope(user, s.orgId), await ownStudentsOnly(user), eq(s.archived, false), isAusbildungSql, currentAusbildungOver));
  return Number(row?.n ?? 0);
}

/** Everything the student's own Ausbildung tab shows. */
export async function studentAusbildung(studentId: string) {
  const [[flags], profile, modules, charges, lines] = await Promise.all([
    db
      .select({
        ausbildung: isAusbildungSql,
        charging: goesToChargingCountrySql,
        nursing: isNursingSql,
        destination: destinationSql,
        statusCode: currentAusbildungStatus<string | null>("code"),
        statusLabel: currentAusbildungStatus<string | null>("label"),
        statusSince: currentAusbildungStatus<string | Date | null>("status_changed_at"),
        applicationId: currentAusbildungStatus<string | null>("id"),
        handedOverAt: currentAusbildungStatus<string | Date | null>("handed_over_at"),
        mentorId: mentorSql<string | null>("user_id"),
        mentorName: mentorSql<string | null>("name"),
      })
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
    /** The open Ausbildung application's status, for placing the file on the written process. */
    status: flags?.statusCode
      ? {
          code: flags.statusCode,
          label: flags.statusLabel ?? flags.statusCode,
          since: flags.statusSince ? new Date(flags.statusSince) : null,
          applicationId: flags.applicationId ?? null,
          /** When the branch handed the file to the documentation desk; null while it is still the branch's. */
          handedOverAt: flags.handedOverAt ? new Date(flags.handedOverAt) : null,
        }
      : null,
    /** The documentation mentor named on the file, or null while nobody is. */
    mentor: flags?.mentorId ? { id: flags.mentorId, name: flags.mentorName ?? "" } : null,
    profile: profile ?? null,
    modules,
    german: moduleStanding(modules),
    charge: charges.get(studentId) ?? emptyCharge(),
    lines,
  };
}

/**
 * The student's current Ausbildung application as a row, for the actions that
 * hand it over or move it: the same one the tab and the tracker read the status
 * off, chosen by the same rule, so a button on the tab acts on the file the
 * tab describes. Null where there is no open Ausbildung application.
 */
export async function currentAusbildungApplication(studentId: string) {
  const { applications: a, programs: pg, statusDefinitions: sd } = schema;
  const [row] = await db
    .select({
      id: a.id,
      orgId: a.orgId,
      statusId: a.statusId,
      statusCode: sd.code,
      statusLabel: sd.label,
      statusGroup: sd.group,
      handedOverAt: a.handedOverAt,
    })
    .from(a)
    .innerJoin(pg, eq(pg.id, a.programId))
    .innerJoin(sd, eq(sd.id, a.statusId))
    .where(and(eq(a.studentId, studentId), eq(pg.pathway, "AUSBILDUNG"), sql`${sd.group} <> 'CLOSED'`))
    .orderBy(sql`(${sd.group} = 'SUCCESS') asc`, desc(a.statusChangedAt))
    .limit(1);
  return row ?? null;
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

/**
 * The Ausbildung hand-over addresses on the Contacts list, where the team
 * edits them. While the list has no row for the area (a database the SQL has
 * not yet been run on), the guide's own addresses are shown instead.
 */
export async function ausbildungContacts() {
  const t = schema.teamContacts;
  const rows = await db
    .select({ id: t.id, name: t.name, title: t.title, email: t.email, phone: t.phone, level: t.level })
    .from(t)
    .where(and(eq(t.area, AUSBILDUNG_CONTACT_AREA), eq(t.active, true)))
    .orderBy(asc(t.level), asc(t.sortOrder), asc(t.name));
  if (rows.length) return { rows, fromList: true };
  return { rows: AUSBILDUNG_TEAM.map((c) => ({ id: c.email, name: c.name, title: c.title, email: c.email, phone: null, level: c.level })), fromList: false };
}

/** The countries ticked as collecting a service charge, for saying so on screen. */
export async function chargingCountries() {
  return db.select({ id: c.id, name: c.name, serviceChargeInr: c.serviceChargeInr }).from(c).where(eq(c.collectsServiceCharge, true)).orderBy(asc(c.name));
}

