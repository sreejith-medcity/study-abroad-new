import "server-only";
import { DEADLINE_TYPES } from "@/lib/deadline-types";
import { and, asc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { notFound } from "next/navigation";
import { mayOpenStudent, ownStudentsOnly } from "@/server/scope";
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
  org?: string;
  pathway?: string;
  dlType?: string;
  dlFrom?: string;
  dlTo?: string;
  priority?: string;
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
  visa_received: sql`${sd.code} in ('VISA_RECEIVED','ENROLLED','JOINED','DEPLOYED')`,
  visa_rejected: sql`${sd.code} = 'VISA_REJECTED'`,
  non_enrolment: sql`${sd.code} = 'WITHDRAWN'`,
  deferrals: sql`${sd.code} = 'DEFERRED'`,
  pending_partner: sql`${sd.group} = 'PENDING_PARTNER'`,
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
  if (f.assignedTo) conds.push(eq(s.assignedToId, f.assignedTo));
  if (f.org && isStaff(user)) conds.push(eq(a.orgId, f.org));
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
    with: { assignedTo: true, org: true },
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
  if (!isStaff(user) && app.orgId !== user.orgId) notFound();
  // createdById included: whoever registered the student keeps their file.
  const student = await db.query.students.findFirst({ where: eq(s.id, app.studentId), columns: { id: true, orgId: true, assignedToId: true, createdById: true } });
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
    isStaff(user) ? (f.org ? eq(st.orgId, f.org) : undefined) : eq(st.orgId, user.orgId),
    await ownStudentsOnly(user),
    eq(st.archived, f.view === "archived"),
    f.assignedTo ? eq(st.assignedToId, f.assignedTo) : undefined,
    f.team ? eq(st.teamId, f.team) : undefined,
    f.from ? gte(st.createdAt, new Date(f.from)) : undefined,
    f.to ? lte(st.createdAt, new Date(`${f.to}T23:59:59`)) : undefined,
    f.country ? eq(st.preferredCountry, f.country) : undefined,
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
