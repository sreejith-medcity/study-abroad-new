import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { whenDue, type When } from "@/lib/crm";
import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";

const { tasks: tk, students: st, users: us, organizations: og, applications: ap } = schema;

export type TaskRow = {
  id: string;
  title: string;
  detail: string | null;
  kind: typeof schema.tasks.$inferSelect.kind;
  dueOn: string;
  source: string;
  studentId: string | null;
  studentName: string | null;
  branch: string;
  applicationId: string | null;
  ackNo: string | null;
  assignedToId: string;
  assignedTo: string;
  createdBy: string | null;
  doneAt: Date | null;
  when: When;
};

export type TaskFilters = { assignedTo?: string; branch?: string; kind?: string; done?: string; studentId?: string };

/**
 * One person's desk, or a branch's. Open tasks only unless asked otherwise,
 * soonest first, because a list that opens on last month's finished work is a
 * list nobody reads twice.
 */
export async function taskList(scope: { orgId?: string; userId?: string }, filters: TaskFilters = {}, today = new Date()): Promise<TaskRow[]> {
  const assignee = schema.users;
  const rows = await db
    .select({
      id: tk.id,
      title: tk.title,
      detail: tk.detail,
      kind: tk.kind,
      dueOn: tk.dueOn,
      source: tk.source,
      studentId: tk.studentId,
      firstName: st.firstName,
      lastName: st.lastName,
      branch: og.name,
      applicationId: tk.applicationId,
      ackNo: ap.ackNo,
      assignedToId: tk.assignedToId,
      assignedTo: assignee.name,
      assignedToDesk: assignee.deskLabel,
      doneAt: tk.doneAt,
      createdById: tk.createdById,
    })
    .from(tk)
    .innerJoin(og, eq(og.id, tk.orgId))
    .innerJoin(assignee, eq(assignee.id, tk.assignedToId))
    .leftJoin(st, eq(st.id, tk.studentId))
    .leftJoin(ap, eq(ap.id, tk.applicationId))
    .where(
      and(
        scope.orgId ? eq(tk.orgId, scope.orgId) : undefined,
        filters.assignedTo ? eq(tk.assignedToId, filters.assignedTo) : scope.userId ? eq(tk.assignedToId, scope.userId) : undefined,
        filters.branch ? eq(tk.orgId, filters.branch) : undefined,
        filters.kind ? eq(tk.kind, filters.kind as "FOLLOW_UP") : undefined,
        filters.studentId ? eq(tk.studentId, filters.studentId) : undefined,
        filters.done === "1" ? undefined : isNull(tk.doneAt),
      ),
    )
    .orderBy(asc(tk.dueOn), asc(tk.createdAt))
    .limit(400);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    kind: r.kind,
    dueOn: r.dueOn,
    source: r.source,
    studentId: r.studentId,
    studentName: r.firstName ? `${r.firstName} ${r.lastName}` : null,
    branch: r.branch,
    applicationId: r.applicationId,
    ackNo: r.ackNo,
    assignedToId: r.assignedToId,
    assignedTo: r.assignedToDesk ?? r.assignedTo,
    createdBy: r.createdById,
    doneAt: r.doneAt,
    when: whenDue(r.dueOn, today),
  }));
}

/** How many are overdue and how many are due today, for the badge in the nav. */
export async function taskCounts(userId: string, today = new Date()) {
  const day = today.toISOString().slice(0, 10);
  const [row] = await db
    .select({
      overdue: sql<number>`count(*) filter (where ${tk.dueOn} < ${day})`.mapWith(Number),
      today: sql<number>`count(*) filter (where ${tk.dueOn} = ${day})`.mapWith(Number),
      open: count(tk.id),
    })
    .from(tk)
    .where(and(eq(tk.assignedToId, userId), isNull(tk.doneAt)));
  return row ?? { overdue: 0, today: 0, open: 0 };
}

/** The people a task can be given to inside one branch, plus the Overseas desk. */
export async function assignableUsers(user: SessionUser) {
  const where = isStaff(user)
    ? inArray(us.role, ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "DOCUMENTATION", "PARTNER", "COUNSELLOR"])
    : and(eq(us.orgId, user.orgId), inArray(us.role, ["PARTNER", "COUNSELLOR"]));
  return db
    .select({ id: us.id, name: us.name, deskLabel: us.deskLabel, role: us.role, orgId: us.orgId })
    .from(us)
    .where(and(eq(us.active, true), where))
    .orderBy(asc(us.name))
    .limit(300);
}

/**
 * Raises a task the portal decided on, once. The key stands for the fact, so
 * running the chasing twice in a day does not put the same thing on a desk
 * twice, and clearing it by hand does not bring it back.
 */
export async function raiseTask(values: {
  orgId: string;
  assignedToId: string;
  title: string;
  detail?: string | null;
  dueOn: string;
  kind?: typeof schema.tasks.$inferSelect.kind;
  studentId?: string | null;
  applicationId?: string | null;
  source: string;
  autoKey: string;
}) {
  const [made] = await db
    .insert(tk)
    .values({
      orgId: values.orgId,
      assignedToId: values.assignedToId,
      title: values.title,
      detail: values.detail ?? null,
      dueOn: values.dueOn,
      kind: values.kind ?? "FOLLOW_UP",
      studentId: values.studentId ?? null,
      applicationId: values.applicationId ?? null,
      source: values.source,
      autoKey: values.autoKey,
      createdById: null,
    })
    .onConflictDoNothing({ target: tk.autoKey })
    .returning({ id: tk.id });
  return made?.id ?? null;
}

/** Conversations on one student, newest first. */
export const contactsFor = (studentId: string, limit = 50) =>
  db.query.contactLog.findMany({
    where: eq(schema.contactLog.studentId, studentId),
    with: { by: { columns: { name: true, deskLabel: true } } },
    orderBy: desc(schema.contactLog.happenedAt),
    limit,
  });

/** When each student was last spoken to, for the board and the lists. */
export async function lastContactFor(studentIds: string[]) {
  if (!studentIds.length) return new Map<string, Date>();
  const rows = await db
    .select({ studentId: schema.contactLog.studentId, at: sql<Date>`max(${schema.contactLog.happenedAt})` })
    .from(schema.contactLog)
    .where(inArray(schema.contactLog.studentId, studentIds))
    .groupBy(schema.contactLog.studentId);
  return new Map(rows.map((r) => [r.studentId, new Date(r.at)]));
}

/** Tasks still open against a list of students, for the board's cards. */
export async function openTasksFor(studentIds: string[], today = new Date()) {
  if (!studentIds.length) return new Map<string, { open: number; overdue: number }>();
  const day = today.toISOString().slice(0, 10);
  const rows = await db
    .select({
      studentId: tk.studentId,
      open: count(tk.id),
      overdue: sql<number>`count(*) filter (where ${tk.dueOn} < ${day})`.mapWith(Number),
    })
    .from(tk)
    .where(and(inArray(tk.studentId, studentIds), isNull(tk.doneAt)))
    .groupBy(tk.studentId);
  return new Map(rows.filter((r) => r.studentId).map((r) => [r.studentId as string, { open: r.open, overdue: r.overdue }]));
}

/** Everything due on or before a day, for the nudges that become tasks. */
export const dueBy = (day: string) =>
  db
    .select({ id: tk.id, assignedToId: tk.assignedToId, title: tk.title })
    .from(tk)
    .where(and(isNull(tk.doneAt), or(lte(tk.dueOn, day))));
