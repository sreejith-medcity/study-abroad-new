import "server-only";
import { and, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff, orgScope } from "@/lib/permissions";

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

export function applicationWhere(user: SessionUser, f: ApplicationFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [orgScope(user, a.orgId)];
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
      createdByName: sql<string>`creator.desk_label`.as("created_by_desk"),
      createdByFallback: sql<string>`creator.name`.as("created_by_name"),
      officerName: sql<string | null>`officer.name`.as("officer_name"),
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
  if (!isStaff(user) && student.orgId !== user.orgId) notFound();
  return student;
}

export async function getApplicationForUser(user: SessionUser, id: string) {
  const app = await db.query.applications.findFirst({ where: eq(a.id, id) });
  if (!app) notFound();
  if (!isStaff(user) && app.orgId !== user.orgId) notFound();
  return app;
}

export async function orgUsers(orgId: string) {
  return db
    .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), inArray(schema.users.role, ["PARTNER", "COUNSELLOR"]), eq(schema.users.active, true)));
}
