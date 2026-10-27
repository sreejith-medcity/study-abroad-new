import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { studentIdFromHref } from "@/lib/notification-links";
import { DOCUMENTATION_ROLES } from "@/lib/permissions";
import { hearsOfHandovers } from "@/lib/desk-scope";
import { overrides } from "@/server/capabilities";
import { whoMayOpenStudent } from "@/server/scope";

/**
 * Writes a notice to each of these people.
 *
 * A notice that links to a student goes only to the people who can open that
 * student. Who to tell is worked out in many places, by branch, by desk, by
 * assignment, and none of them asks the question the student page asks; so it
 * is asked once here, with the page's own rule, and a link that would end in
 * "page not found" is never written.
 */
export async function notifyUsers(userIds: (string | null | undefined)[], title: string, body?: string, href?: string) {
  let ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  const studentId = studentIdFromHref(href);
  if (studentId) ids = await whoMayOpenStudent(studentId, ids);
  if (!ids.length) return;
  await db.insert(schema.notifications).values(ids.map((userId) => ({ userId, title, body, href })));
}

/**
 * The people at Medcity Overseas who act on something waiting: the admins,
 * operations, and the application team leader, whose desk most of it lands on.
 * The team leader was left out, so the person running the queue heard about
 * none of it until somebody told them.
 */
export async function adminIds() {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.role, ["ADMIN", "SUPER_ADMIN", "OPS_MANAGER", "APPLICATION_TEAM_LEADER"]), eq(schema.users.active, true)));
  return rows.map((r) => r.id);
}

/**
 * The same people, plus the relationship manager who looks after that branch.
 * Used for anything that is about one branch's student: the manager carrying
 * the branch should not learn about their own files last.
 */
export async function deskRecipients(orgId?: string | null) {
  const ids = await adminIds();
  if (!orgId) return ids;
  const org = await db.query.organizations.findFirst({
    where: eq(schema.organizations.id, orgId),
    columns: { relationshipManagerId: true },
  });
  return org?.relationshipManagerId ? [...ids, org.relationshipManagerId] : ids;
}

/** Partner owner(s) and the assigned counsellor for a student. */
export async function partnerRecipients(orgId: string, assignedToId?: string | null) {
  const owners = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), inArray(schema.users.role, ["PARTNER"])));
  return [...owners.map((o) => o.id), assignedToId ?? null];
}

/**
 * The documentation desk alone: the documentation officers and the team leader
 * who runs them. What reaches them here is the Ausbildung, FSJ or Au pair file
 * the branch has just handed over, which is the desk's to pick up and name a
 * mentor for.
 *
 * Every notice sent to these people links to the student, and notifyUsers
 * writes it only to those who can open that student. An officer working their
 * own files cannot open a file nobody has given them, so a hand-over reaches
 * the team leader, and the officer once they are on it.
 */
export async function documentationIds() {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.role, [...DOCUMENTATION_ROLES]), eq(schema.users.active, true)));
  return rows.map((r) => r.id);
}

/**
 * The Overseas desk: the admins and whoever runs the documentation desk.
 * Everything about an application between the branch handing it over and the
 * vendor answering is theirs, so they are told about it together.
 *
 * Only the people who run the desk or hand its files out (RUN_DOCUMENTATION_DESK
 * or SEE_UNASSIGNED_FILES). Every documentation officer used to be told of
 * every hand-over, with a link to the desk rather than the student, so no
 * check on the file stopped it. Medcity chose own only: an officer is told
 * when a file or a document is given to them.
 */
export async function deskIds() {
  const rows = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(and(inArray(schema.users.role, ["ADMIN", "SUPER_ADMIN", "OPS_MANAGER", ...DOCUMENTATION_ROLES]), eq(schema.users.active, true)));
  const set = await overrides();
  return rows.filter((r) => hearsOfHandovers(r.role, set)).map((r) => r.id);
}

/** Of these people, the ones who run the documentation desk or hand its files out. */
export async function deskRunners(ids: { id: string; role: string }[]): Promise<string[]> {
  const set = await overrides();
  return ids.filter((p) => hearsOfHandovers(p.role, set)).map((p) => p.id);
}
