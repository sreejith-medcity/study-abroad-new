import "server-only";
import { and, eq, exists, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { roleCan } from "@/lib/capabilities";
import { opensHandedOverFiles, carriesOwnFilesOnly } from "@/lib/desk-scope";
import { APP_ROLES, isStaff } from "@/lib/permissions";
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
  return and(orgOf(user), theirs(user, await reach(user)))!;
}

/**
 * The two widenings of `theirs` that come from a capability rather than from
 * the file: the files a branch has handed to the desk, for somebody on the
 * documentation desk who runs the whole of it, and the files waiting for an
 * officer, for whoever hands them out. Read once from the matrix Medcity has
 * set, so the lists, the counts and the opens ask the same question.
 */
type Reach = { wholeDesk: boolean; seesUnassigned: boolean };

async function reach(user: Pick<SessionUser, "role">): Promise<Reach> {
  const set = await overrides();
  return { wholeDesk: opensHandedOverFiles(user.role, set), seesUnassigned: roleCan(user.role, "SEE_UNASSIGNED_FILES", set) };
}

/**
 * The students whose documents and files the desk's own screens show this
 * person: the documentation queue, the vendor desk, and the counts on the
 * menu and the dashboard beside them.
 *
 * Nothing for whoever may "See the whole desk, not only their own files"
 * (RUN_DOCUMENTATION_DESK): the team leader, the admins and operations see
 * the desk as it is. Anybody else sees the students they may open, by the
 * same rule as their students list, which for a documentation officer is
 * their own files and not the rest of the desk. Medcity chose own only: the
 * team leader hands out everything else from the Unassigned tab.
 */
export async function deskStudentScope(user: SessionUser): Promise<SQL | undefined> {
  if (await can(user, "RUN_DOCUMENTATION_DESK")) return undefined;
  return studentWhere(user);
}

/**
 * The extra condition an applications list needs, so a list never shows a row
 * that opening would refuse. Nothing where the role sees every student.
 *
 * An application is theirs when they are the officer on it, when the branch
 * has handed it to a desk they run the whole of, or when its student is theirs by the
 * same rule the students list applies. The last one is what keeps the
 * applications list, the students list and the dashboard counting the same
 * files.
 */
export async function ownApplicationsOnly(user: SessionUser): Promise<SQL | undefined> {
  if (await can(user, "SEE_EVERY_STUDENT")) return undefined;
  const r = await reach(user);
  return or(
    // Somebody running the whole documentation desk works what the branches
    // have handed it. An officer working their own files does not: a file
    // handed over is the team leader's to give out, and it is theirs once
    // they are the officer on it.
    r.wholeDesk ? sql`${schema.applications.handedOverAt} is not null` : undefined,
    r.seesUnassigned ? unassignedFile() : undefined,
    eq(schema.applications.officerId, user.id),
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.students)
        .where(and(eq(schema.students.id, schema.applications.studentId), theirs(user, { wholeDesk: r.wholeDesk, seesUnassigned: false }))),
    ),
  );
}

/**
 * A file the branch has handed to the Overseas desk.
 *
 * Opens the file to somebody on the documentation desk who runs the whole of
 * it (RUN_DOCUMENTATION_DESK, given to a documentation officer only where
 * Medcity has set it). It used to open every handed-over file to every
 * documentation officer, which put the whole desk's work in each officer's
 * lists. Medcity chose own only: an officer is given a file by name, as the
 * officer on the application, the mentor, or a person on the file, and the
 * team leader hands out the rest. A student the branch has never handed over
 * is still the branch's own business and stays out either way.
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
 * are the officer on their file, if they have claimed or checked a document
 * (for a documentation officer, only one they are checking now)
 * on it, if they have been put on the file by name (the mentor too), if they
 * are in the team carrying it, or, for somebody on the documentation desk who
 * runs the whole of it, if the branch has handed the file to the desk
 * (`wholeDesk`). Whoever hands out the desk's files also has the students
 * with a file waiting for an officer (`seesUnassigned`, from the capability
 * of that name). A documentation officer working their own files has
 * neither: the files handed over and not yet given to anybody are not theirs.
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
 * The document one is what makes the documentation queue work: a document
 * the team leader gives an officer, or one they claim on their own file,
 * opens the file to them, rather than the queue showing work nobody can
 * reach.
 *
 * The first is what stops the desk losing a walk-in the moment it is saved.
 * Somebody at the head office registers a student into a branch, cannot assign
 * themselves because the counsellor has to belong to that branch, and would
 * otherwise watch the student they just typed in turn into a 404.
 */
function theirs(user: Viewer, widened: Reach = { wholeDesk: false, seesUnassigned: false }): SQL {
  // A documentation officer's files are the ones they carry now: not a file
  // their team carries for somebody else, and not one where they once checked
  // a document (lib/desk-scope.ts carriesOwnFilesOnly).
  const officer = carriesOwnFilesOnly(user.role);
  return or(
    officer ? undefined : onTheirTeam(user),
    widened.wholeDesk ? handedToTheDesk() : undefined,
    widened.seesUnassigned ? hasUnassignedFile() : undefined,
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
            officer
              ? and(eq(schema.checklistItems.claimedById, user.id), isNull(schema.checklistItems.decidedById))
              : or(eq(schema.checklistItems.claimedById, user.id), eq(schema.checklistItems.decidedById, user.id)),
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

/**
 * A student on a team this person is in.
 *
 * The work divides by pathway before it divides by branch: an Ausbildung
 * student registered at Kannur is worked by the Ausbildung team, whichever
 * branch its people sit at. So a member of the team carrying a file may open
 * it and see it in their lists, wherever it was registered. The lead and the
 * members alike: the point of the team is that it works its files together,
 * and the lead hands one to a particular member on the file itself.
 *
 * This is shared working, not a transfer. The student stays at their branch
 * with their counsellor, and the branch sees them exactly as before. A
 * retired team opens nothing: its files keep its name, but nobody is working
 * them as that team any more.
 */
export function onTheirTeam(user: Pick<Viewer, "id">): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
      .where(
        and(
          eq(schema.teamMembers.teamId, schema.students.teamId),
          eq(schema.teamMembers.userId, user.id),
          eq(schema.teams.active, true),
        ),
      ),
  );
}

/** Whether this person is in the live team carrying this one student. */
async function onStudentsTeam(userId: string, studentId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(schema.students)
    .where(and(eq(schema.students.id, studentId), onTheirTeam({ id: userId })))
    .limit(1);
  return !!row;
}

/**
 * The organisation a person's lists are bounded by: none for the desk, their
 * own for everybody else, and beyond it only the files of a team they are in.
 */
const orgOf = (user: Viewer) => (isStaff(user) ? undefined : or(eq(schema.students.orgId, user.orgId), onTheirTeam(user)));

/**
 * The same bound, for the lists that apply their own organisation filter
 * before `ownStudentsOnly`: the students list, the Ausbildung and FSJ
 * trackers. Without it they would stop a team member at their own branch
 * while the file itself opened.
 */
export const studentOrgScope = (user: Viewer): SQL | undefined => orgOf(user);

/**
 * One person's own students, exactly as their students list shows them when
 * they do not see every student: inside their organisation, and theirs by the
 * rule above. The counsellor dashboard counts with this, so "My students" on
 * the board and the total under the list are the same number. Own means own:
 * neither the whole desk nor the files waiting for an officer are counted in.
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
  return (await can(user, "SEE_EVERY_STUDENT")) ? undefined : theirs(user, await reach(user));
}

/**
 * Whether this one student is theirs to open, for the places that hold a row already.
 *
 * The same answer as the lists give, asked of one row: a student a list shows
 * must open, or the list is offering a dead end.
 */
export async function mayOpenStudent(user: Viewer, student: { orgId: string; assignedToId: string | null; id: string; createdById?: string | null }) {
  if (!(APP_ROLES as readonly string[]).includes(user.role)) return false;
  // Another branch's student opens only to a member of the team carrying it.
  if (!isStaff(user) && student.orgId !== user.orgId) return onStudentsTeam(user.id, student.id);
  if (await can(user, "SEE_EVERY_STUDENT")) return true;
  if (student.createdById === user.id) return true;
  if (student.assignedToId === user.id) return true;
  const r = await reach(user);
  if (r.wholeDesk) {
    const handed = await db.query.applications.findFirst({
      where: and(eq(schema.applications.studentId, student.id), sql`${schema.applications.handedOverAt} is not null`),
      columns: { id: true },
    });
    if (handed) return true;
  }
  if (r.seesUnassigned) {
    const waiting = await db.query.applications.findFirst({ where: and(eq(schema.applications.studentId, student.id), unassignedFile()), columns: { id: true } });
    if (waiting) return true;
  }
  const own = await db.query.applications.findFirst({
    where: and(eq(schema.applications.studentId, student.id), eq(schema.applications.officerId, user.id)),
    columns: { id: true },
  });
  if (own) return true;
  const officer = carriesOwnFilesOnly(user.role);
  const checked = await db.query.checklistItems.findFirst({
    where: and(
      eq(schema.checklistItems.studentId, student.id),
      officer
        ? and(eq(schema.checklistItems.claimedById, user.id), isNull(schema.checklistItems.decidedById))
        : or(eq(schema.checklistItems.claimedById, user.id), eq(schema.checklistItems.decidedById, user.id)),
    ),
    columns: { id: true },
  });
  if (checked) return true;
  const onFile = await db.query.studentPeople.findFirst({
    where: and(eq(schema.studentPeople.studentId, student.id), eq(schema.studentPeople.userId, user.id)),
    columns: { id: true },
  });
  if (onFile) return true;
  return officer ? false : onStudentsTeam(user.id, student.id);
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
    columns: { id: true, orgId: true, assignedToId: true, createdById: true, teamId: true },
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

  // The members of the live team carrying the file, which opens it to them
  // at any branch: one query for all of them.
  const team = new Set<string>();
  if (student.teamId) {
    const members = await db
      .select({ id: schema.teamMembers.userId })
      .from(schema.teamMembers)
      .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
      .where(and(eq(schema.teamMembers.teamId, student.teamId), eq(schema.teams.active, true), inArray(schema.teamMembers.userId, userIds)));
    for (const m of members) team.add(m.id);
  }

  const open = new Set<string>();
  const undecided: typeof people = [];
  for (const p of people) {
    if (!(APP_ROLES as readonly string[]).includes(p.role)) continue;
    if (team.has(p.id) && !carriesOwnFilesOnly(p.role)) {
      open.add(p.id);
      continue;
    }
    if (!isStaff(p) && student.orgId !== p.orgId) continue;
    if (seesEvery.get(p.role) || student.createdById === p.id || student.assignedToId === p.id) {
      open.add(p.id);
      continue;
    }
    undecided.push(p);
  }
  if (!undecided.length) return people.filter((p) => open.has(p.id)).map((p) => p.id);

  // Handed to the desk opens the file to whoever on the documentation desk
  // runs the whole of it, so it is asked once, and only when one of them is
  // still undecided. An officer working their own files is not among them: a
  // hand-over tells the team leader, and the officer hears once it is theirs.
  const wholeDesk = (p: { role: string }) => opensHandedOverFiles(p.role, set);
  if (undecided.some(wholeDesk)) {
    const handed = await db.query.applications.findFirst({
      where: and(eq(schema.applications.studentId, student.id), sql`${schema.applications.handedOverAt} is not null`),
      columns: { id: true },
    });
    if (handed) for (const p of undecided) if (wholeDesk(p)) open.add(p.id);
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
    const roleOf = new Map(people.map((p) => [p.id, p.role]));
    for (const c of checked) {
      // A documentation officer counts only a document still in their hands.
      if (c.claimedById && wanted.has(c.claimedById) && (!carriesOwnFilesOnly(roleOf.get(c.claimedById) ?? "") || !c.decidedById)) open.add(c.claimedById);
      if (c.decidedById && wanted.has(c.decidedById) && !carriesOwnFilesOnly(roleOf.get(c.decidedById) ?? "")) open.add(c.decidedById);
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
