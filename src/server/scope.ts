import "server-only";
import { and, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { roleCan } from "@/lib/capabilities";
import { APP_ROLES, isDocumentationTeam, isStaff } from "@/lib/permissions";
import { can, overrides } from "@/server/capabilities";

/** What the rules below read about a person: who they are, their role, their organisation. */
export type Viewer = Pick<SessionUser, "id" | "role" | "orgId">;

/**
 * Which students this person may see.
 *
 * Two questions, in order. Whose organisation: the desk sees every branch, and
 * everybody else sees their own. Then whose students: somebody without
 * "See every student" sees only their own, which is the rule in `theirs`
 * below: the ones they registered, the ones assigned to them, and the ones
 * they are working in some recorded way.
 *
 * Both are applied in SQL rather than filtered afterwards, so a list, a count
 * and a page of results can never disagree about what somebody is allowed to
 * see.
 */
export async function studentWhere(user: SessionUser): Promise<SQL | undefined> {
  if (await can(user, "SEE_EVERY_STUDENT")) return orgOf(user);
  return and(orgOf(user), theirs(user, await can(user, "SEE_UNASSIGNED_FILES")))!;
}

/**
 * The extra condition an applications list needs, so a list never shows a row
 * that opening would refuse. Nothing where the role sees every student.
 *
 * An application is theirs when they are the officer on it, when the branch
 * has handed it to the desk they sit on, or when its student is theirs by the
 * same rule the students list applies. The last one is what keeps the
 * applications list, the students list and the dashboard counting the same
 * files.
 */
export async function ownApplicationsOnly(user: SessionUser): Promise<SQL | undefined> {
  if (await can(user, "SEE_EVERY_STUDENT")) return undefined;
  return or(
    // The desk works what the branches have handed it, which is the only thing
    // the portal records as giving a file to the desk.
    isDocumentationTeam(user) ? sql`${schema.applications.handedOverAt} is not null` : undefined,
    (await can(user, "SEE_UNASSIGNED_FILES")) ? unassignedFile() : undefined,
    eq(schema.applications.officerId, user.id),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.students)
        .where(and(eq(schema.students.id, schema.applications.studentId), theirs(user))),
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
 * A file handed to the desk that nobody carries yet, as a condition on an
 * applications row. The rule and why it reads as it does are in
 * lib/unassigned-files.ts; this is the same rule for the database.
 *
 * Whoever may "See and hand out the files nobody is carrying" sees these
 * files from every branch, in the lists, the counts and on opening, because
 * handing a file out means being able to open it first. The status is read in
 * its own subquery so the condition stands on its own inside any query over
 * applications, joined or not.
 */
export const unassignedFile = () =>
  sql`(${schema.applications.handedOverAt} is not null and ${schema.applications.officerId} is null and ${schema.applications.deskStage} <> 'RETURNED'
    and not exists (select 1 from status_definitions sd_closed where sd_closed.id = ${schema.applications.statusId} and sd_closed."group" = 'CLOSED'))`;

/** A student with at least one unassigned file. */
const hasUnassignedFile = () =>
  exists(
    db
      .select({ one: sql`1` })
      .from(schema.applications)
      .where(and(eq(schema.applications.studentId, schema.students.id), unassignedFile())),
  );

/**
 * A student is theirs if they registered them, if they counsel them, if they
 * are the officer on their file, if they have checked a document on it, if
 * they have been put on the file by name, or, for the documentation desk, if
 * the branch has handed the file to the desk. Whoever hands out the desk's
 * files also has the students with a file waiting for an officer
 * (`seesUnassigned`, from the capability of that name).
 *
 * A student nobody has been given to is not, by that alone, anybody's. The
 * rule used to open every unassigned student of a branch to every counsellor
 * there, and a counsellor's list then carried a colleague's walk-ins beside
 * her own while her dashboard did not count them. Now an unassigned student
 * is open to the person who registered them until the branch head, who sees
 * every student of the branch, hands them to somebody.
 *
 * Being put on the file is the people-on-file panel and the desk officer a
 * registration from an enquiry lands on. Both name somebody as carrying the
 * file, and the officer is told so in a notice; a file they then could not
 * open was a notice that ended in "page not found".
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
function theirs(user: Viewer, seesUnassigned = false): SQL {
  return or(
    isDocumentationTeam(user) ? handedToTheDesk() : undefined,
    seesUnassigned ? hasUnassignedFile() : undefined,
    eq(schema.students.createdById, user.id),
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
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.studentPeople)
        .where(and(eq(schema.studentPeople.studentId, schema.students.id), eq(schema.studentPeople.userId, user.id))),
    ),
  )!;
}

/** The organisation a person's lists are bounded by: none for the desk, their own for everybody else. */
const orgOf = (user: Viewer) => (isStaff(user) ? undefined : eq(schema.students.orgId, user.orgId));

/**
 * One person's own students, exactly as their students list shows them when
 * they do not see every student: inside their organisation, and theirs by the
 * rule above. The counsellor dashboard counts with this, so "My students" on
 * the board and the total under the list are the same number.
 */
export function ownedBy(user: Viewer): SQL {
  return and(orgOf(user), theirs(user))!;
}

/**
 * The "of" filter a list accepts: one named person's own students, as their
 * own list shows them. A dashboard's links carry it when the person whose
 * board it is will not be the one opening the list (somebody viewing as a
 * counsellor), or when that person's own list shows more than their own (a
 * desk counsellor, who sees every student), so the list a figure opens holds
 * exactly what the figure counted. It only ever narrows what the viewer may
 * see, never widens it. An id that is nobody's is nobody's students.
 */
export async function ownedByPerson(id: string): Promise<SQL> {
  const person = await db.query.users.findFirst({ where: eq(schema.users.id, id), columns: { id: true, role: true, orgId: true } });
  return person ? ownedBy(person) : sql`false`;
}

/**
 * The extra condition a list needs, or nothing where the role sees everything.
 *
 * Separate from studentWhere because most lists already apply their own
 * organisation filter, and two of them would be one too many.
 */
export async function ownStudentsOnly(user: SessionUser): Promise<SQL | undefined> {
  return (await can(user, "SEE_EVERY_STUDENT")) ? undefined : theirs(user, await can(user, "SEE_UNASSIGNED_FILES"));
}

/**
 * Whether this one student is theirs to open, for the places that hold a row already.
 *
 * The same answer as the lists give, asked of one row: a student a list shows
 * must open, or the list is offering a dead end.
 */
export async function mayOpenStudent(user: Viewer, student: { orgId: string; assignedToId: string | null; id: string; createdById?: string | null }) {
  if (!(APP_ROLES as readonly string[]).includes(user.role)) return false;
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
  if (await can(user, "SEE_UNASSIGNED_FILES")) {
    const waiting = await db.query.applications.findFirst({ where: and(eq(schema.applications.studentId, student.id), unassignedFile()), columns: { id: true } });
    if (waiting) return true;
  }
  const own = await db.query.applications.findFirst({
    where: and(eq(schema.applications.studentId, student.id), eq(schema.applications.officerId, user.id)),
    columns: { id: true },
  });
  if (own) return true;
  const checked = await db.query.checklistItems.findFirst({
    where: and(
      eq(schema.checklistItems.studentId, student.id),
      or(eq(schema.checklistItems.claimedById, user.id), eq(schema.checklistItems.decidedById, user.id)),
    ),
    columns: { id: true },
  });
  if (checked) return true;
  const onFile = await db.query.studentPeople.findFirst({
    where: and(eq(schema.studentPeople.studentId, student.id), eq(schema.studentPeople.userId, user.id)),
    columns: { id: true },
  });
  return !!onFile;
}

/**
 * Of these people, the ones who can open this student.
 *
 * Asked before a notice about a student is written, so nobody is sent a link
 * that ends in "page not found". The branch head of Medcity Kannur was told a
 * student had been registered for her and could not open them; whatever the
 * reason on the day, the notice should not have been sent to somebody the file
 * is closed to. A student who no longer exists is open to nobody.
 */
export async function whoMayOpenStudent(studentId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const student = await db.query.students.findFirst({
    where: eq(schema.students.id, studentId),
    columns: { id: true, orgId: true, assignedToId: true, createdById: true },
  });
  if (!student) return [];
  const people = await db
    .select({ id: schema.users.id, role: schema.users.role, orgId: schema.users.orgId })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  if (!people.length) return [];

  // The same steps as mayOpenStudent, in the same order, asked of everybody at
  // once. The handover of an enquiry tells the whole desk, and asking the
  // five questions above once per officer was dozens of round trips for one
  // notice. The role questions are answered from one read of the overrides;
  // the per-person questions are four queries over all of them together.
  const set = await overrides();
  const seesEvery = new Map<string, boolean>();
  for (const p of people) if (!seesEvery.has(p.role)) seesEvery.set(p.role, roleCan(p.role, "SEE_EVERY_STUDENT", set));

  const open = new Set<string>();
  const undecided: typeof people = [];
  for (const p of people) {
    if (!(APP_ROLES as readonly string[]).includes(p.role)) continue;
    if (!isStaff(p) && student.orgId !== p.orgId) continue;
    if (seesEvery.get(p.role) || student.createdById === p.id || student.assignedToId === p.id) {
      open.add(p.id);
      continue;
    }
    undecided.push(p);
  }
  if (!undecided.length) return people.filter((p) => open.has(p.id)).map((p) => p.id);

  // Handed to the desk opens the file to every documentation officer, so it is
  // asked once, and only when one of them is still undecided.
  if (undecided.some(isDocumentationTeam)) {
    const handed = await db.query.applications.findFirst({
      where: and(eq(schema.applications.studentId, student.id), sql`${schema.applications.handedOverAt} is not null`),
      columns: { id: true },
    });
    if (handed) for (const p of undecided) if (isDocumentationTeam(p)) open.add(p.id);
  }

  // The same for a file nobody carries yet, opened to whoever may hand it out.
  const handsOut = undecided.filter((p) => !open.has(p.id) && roleCan(p.role, "SEE_UNASSIGNED_FILES", set));
  if (handsOut.length) {
    const waiting = await db.query.applications.findFirst({ where: and(eq(schema.applications.studentId, student.id), unassignedFile()), columns: { id: true } });
    if (waiting) for (const p of handsOut) open.add(p.id);
  }

  const left = () => undecided.filter((p) => !open.has(p.id)).map((p) => p.id);
  let ids = left();
  if (ids.length) {
    const officers = await db
      .selectDistinct({ id: schema.applications.officerId })
      .from(schema.applications)
      .where(and(eq(schema.applications.studentId, student.id), inArray(schema.applications.officerId, ids)));
    for (const o of officers) if (o.id) open.add(o.id);
    ids = left();
  }
  if (ids.length) {
    const checked = await db
      .select({ claimedById: schema.checklistItems.claimedById, decidedById: schema.checklistItems.decidedById })
      .from(schema.checklistItems)
      .where(
        and(
          eq(schema.checklistItems.studentId, student.id),
          or(inArray(schema.checklistItems.claimedById, ids), inArray(schema.checklistItems.decidedById, ids)),
        ),
      );
    const wanted = new Set(ids);
    for (const c of checked) {
      if (c.claimedById && wanted.has(c.claimedById)) open.add(c.claimedById);
      if (c.decidedById && wanted.has(c.decidedById)) open.add(c.decidedById);
    }
    ids = left();
  }
  if (ids.length) {
    const onFile = await db
      .selectDistinct({ id: schema.studentPeople.userId })
      .from(schema.studentPeople)
      .where(and(eq(schema.studentPeople.studentId, student.id), inArray(schema.studentPeople.userId, ids)));
    for (const o of onFile) open.add(o.id);
  }
  return people.filter((p) => open.has(p.id)).map((p) => p.id);
}
