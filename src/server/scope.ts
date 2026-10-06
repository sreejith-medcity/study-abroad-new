import "server-only";
import { and, eq, exists, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isDocumentationTeam, isStaff } from "@/lib/permissions";
import { can } from "@/server/capabilities";

/**
 * Which students this person may see.
 *
 * Two questions, in order. Whose organisation: the desk sees every branch, and
 * everybody else sees their own. Then whose students: somebody without
 * "See every student" sees only the ones assigned to them, which means the ones
 * they counsel and the applications they are the officer on.
 *
 * Both are applied in SQL rather than filtered afterwards, so a list, a count
 * and a page of results can never disagree about what somebody is allowed to
 * see.
 */
export async function studentWhere(user: SessionUser): Promise<SQL | undefined> {
  const org = isStaff(user) ? undefined : eq(schema.students.orgId, user.orgId);
  if (await can(user, "SEE_EVERY_STUDENT")) return org;
  return and(org, theirs(user, !isStaff(user)));
}

/**
 * The extra condition an applications list needs, so a list never shows a row
 * that opening would refuse. Nothing where the role sees every student.
 */
export async function ownApplicationsOnly(user: SessionUser): Promise<SQL | undefined> {
  if (await can(user, "SEE_EVERY_STUDENT")) return undefined;
  return or(
    // The desk works what the branches have handed it, which is the only thing
    // the portal records as giving a file to the desk.
    isDocumentationTeam(user) ? sql`${schema.applications.handedOverAt} is not null` : undefined,
    eq(schema.applications.officerId, user.id),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.students)
        .where(
          and(
            eq(schema.students.id, schema.applications.studentId),
            or(eq(schema.students.assignedToId, user.id), isStaff(user) ? undefined : isNull(schema.students.assignedToId)),
          ),
        ),
    ),
  );
}

/**
 * A file the branch has handed to the Overseas desk.
 *
 * This is what "assigned" means for the documentation desk, because nothing
 * assigns a student to a documentation officer: there is no such field and no
 * screen that sets one. What there is, is the moment a branch hands a file
 * over, and from that moment the desk works it. A student the branch has never
 * handed over is still the branch's own business and stays out.
 */
const handedToTheDesk = () =>
  exists(
    db
      .select({ one: sql`1` })
      .from(schema.applications)
      .where(and(eq(schema.applications.studentId, schema.students.id), sql`${schema.applications.handedOverAt} is not null`)),
  );

/**
 * A student is theirs if they registered them, if they counsel them, if they
 * are the officer on their file, if they have checked a document on it, or, for
 * the documentation desk, if the branch has handed the file to the desk.
 *
 * The document one is what makes the documentation queue work: somebody claims
 * a document from the pool and the file opens to them, rather than the queue
 * showing work nobody can reach.
 *
 * The first is what stops the desk losing a walk-in the moment it is saved.
 * Somebody at the head office registers a student into a branch, cannot assign
 * themselves because the counsellor has to belong to that branch, and would
 * otherwise watch the student they just typed in turn into a 404.
 */
function theirs(user: SessionUser, includeUnassigned: boolean): SQL {
  return or(
    isDocumentationTeam(user) ? handedToTheDesk() : undefined,
    eq(schema.students.createdById, user.id),
    // A student nobody has taken on is nobody else's either, and a student no
    // counsellor can open is a student nobody picks up. Inside their own branch
    // only: the desk roles are bounded by what is assigned to them, not by this.
    includeUnassigned ? isNull(schema.students.assignedToId) : undefined,
    eq(schema.students.assignedToId, user.id),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.applications)
        .where(and(eq(schema.applications.studentId, schema.students.id), eq(schema.applications.officerId, user.id))),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.studentId, schema.students.id),
            or(eq(schema.checklistItems.claimedById, user.id), eq(schema.checklistItems.decidedById, user.id)),
          ),
        ),
    ),
  )!;
}

/**
 * The extra condition a list needs, or nothing where the role sees everything.
 *
 * Separate from studentWhere because most lists already apply their own
 * organisation filter, and two of them would be one too many.
 */
export async function ownStudentsOnly(user: SessionUser): Promise<SQL | undefined> {
  return (await can(user, "SEE_EVERY_STUDENT")) ? undefined : theirs(user, !isStaff(user));
}

/** Whether this one student is theirs to open, for the places that hold a row already. */
export async function mayOpenStudent(user: SessionUser, student: { orgId: string; assignedToId: string | null; id: string; createdById?: string | null }) {
  if (!isStaff(user) && student.orgId !== user.orgId) return false;
  if (await can(user, "SEE_EVERY_STUDENT")) return true;
  if (student.createdById === user.id) return true;
  if (student.assignedToId === user.id) return true;
  if (isDocumentationTeam(user)) {
    const handed = await db.query.applications.findFirst({
      where: and(eq(schema.applications.studentId, student.id), sql`${schema.applications.handedOverAt} is not null`),
      columns: { id: true },
    });
    if (handed) return true;
  }
  if (student.assignedToId === null && !isStaff(user)) return true;
  const own = await db.query.applications.findFirst({
    where: and(eq(schema.applications.studentId, student.id), eq(schema.applications.officerId, user.id)),
    columns: { id: true },
  });
  return !!own;
}
