import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DESK_OFFICER_ROLES, STAFF_ROLES } from "@/lib/permissions";
import type { ServiceType } from "@/lib/services";

/** Every team with its people, for the screen that runs them. */
export async function teamsWithMembers() {
  const teams = await db.query.teams.findMany({
    with: {
      members: {
        with: { user: { columns: { id: true, name: true, email: true, role: true, deskLabel: true, active: true } } },
      },
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

/** Everybody at the desk who can be put in a team or on a file. */
export async function deskPeople() {
  return db
    .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel, role: schema.users.role })
    .from(schema.users)
    .where(and(inArray(schema.users.role, [...STAFF_ROLES]), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.name));
}

/** The officers an application can be put on, for the control that does it. */
export async function deskOfficers() {
  return db
    .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel })
    .from(schema.users)
    .where(and(inArray(schema.users.role, [...DESK_OFFICER_ROLES]), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.name));
}

/** Who has a part in this student's file, besides the counsellor it belongs to. */
export async function peopleOnFile(studentId: string) {
  return db.query.studentPeople.findMany({
    where: eq(schema.studentPeople.studentId, studentId),
    with: { user: { columns: { id: true, name: true, deskLabel: true, role: true, active: true } } },
    orderBy: asc(schema.studentPeople.createdAt),
  });
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
