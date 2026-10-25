import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { DEPARTMENT_LABEL, MENTOR_PART, TAT_TASK_KEY_PREFIX, mentorOwnsStep, tatOverdue, tatOwners, tatTaskKey } from "@/lib/ausbildung";
import { istDay } from "@/lib/journal";
import { overTurnaroundSql } from "@/server/ausbildung";
import { notifyUsers } from "@/server/notify";
import { whoMayOpenStudent } from "@/server/scope";
import { raiseTask } from "@/server/tasks";

const { applications: a, programs: p, statusDefinitions: sd, students: st, users: us, studentPeople: sp } = schema;
type Role = (typeof us.role.enumValues)[number];

export type TurnaroundRun = {
  /** Files found over their turnaround with nothing raised for this stay yet. */
  found: number;
  tasksRaised: number;
  /** People told, across every file. */
  told: number;
  /** Files with nobody to tell: nobody in the owning roles, or at the branch, who can open the student. */
  nobodyToTell: number;
};

/** What "raised by" reads on a task the follow-through put on a desk. */
export const TAT_TASK_SOURCE = "the Ausbildung turnaround";

/** How many files one run looks at. Anything beyond waits for tomorrow, which keeps a run inside its time limit. */
export const TAT_RUN_LIMIT = 200;

/** The order a desk's people are preferred in as the one the task is put on. */
const ASSIGNEE_ORDER = ["APPLICATION_TEAM_LEADER", "DOCUMENTATION", "ADMIN", "OPS_MANAGER", "SUPER_ADMIN"];

/**
 * The daily follow-through on the written process.
 *
 * Every open Ausbildung application whose current step has run past the
 * guide's turnaround gets one follow-up task on the desk that owns the step,
 * and the people on that desk are told, with the student, the step and how
 * many days over. Once per stay in a step: a file is not nagged every morning,
 * and a task the desk has already ticked off is not raised again. A stay is
 * told apart by when the status was entered, so a file that moves on and later
 * comes back to the same step, or runs over again at the next status of the
 * same step, is followed up afresh.
 *
 * Nothing here moves a status. It says what the tracker already shows, to the
 * people who can do something about it.
 */
export async function runAusbildungTurnaround(now = new Date(), limit = TAT_RUN_LIMIT): Promise<TurnaroundRun> {
  const run: TurnaroundRun = { found: 0, tasksRaised: 0, told: 0, nobodyToTell: 0 };

  // A task raised since the status was entered means this stay has been
  // followed up, whether or not it has been ticked off. Asked in SQL so a
  // hundred already-handled files do not use up the limit before a new one.
  const alreadyRaised = sql`exists (
    select 1 from tasks xt
    where xt.application_id = ${a.id} and xt.auto_key like ${`${TAT_TASK_KEY_PREFIX}%`} and xt.created_at >= ${a.statusChangedAt}
  )`;

  const files = await db
    .select({
      id: a.id,
      studentId: a.studentId,
      orgId: a.orgId,
      officerId: a.officerId,
      since: a.statusChangedAt,
      code: sd.code,
      statusLabel: sd.label,
      firstName: st.firstName,
      lastName: st.lastName,
      counsellorId: st.assignedToId,
    })
    .from(a)
    .innerJoin(p, eq(p.id, a.programId))
    .innerJoin(sd, eq(sd.id, a.statusId))
    .innerJoin(st, eq(st.id, a.studentId))
    .where(and(eq(p.pathway, "AUSBILDUNG"), sql`${sd.group} <> 'CLOSED'`, eq(st.archived, false), overTurnaroundSql(sd.code, a.statusChangedAt), sql`not ${alreadyRaised}`))
    .orderBy(asc(a.statusChangedAt))
    .limit(limit);

  run.found = files.length;
  if (!files.length) {
    await audit(null, "ausbildung.turnaround", "cron", "ausbildung", { ...run, via: "scheduled" });
    return run;
  }

  // Who owns each desk, fetched once for the run rather than once per file.
  const roles = [...new Set(files.flatMap((f) => tatOwners(tatOverdue(f.code, f.since, now).step?.department).roles))];
  const branchOrgs = [...new Set(files.filter((f) => tatOwners(tatOverdue(f.code, f.since, now).step?.department).branch).map((f) => f.orgId))];
  const [roleUsers, branchHeads] = await Promise.all([
    roles.length ? db.select({ id: us.id, role: us.role }).from(us).where(and(eq(us.active, true), inArray(us.role, roles as Role[]))) : Promise.resolve([]),
    branchOrgs.length ? db.select({ id: us.id, orgId: us.orgId }).from(us).where(and(eq(us.active, true), eq(us.role, "PARTNER"), inArray(us.orgId, branchOrgs))) : Promise.resolve([]),
  ]);
  const byRole = new Map<string, string[]>();
  for (const u of roleUsers) byRole.set(u.role, [...(byRole.get(u.role) ?? []), u.id]);
  const headsByOrg = new Map<string, string[]>();
  for (const u of branchHeads) headsByOrg.set(u.orgId, [...(headsByOrg.get(u.orgId) ?? []), u.id]);
  // The mentor named on each file, where one is: the guide gives the
  // documentation and language steps to the mentor, so a task on one of those
  // steps is theirs before it is anybody else's on the desk.
  const mentors = await db
    .select({ studentId: sp.studentId, userId: sp.userId })
    .from(sp)
    .innerJoin(us, eq(us.id, sp.userId))
    .where(and(inArray(sp.studentId, [...new Set(files.map((f) => f.studentId))]), eq(sp.part, MENTOR_PART), eq(us.active, true)))
    .orderBy(asc(sp.createdAt));
  const mentorOf = new Map<string, string>();
  for (const m of mentors) mentorOf.set(m.studentId, m.userId);

  const day = istDay(now);

  for (const f of files) {
    const tat = tatOverdue(f.code, f.since, now);
    // The SQL and the arithmetic agree, so this only guards a status that
    // changed between the query and here.
    if (!tat.over || !tat.step) continue;
    const step = tat.step;
    const owners = tatOwners(step.department);

    // The desk's people, in the order one of them is preferred as the assignee:
    // the file's mentor first on the steps the guide gives the mentor, then
    // the desk in its usual order.
    const mentor = mentorOwnsStep(step.department) ? (mentorOf.get(f.studentId) ?? null) : null;
    const deskIds = [
      ...(mentor ? [mentor] : []),
      ...owners.roles.slice().sort((x, y) => ASSIGNEE_ORDER.indexOf(x) - ASSIGNEE_ORDER.indexOf(y)).flatMap((r) => byRole.get(r) ?? []),
    ];
    const branchIds = owners.branch ? [f.counsellorId, ...(headsByOrg.get(f.orgId) ?? [])].filter((x): x is string => !!x) : [];
    const wanted = [...new Set([...deskIds, ...branchIds])];
    // Only people who can open the student are told, and the task goes to one
    // of them: a notice about a file somebody cannot open is a dead end, and
    // a desk officer is only let into an Ausbildung file once it is handed
    // over, so the desk's team leader is often who this reaches.
    const recipients = wanted.length ? await whoMayOpenStudent(f.studentId, wanted) : [];
    if (!recipients.length) {
      run.nobodyToTell += 1;
      continue;
    }
    // The mentor gets the task on the mentor's steps; otherwise the officer
    // carrying the file when the step is their desk's; otherwise the first in
    // the desk's preferred order who can open it. The mentor is on the file by
    // name, so they can always open it.
    const assignee =
      mentor && recipients.includes(mentor)
        ? mentor
        : f.officerId && deskIds.includes(f.officerId) && recipients.includes(f.officerId)
          ? f.officerId
          : wanted.find((id) => recipients.includes(id)) ?? recipients[0];

    const name = `${f.firstName} ${f.lastName}`.trim();
    const dayWord = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
    const allowed = step.tatDays === 0 ? "the guide's same-day turnaround" : `the guide's T+${step.tatDays}`;
    const detail = `${name}: ${step.title} (${f.statusLabel}) has been with the ${DEPARTMENT_LABEL[step.department].toLowerCase()} desk for ${dayWord(tat.days ?? 0)}, ${dayWord(tat.daysOver)} over ${allowed}.`;
    const href = `/students/${f.studentId}/applications?app=${f.id}`;

    const raised = await raiseTask({
      orgId: f.orgId,
      assignedToId: assignee,
      studentId: f.studentId,
      applicationId: f.id,
      kind: "APPLICATION",
      title: `Step ${step.step} is over its turnaround: ${name}`,
      detail,
      dueOn: day,
      source: TAT_TASK_SOURCE,
      autoKey: tatTaskKey(f.id, step.step, f.since),
    });
    // No task means a run that overlapped this one already raised it, and
    // already told everybody; nothing more to say.
    if (!raised) continue;
    run.tasksRaised += 1;

    await notifyUsers(recipients, `${name}: step ${step.step} is ${dayWord(tat.daysOver)} over its turnaround`, detail, href);
    run.told += recipients.length;
  }

  await audit(null, "ausbildung.turnaround", "cron", "ausbildung", { ...run, via: "scheduled" });
  return run;
}
