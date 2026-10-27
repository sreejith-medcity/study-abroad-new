import "server-only";
import { DEADLINE_TYPES } from "@/lib/deadline-types";
import { and, asc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { notFound } from "next/navigation";
import { mayOpenStudent, ownApplicationsOnly, ownStudentsOnly, ownedByPerson, studentOrgScope, unassignedFile } from "@/server/scope";
import { UNASSIGNED } from "@/lib/unassigned-files";
import { idSearchKey, looksLikeStudentId } from "@/lib/medcity-id";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { PARTNER_ROLES, STUDENT_WORK_ROLES, isStaff, orgScope } from "@/lib/permissions";

const { applications: a, students: s, programs: p, universities: u, countries: c, statusDefinitions: sd } = schema;

export type ApplicationFilters = {
  from?: string;
  to?: string;
  country?: string;
  intakeYear?: string;
  intakeMonth?: string;
  university?: string;
  status?: string; // status code
  group?: string; // status group
  kpi?: string;
  ack?: string;
  program?: string;
  student?: string;
  assignedTo?: string;
  /** One person's own files, as their own list shows them: what a counsellor's dashboard links carry. */
  of?: string;
  /** The officer carrying the file, or "none" for the files nobody has been given yet. */
  officer?: string;
  /** "unassigned": handed to the desk with no officer on it yet, the files a team leader hands out. */
  desk?: string;
  org?: string;
  pathway?: string;
  dlType?: string;
  dlFrom?: string;
  dlTo?: string;
  priority?: string;
  /** BRANCH or SUB_AGENT: whose files these are, for the dashboard's two waiting tiles. */
  orgType?: string;
  sort?: string;
};

export function readFilters(sp: Record<string, string | string[] | undefined>): ApplicationFilters {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) out[k] = val;
  }
  return out as ApplicationFilters;
}

/** KPI tiles on the dashboard and the list filters share these definitions. */
export const KPI_WHERE: Record<string, SQL> = {
  offers: sql`${sd.group} = 'OFFER'`,
  payments: sql`${a.feeStatus} = 'PAID'`,
  fees_due: sql`${a.feeStatus} = 'DUE'`,
  visa_received: sql`${sd.code} in ('VISA_RECEIVED','PRE_DEPARTURE','ENROLLED','JOINED','HAPPY_CALL','DEPLOYED')`,
  visa_rejected: sql`${sd.code} = 'VISA_REJECTED'`,
  non_enrolment: sql`${sd.code} = 'WITHDRAWN'`,
  deferrals: sql`${sd.code} = 'DEFERRED'`,
  pending_partner: sql`${sd.group} = 'PENDING_PARTNER'`,
  // Still being worked: what the desk's "who is carrying what" counts.
  open: sql`${sd.group} in ('NEW','PENDING_PARTNER','IN_PROGRESS','OFFER')`,
};

export function applicationWhere(user: SessionUser, f: ApplicationFilters, mine?: SQL): SQL | undefined {
  // `mine` narrows an organisation to the files one person is actually on. It is
  // passed in rather than read here because this is the one filter the exports
  // and the dashboards share, and it has to stay synchronous.
  const conds: (SQL | undefined)[] = [orgScope(user, a.orgId), mine];
  if (f.from) conds.push(gte(a.createdAt, new Date(f.from)));
  if (f.to) conds.push(lte(a.createdAt, new Date(`${f.to}T23:59:59`)));
  if (f.country) conds.push(eq(c.code, f.country));
  if (f.intakeYear) conds.push(eq(a.intakeYear, Number(f.intakeYear)));
  if (f.intakeMonth) conds.push(eq(a.intakeMonth, Number(f.intakeMonth)));
  if (f.university) conds.push(ilike(u.name, `%${f.university}%`));
  if (f.status) conds.push(eq(sd.code, f.status));
  if (f.group) conds.push(eq(sd.group, f.group as (typeof schema.statusGroup.enumValues)[number]));
  if (f.pathway) conds.push(eq(sd.pathway, f.pathway as (typeof schema.pathway.enumValues)[number]));
  if (f.kpi && KPI_WHERE[f.kpi]) conds.push(KPI_WHERE[f.kpi]);
  if (f.ack) conds.push(ilike(a.ackNo, `%${f.ack}%`));
  if (f.program) conds.push(ilike(p.name, `%${f.program}%`));
  if (f.student) conds.push(or(ilike(s.firstName, `%${f.student}%`), ilike(s.lastName, `%${f.student}%`), ilike(sql`${s.firstName} || ' ' || ${s.lastName}`, `%${f.student}%`)));
  // "none" is the students nobody has been given to yet, which a branch head hands out from.
  if (f.assignedTo) conds.push(f.assignedTo === "none" ? isNull(s.assignedToId) : eq(s.assignedToId, f.assignedTo));
  if (f.officer) conds.push(f.officer === "none" ? isNull(a.officerId) : eq(a.officerId, f.officer));
  // Only ever narrows: who may see these files at all is ownApplicationsOnly's question.
  if (f.desk === UNASSIGNED) conds.push(unassignedFile());
  if (f.org && isStaff(user)) conds.push(eq(a.orgId, f.org));
  // Our own branches, or the sub-agents working through them. Only the desk
  // can ask this, because it is the only one that sees both kinds.
  if (f.orgType && isStaff(user) && (schema.orgType.enumValues as readonly string[]).includes(f.orgType)) {
    conds.push(sql`exists (select 1 from organizations o where o.id = ${a.orgId} and o.type = ${f.orgType}::org_type)`);
  }
  if (f.priority && (schema.applicationPriority.enumValues as readonly string[]).includes(f.priority)) conds.push(eq(a.priority, f.priority as "HIGH"));
  // Applications with an open deadline of this type (or any type) in the date range.
  if (f.dlType || f.dlFrom || f.dlTo) {
    const typed = f.dlType && (DEADLINE_TYPES as readonly string[]).includes(f.dlType) ? sql` and ad.type = ${f.dlType}::deadline_type` : sql``;
    const from = f.dlFrom && /^\d{4}-\d{2}-\d{2}$/.test(f.dlFrom) ? sql` and ad.due_on >= ${f.dlFrom}::date` : sql``;
    const to = f.dlTo && /^\d{4}-\d{2}-\d{2}$/.test(f.dlTo) ? sql` and ad.due_on <= ${f.dlTo}::date` : sql``;
    conds.push(sql`exists (select 1 from application_deadlines ad where ad.application_id = ${a.id} and ad.done_at is null${typed}${from}${to})`);
  }
  return and(...conds);
}

/**
 * The `mine` an applications list passes to applicationWhere: the files this
 * person is on, and, when the list is asked for one named person's files, the
 * applications of that person's own students. Resolved here, once, because
 * applicationWhere itself has to stay synchronous for the exports.
 */
export async function applicationScope(user: SessionUser, f: ApplicationFilters): Promise<SQL | undefined> {
  return and(
    await ownApplicationsOnly(user),
    f.of ? inArray(a.studentId, db.select({ id: s.id }).from(s).where(await ownedByPerson(f.of))) : undefined,
  );
}

/** Base join used by lists, KPIs and exports. */
export function applicationsBase() {
  return db
    .select({
      id: a.id,
      ackNo: a.ackNo,
      createdAt: a.createdAt,
      intakeMonth: a.intakeMonth,
      intakeYear: a.intakeYear,
      deadline: a.deadline,
      statusChangedAt: a.statusChangedAt,
      nextDue: sql<string | null>`(select min(ad.due_on)::text from application_deadlines ad where ad.application_id = ${a.id} and ad.done_at is null and ad.due_on >= current_date)`,
      priority: a.priority,
      offerType: a.offerType,
      offerDate: a.offerDate,
      depositPaidOn: a.depositPaidOn,
      confirmationNumber: a.confirmationNumber,
      visaLodgedOn: a.visaLodgedOn,
      visaDecision: a.visaDecision,
      visaDecisionOn: a.visaDecisionOn,
      studentId: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      programName: p.name,
      universityName: u.name,
      countryName: c.name,
      statusLabel: sd.label,
      statusGroup: sd.group,
      statusCode: sd.code,
      pathway: sd.pathway,
      orgId: a.orgId,
      officerId: a.officerId,
      createdByName: sql<string>`creator.desk_label`.as("created_by_desk"),
      createdByFallback: sql<string>`creator.name`.as("created_by_name"),
      officerName: sql<string | null>`officer.name`.as("officer_name"),
      // What the desk calls them, which is what every control that offers the
      // list shows. The screen that reads a file back has to agree with it.
      officerLabel: sql<string | null>`coalesce(officer.desk_label, officer.name)`.as("officer_label"),
      officerPhone: sql<string | null>`officer.phone`.as("officer_phone"),
    })
    .from(a)
    .innerJoin(s, eq(a.studentId, s.id))
    .innerJoin(p, eq(a.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(sql`users as creator`, sql`creator.id = ${a.createdById}`)
    .leftJoin(sql`users as officer`, sql`officer.id = ${a.officerId}`);
}

/** Loads a student the user may see, or 404s. Partners only see their own organisation's students. */
export async function getStudentForUser(user: SessionUser, id: string) {
  const student = await db.query.students.findFirst({
    where: eq(s.id, id),
    with: { assignedTo: true, org: true, team: { columns: { id: true, name: true, active: true } } },
  });
  if (!student) notFound();
  // Not found rather than refused, so a counsellor cannot learn who exists at
  // their branch by trying ids.
  if (!(await mayOpenStudent(user, student))) notFound();
  return student;
}

export async function getApplicationForUser(user: SessionUser, id: string) {
  const app = await db.query.applications.findFirst({ where: eq(a.id, id) });
  if (!app) notFound();
  // createdById included: whoever registered the student keeps their file.
  const student = await db.query.students.findFirst({ where: eq(s.id, app.studentId), columns: { id: true, orgId: true, assignedToId: true, createdById: true } });
  // Another branch's application only where its student is, which for a
  // branch means a student on a team this person is in.
  if (!isStaff(user) && app.orgId !== user.orgId && app.orgId !== student?.orgId) notFound();
  if (!student || !(await mayOpenStudent(user, student))) notFound();
  return app;
}

export async function orgUsers(orgId: string) {
  return db
    .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), inArray(schema.users.role, [...PARTNER_ROLES]), eq(schema.users.active, true)));
}

/**
 * Who a student may be handed to, for the assignment control on the student
 * list.
 *
 * A branch can only hand a file to its own people, which is the rule that has
 * always applied. An admin can hand it to the head office as well, because the
 * documentation team and the Overseas desk are where a file actually goes once
 * the branch has done its part, and before this there was no way to say so:
 * the control was not even shown to them.
 *
 * Only roles that can work a student's file are offered. Assigning somebody who
 * can only read it would hand the file to a dead end.
 */
export async function assignableFor(orgIds: string[], opts: { includeHeadOffice: boolean }) {
  const u = schema.users;
  const o = schema.organizations;
  const where = opts.includeHeadOffice
    ? or(orgIds.length ? inArray(u.orgId, orgIds) : undefined, eq(o.type, "HQ"))
    : orgIds.length
      ? inArray(u.orgId, orgIds)
      : sql`false`;
  const rows = await db
    .select({ id: u.id, name: u.name, deskLabel: u.deskLabel, role: u.role, orgId: u.orgId, orgName: o.name, orgType: o.type })
    .from(u)
    .innerJoin(o, eq(o.id, u.orgId))
    .where(and(eq(u.active, true), inArray(u.role, [...STUDENT_WORK_ROLES]), where))
    .orderBy(asc(o.name), asc(u.name));
  return rows.map((r) => ({ ...r, headOffice: r.orgType === "HQ" }));
}

/**
 * The students a person may see, narrowed by the list's own filters.
 *
 * Lifted out of the list screen so a saved view can count exactly what the
 * list would show. Two copies of this rule would drift the day somebody adds
 * a filter to one of them.
 */
export async function studentWhere(user: SessionUser, f: Record<string, string | undefined>) {
  const st = schema.students;
  return and(
    // A branch sees its own students, and another branch's only where they
    // are on a team this person is in.
    isStaff(user) ? (f.org ? eq(st.orgId, f.org) : undefined) : studentOrgScope(user),
    await ownStudentsOnly(user),
    // One named person's own students, which is how a counsellor's dashboard
    // opens the list behind a figure when the plain list would show more.
    f.of ? await ownedByPerson(f.of) : undefined,
    eq(st.archived, f.view === "archived"),
    f.assignedTo === "none" ? isNull(st.assignedToId) : f.assignedTo ? eq(st.assignedToId, f.assignedTo) : undefined,
    f.team ? eq(st.teamId, f.team) : undefined,
    f.from ? gte(st.createdAt, new Date(f.from)) : undefined,
    f.to ? lte(st.createdAt, new Date(`${f.to}T23:59:59`)) : undefined,
    // The country the list shows: where their applications are for, or, for
    // a student with none yet, the country they said they would prefer. It
    // used to read the preference alone, so a student who preferred the UK
    // and applied to Germany was found under the UK and not under Germany.
    f.country
      ? sql`(exists (select 1 from applications fa join programs fp on fp.id = fa.program_id join universities fu on fu.id = fp.university_id join countries fc on fc.id = fu.country_id where fa.student_id = ${st.id} and fc.name = ${f.country})
          or (${st.preferredCountry} = ${f.country} and not exists (select 1 from applications fa where fa.student_id = ${st.id})))`
      : undefined,
    f.pathway ? eq(st.preferredPathway, f.pathway as schema.Pathway) : undefined,
    f.q
      ? or(
          ilike(sql`${st.firstName} || ' ' || ${st.lastName}`, `%${f.q}%`),
          ilike(st.email, `%${f.q}%`),
          ilike(st.phone, `%${f.q}%`),
          ...(looksLikeStudentId(f.q)
            ? [sql`regexp_replace(upper(coalesce(${st.medcityId}, '')), '[^A-Z0-9]', '', 'g') like ${`%${idSearchKey(f.q)}%`}`]
            : []),
        )
      : undefined,
  );
}

/**
 * What the students list shows about one page of students' applications: how
 * many, the first two programmes with their universities, and the countries
 * they are for. One grouped query for the page's ids, rather than one per row,
 * so fifty rows cost the same as one.
 *
 * Nothing here decides who may see what. The ids come from the list, which is
 * already bounded by the scope rules, and anybody who may see a student sees
 * every application of theirs (ownApplicationsOnly says the same).
 */
export async function studentListExtras(ids: string[]) {
  const out = new Map<string, { total: number; programmes: number; first: { programme: string; university: string }[]; countries: string[] }>();
  if (ids.length === 0) return out;
  // A student applied to the same programme for two intakes has one
  // programme, not two: the names are each programme once, in the order it
  // was first applied for, and so are the countries.
  const label = sql`json_build_object('programme', ${p.name}, 'university', ${u.name})::text`;
  const order = sql`order by ${a.createdAt}, ${a.id}`;
  const once = (value: SQL) => sql`array(select x.v from unnest(array_agg(${value} ${order})) with ordinality as x(v, n) group by x.v order by min(x.n))`;
  const rows = await db
    .select({
      studentId: a.studentId,
      total: sql<number>`count(*)::int`,
      programmes: sql<number>`count(distinct ${label})::int`,
      first: sql<string>`to_json((${once(label)})[1:2])::text`,
      countries: sql<string>`to_json(${once(sql`${c.name}`)})::text`,
    })
    .from(a)
    .innerJoin(p, eq(p.id, a.programId))
    .innerJoin(u, eq(u.id, p.universityId))
    .innerJoin(c, eq(c.id, u.countryId))
    .where(inArray(a.studentId, ids))
    .groupBy(a.studentId);
  for (const r of rows) {
    const first = (JSON.parse(r.first ?? "[]") as string[]).map((x) => JSON.parse(x) as { programme: string; university: string });
    out.set(r.studentId, { total: Number(r.total), programmes: Number(r.programmes), first, countries: JSON.parse(r.countries ?? "[]") as string[] });
  }
  return out;
}

/**
 * Who the students list's Counsellor filter offers: everybody holding a
 * student this person may see, and for a branch its own active people too,
 * so a counsellor who has nobody yet can still be picked and found empty.
 *
 * Asked of the same rule the list counts with, less the list's own narrowing
 * (search, dates, the counsellor chosen), so the choices do not vanish as the
 * filters are set. The Partner filter does narrow it: picking a branch offers
 * that branch's people. Only for somebody who sees every student of their
 * organisation; anybody else's list is their own files, and the page does not
 * show the filter to them.
 */
export async function counsellorOptions(user: SessionUser, f: Record<string, string | undefined>) {
  const st = schema.students;
  const usr = schema.users;
  const o = schema.organizations;
  const holding = await db
    .selectDistinct({ id: usr.id, name: usr.name, deskLabel: usr.deskLabel, orgName: o.name })
    .from(st)
    .innerJoin(usr, eq(usr.id, st.assignedToId))
    .innerJoin(o, eq(o.id, usr.orgId))
    .where(await studentWhere(user, { view: f.view, org: f.org, of: f.of }));
  const people = new Map(holding.map((h) => [h.id, h]));
  if (!isStaff(user)) for (const person of await orgUsers(user.orgId)) if (!people.has(person.id)) people.set(person.id, { ...person, orgName: "" });
  const staff = isStaff(user);
  return [...people.values()]
    .map((x) => ({ value: x.id, label: staff && x.orgName && !f.org ? `${x.deskLabel ?? x.name} (${x.orgName})` : (x.deskLabel ?? x.name) }))
    .sort((x, y) => x.label.localeCompare(y.label, "en-IN"));
}
