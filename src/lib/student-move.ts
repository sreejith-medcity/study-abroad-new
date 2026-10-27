import { STUDENT_WORK_ROLES } from "./permissions";
import { roleCan, type Override } from "./capabilities";
import type { OrgType } from "./people";

/**
 * The rules behind moving a student from one branch to another, kept apart
 * from the database so they can be read, and tested, on their own. The
 * transaction that carries a move out is in server/student-move.ts and has
 * nothing left to decide.
 *
 * Why it exists: a department was set up as a branch by mistake (Ausbildung,
 * NCLEX RN), students were registered there, and they have to go back to the
 * branch that actually serves them before the mistaken one is closed. A
 * student registered at the wrong branch for any other reason is the same
 * move.
 */

/**
 * Who may move a student to another branch: whoever may give a student to
 * anybody in the company (ASSIGN_ANYWHERE), by default the head office admins
 * and the application team leader, never a branch.
 */
export function mayMoveStudents(role: string, overrides: Override[] = []): boolean {
  return roleCan(role, "ASSIGN_ANYWHERE", overrides);
}

export type MoveTarget = { id: string; name: string; type: OrgType; active: boolean };

/**
 * Why a student cannot go to this organisation, or null when they can.
 *
 * Only a branch or a sub-agent firm. The head office is not a place a student
 * is registered: their Medcity ID letters, their fees and the enquiry form
 * they came through all belong to a branch, and the head office already sees
 * every student and can be their counsellor without the student moving
 * there.
 */
export function targetProblem(from: { id: string; name: string }, to: MoveTarget | null): string | null {
  if (!to) return "Pick the branch they are going to.";
  if (to.id === from.id) return `They are already at ${from.name}. Pick another branch.`;
  if (to.type === "HQ") return "A student belongs to a branch, not the head office. Pick a branch, and name a head office counsellor on the file if one is wanted.";
  if (!to.active) return `${to.name} is closed. Open it again before moving anybody into it.`;
  return null;
}

export type CounsellorChoice = "assign" | "leave";

export type Candidate = { id: string; name: string; orgId: string; role: string; active: boolean };

/**
 * Why this choice of counsellor will not do, or null when it will. Either a
 * named person who can work student files at the branch they are going to,
 * or nobody, for that branch's head to hand out. Nobody is refused where the
 * branch has no head, because then nobody at all would pick the students up.
 */
export function counsellorProblem(to: { id: string; name: string }, choice: string, counsellor: Candidate | null, targetHeads: number): string | null {
  if (choice === "leave") {
    return targetHeads > 0 ? null : `${to.name} has no active branch head to hand the students out. Pick a counsellor there instead.`;
  }
  if (choice !== "assign") return `Say who counsels them at ${to.name}: pick somebody, or leave them unassigned for the branch head.`;
  if (!counsellor) return `Pick the counsellor at ${to.name}.`;
  if (counsellor.orgId !== to.id) return `${counsellor.name} is not at ${to.name}. Pick somebody who works there.`;
  if (!counsellor.active) return `${counsellor.name} is switched off. Pick somebody who can sign in.`;
  if (!(STUDENT_WORK_ROLES as readonly string[]).includes(counsellor.role)) return `${counsellor.name} cannot work student files. Pick somebody who can.`;
  return null;
}

/** One student as the move reads them. */
export type MovingStudent = {
  id: string;
  orgId: string;
  archived: boolean;
  assignedToId: string | null;
  /** Whether the counsellor they have now sits at the head office. */
  counsellorAtHeadOffice: boolean;
};

export type StudentMoveInput = {
  students: MovingStudent[];
  from: { id: string; name: string };
  to: MoveTarget | null;
  choice: string;
  counsellor: Candidate | null;
  /** Active branch heads at the branch they are going to. */
  targetHeads: number;
  /** A whole branch at once, from the Partners screen, rather than one file. */
  bulk?: boolean;
};

export type StudentMovePlan = {
  to: { id: string; name: string };
  /** Each student and the counsellor they have after the move (null for nobody). */
  moves: { studentId: string; from: string | null; to: string | null }[];
  /** The named counsellor, when one was picked. */
  counsellorId: string | null;
};

/**
 * Works out what a move will do, or why it cannot be done. Pure: everything
 * it needs is passed in.
 *
 * The counsellor: the one picked, for every student. Left unassigned, a
 * counsellor at the head office stays on, because they can still open the
 * file wherever it is, and a branch counsellor is cleared, because they
 * cannot open it from the old branch.
 */
export function planStudentMove(input: StudentMoveInput): { ok: true; plan: StudentMovePlan } | { ok: false; error: string } {
  const { students, from, to, choice, counsellor, targetHeads, bulk } = input;
  const where = targetProblem(from, to);
  if (where) return { ok: false, error: where };
  const target = to!;
  if (!students.length) return { ok: false, error: bulk ? `${from.name} has no active students to move.` : "Student not found." };
  if (students.some((s) => s.orgId !== from.id)) return { ok: false, error: `That student is no longer at ${from.name}. Open the file again to see where they are.` };
  if (!bulk && students.some((s) => s.archived)) return { ok: false, error: "This student is archived. Bring them back from the archive before moving them." };
  const who = counsellorProblem(target, choice, counsellor, targetHeads);
  if (who) return { ok: false, error: who };
  const named = choice === "assign" ? counsellor!.id : null;
  return {
    ok: true,
    plan: {
      to: { id: target.id, name: target.name },
      counsellorId: named,
      moves: students.map((s) => ({ studentId: s.id, from: s.assignedToId, to: named ?? (s.counsellorAtHeadOffice ? s.assignedToId : null) })),
    },
  };
}

/**
 * Who takes the open tasks about a moved student that sat with somebody at
 * the old branch: their counsellor after the move, otherwise the head of the
 * branch they went to, otherwise nobody (the tasks then stay where they are).
 */
export function taskTakerFor(counsellorAfter: string | null, targetHead: { id: string } | null): string | null {
  return counsellorAfter ?? targetHead?.id ?? null;
}

/**
 * Which people-on-file entries come off the file. Somebody at the old branch
 * could no longer open it, so they are taken off, unless they are in the live
 * team carrying the file, which opens it to them wherever it is. Head office
 * people stay, as do people at any other organisation (a team member).
 */
export function filePeopleToTakeOff(rows: { id: string; userOrgId: string; onTeam: boolean }[], fromOrgId: string): string[] {
  return rows.filter((r) => r.userOrgId === fromOrgId && !r.onTeam).map((r) => r.id);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type StudentMoveOutcome = {
  /** The student's name for a single move, null for a whole branch. */
  studentName: string | null;
  students: number;
  fromName: string;
  toName: string;
  counsellorName: string | null;
  /** Students left for the branch head, for a whole branch. */
  unassigned: number;
  applications: number;
  enquiries: number;
  tasks: number;
  tasksTo: string | null;
  /** Tasks that stayed where they were, because nobody could take them. */
  tasksLeft: number;
  takenOffFiles: number;
  /** Archived students left behind by a whole-branch move. */
  archivedLeft?: number;
};

/** What the desk is told after a move, in plain sentences, from what it did. */
export function studentMoveSummary(o: StudentMoveOutcome): string {
  const who = o.studentName ?? plural(o.students, "student", "students");
  const parts: string[] = [`${who} ${o.studentName || o.students === 1 ? "is" : "are"} now at ${o.toName}.`];
  if (o.counsellorName) parts.push(`Counsellor: ${o.counsellorName}.`);
  else if (o.unassigned > 0) parts.push(`${o.studentName ? "Left" : `${plural(o.unassigned, "student", "students")} left`} unassigned for the branch head to hand out.`);
  if (o.applications > 0) parts.push(`${plural(o.applications, "application", "applications")} went with ${o.studentName ? "them" : "the students"}.`);
  if (o.enquiries > 0) parts.push(`${plural(o.enquiries, "enquiry", "enquiries")} moved too.`);
  if (o.tasks > 0) parts.push(o.tasksTo ? `${plural(o.tasks, "open task", "open tasks")} handed to ${o.tasksTo}.` : `${plural(o.tasks, "open task", "open tasks")} handed on at ${o.toName}.`);
  if (o.tasksLeft > 0) parts.push(`${plural(o.tasksLeft, "open task", "open tasks")} stayed where ${o.tasksLeft === 1 ? "it was" : "they were"}, because nobody at ${o.toName} could take ${o.tasksLeft === 1 ? "it" : "them"}.`);
  if (o.takenOffFiles > 0) parts.push(`${plural(o.takenOffFiles, "person", "people")} from ${o.fromName} taken off the ${o.studentName ? "file" : "files"}.`);
  if (o.archivedLeft) parts.push(`${plural(o.archivedLeft, "archived student stays", "archived students stay")} at ${o.fromName}.`);
  parts.push(MOVE_KEEPS(o.fromName));
  return parts.join(" ");
}

/**
 * What a move leaves as it was, said on the form before and in the answer
 * after, because both are questions the desk is asked straight away.
 */
export const MOVE_KEEPS = (fromName: string) =>
  `The Medcity ID stays as it is, because families already have it written down. Fee invoices and receipts already issued stay with ${fromName}, which numbered them.`;
