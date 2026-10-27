import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { STAFF_ROLES, STUDENT_WORK_ROLES, isStaff } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import { orgUsers } from "@/server/queries";
import type { ServiceType } from "@/lib/services";

/** Every team with its people, for the screen that runs them. */
export async function teamsWithMembers() {
  const teams = await db.query.teams.findMany({
    with: {
      members: {
        with: {
          user: {
            columns: { id: true, name: true, email: true, role: true, deskLabel: true, active: true },
            with: { org: { columns: { name: true, type: true } } },
          },
        },
      },
      pathways: { columns: { pathway: true } },
    },
    orderBy: [sql`${schema.teams.active} desc`, asc(schema.teams.name)],
  });
  const counts = await db
    .select({ teamId: schema.students.teamId, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .where(and(sql`${schema.students.teamId} is not null`, eq(schema.students.archived, false)))
    .groupBy(schema.students.teamId);
  const carrying = new Map(counts.map((c) => [c.teamId, Number(c.n)]));
  return teams.map((t) => ({ ...t, students: carrying.get(t.id) ?? 0 }));
}

/** The teams a file can be put on: the live ones, shortest answer first. */
export async function livingTeams() {
  return db
    .select({ id: schema.teams.id, name: schema.teams.name })
    .from(schema.teams)
    .where(eq(schema.teams.active, true))
    .orderBy(asc(schema.teams.name));
}

/**
 * Every live team with the members who can work a file, for the head
 * office's "Assigned to" dropdown, in two queries for the whole page.
 */
export async function teamsToAssign() {
  const teams = await livingTeams();
  if (!teams.length) return [];
  const members = await db
    .select({ teamId: schema.teamMembers.teamId, id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .where(and(inArray(schema.teamMembers.teamId, teams.map((t) => t.id)), eq(schema.users.active, true), inArray(schema.users.role, [...STUDENT_WORK_ROLES])))
    .orderBy(asc(schema.users.name));
  return teams.map((t) => ({ ...t, members: members.filter((m) => m.teamId === t.id).map(({ id, name, deskLabel }) => ({ id, name, deskLabel })) }));
}

/** Everybody at the desk who can be put in a team or on a file. */
export async function deskPeople() {
  return db
    .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel, role: schema.users.role })
    .from(schema.users)
    .where(and(inArray(schema.users.role, [...STAFF_ROLES]), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.name));
}

/**
 * Who this person may put on a file, for the picker that does it.
 *
 * A branch sees its own people: two counsellors sharing a student is the
 * ordinary case this was missing, and until now only the head office could
 * record it. The head office sees the desk, as before.
 */
export async function peopleToAdd(user: SessionUser) {
  if (isStaff(user)) return deskPeople();
  return (await orgUsers(user.orgId)).map((p) => ({ ...p, role: "" }));
}

/**
 * Everybody who can be put in a team: the desk, and the branches' own people.
 *
 * A team carries its files across branches, so the people who work them can
 * sit anywhere: the Ausbildung team is the head office's Ausbildung desk and
 * the Kottayam counsellors who have always done Ausbildung. Sub-agents are
 * left out: a team member opens every file the team carries, and a
 * sub-agent's people are not Medcity's.
 */
export async function teamCandidates() {
  const u = schema.users;
  const o = schema.organizations;
  const rows = await db
    .select({ id: u.id, name: u.name, deskLabel: u.deskLabel, role: u.role, orgName: o.name, orgType: o.type })
    .from(u)
    .innerJoin(o, eq(o.id, u.orgId))
    .where(and(eq(u.active, true), inArray(u.role, [...STUDENT_WORK_ROLES]), inArray(o.type, ["HQ", "BRANCH"])))
    .orderBy(sql`${o.type} = 'HQ' desc`, asc(o.name), asc(u.name));
  return rows.map((r) => ({ ...r, headOffice: r.orgType === "HQ" }));
}

/** The teams this person is in, live ones only: what a branch user's Team filter offers. */
export async function teamsOf(userId: string) {
  return db
    .select({ id: schema.teams.id, name: schema.teams.name })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(and(eq(schema.teamMembers.userId, userId), eq(schema.teams.active, true)))
    .orderBy(asc(schema.teams.name));
}

/**
 * The members of the live team carrying this student, when this person leads
 * it, for the lead's "give to a team member" control. Empty for everybody
 * else, which is also what keeps the control off their screen.
 */
export async function teamToLead(userId: string, teamId: string | null) {
  if (!teamId) return [];
  const mine = await db
    .select({ one: sql`1` })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId), eq(schema.teamMembers.lead, true), eq(schema.teams.active, true)))
    .limit(1);
  if (!mine.length) return [];
  return db
    .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel })
    .from(schema.teamMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.teamMembers.userId))
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.users.active, true), inArray(schema.users.role, [...STUDENT_WORK_ROLES])))
    .orderBy(asc(schema.users.name));
}

/** Who has a part in this student's file, besides the counsellor it belongs to. */
export async function peopleOnFile(studentId: string) {
  return db.query.studentPeople.findMany({
    where: eq(schema.studentPeople.studentId, studentId),
    with: { user: { columns: { id: true, name: true, deskLabel: true, department: true, role: true, active: true } } },
    orderBy: asc(schema.studentPeople.createdAt),
  });
}

/**
 * The same, for a page of students at once.
 *
 * The students list shows who shares each file, and asking per row would be
 * fifty queries for one screen.
 */
export async function peopleOnFiles(studentIds: string[]) {
  const out = new Map<string, { id: string; name: string; part: string }[]>();
  if (studentIds.length === 0) return out;
  const rows = await db.query.studentPeople.findMany({
    where: inArray(schema.studentPeople.studentId, studentIds),
    with: { user: { columns: { id: true, name: true, deskLabel: true, active: true } } },
    orderBy: asc(schema.studentPeople.createdAt),
  });
  for (const r of rows) {
    if (!r.user?.active) continue;
    const list = out.get(r.studentId) ?? [];
    list.push({ id: r.id, name: r.user.deskLabel ?? r.user.name, part: r.part });
    out.set(r.studentId, list);
  }
  return out;
}

/** Who each kind of service request lands on, where somebody has been named. */
export async function serviceOwners() {
  const rows = await db.query.serviceOwners.findMany({
    with: { user: { columns: { id: true, name: true, deskLabel: true, active: true } } },
  });
  return new Map(rows.map((r) => [r.type, r]));
}

/**
 * The person a new request of this kind should land on. Null when nobody has
 * been named, which leaves the request where it always was: with the desk.
 */
export async function ownerForService(type: ServiceType): Promise<string | null> {
  const row = await db.query.serviceOwners.findFirst({
    where: eq(schema.serviceOwners.type, type),
    with: { user: { columns: { id: true, active: true } } },
  });
  return row?.user?.active ? row.user.id : null;
}
