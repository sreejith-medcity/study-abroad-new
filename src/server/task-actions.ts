"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_ROLES, PARTNER_ROLES, PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { autoKeys, CHANNEL_LABEL, OUTCOME_LABEL, TASK_KIND_LABEL } from "@/lib/crm";
import { getStudentForUser } from "@/server/queries";
import type { FormState } from "@/lib/form-state";
import type { ContactChannel, ContactOutcome, TaskKind } from "@/db/schema";

const { tasks: tk, contactLog: cl } = schema;

const dateOnly = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const taskSchema = z.object({
  taskId: z.string().optional(),
  title: z.string().trim().min(3, "Say what has to be done").max(200),
  detail: z.string().trim().max(1000).optional(),
  dueOn: z.string().min(1, "Give the day it is due"),
  kind: z.string().optional(),
  assignedToId: z.string().min(1, "Choose who it is for"),
  studentId: z.string().optional(),
  applicationId: z.string().optional(),
});

/** A task somebody put on a desk by hand. */
export async function saveTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") return { error: "Management reads the portal and changes nothing." };
  const parsed = taskSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const dueOn = dateOnly(d.dueOn);
  if (!dueOn) return { fieldErrors: { dueOn: ["Give the day it is due"] }, error: "Check the highlighted fields." };
  const kind = (d.kind && d.kind in TASK_KIND_LABEL ? d.kind : "FOLLOW_UP") as TaskKind;

  // A task belongs to the branch whose student it is about, so it is scoped the
  // same way everything else on that student is.
  let orgId = user.orgId;
  if (d.studentId) {
    const student = await getStudentForUser(user, d.studentId);
    orgId = student.orgId;
  }
  const assignee = await db.query.users.findFirst({ where: and(eq(schema.users.id, d.assignedToId), eq(schema.users.active, true)) });
  if (!assignee) return { fieldErrors: { assignedToId: ["That person is not here any more"] }, error: "Check the highlighted fields." };
  if (!isStaff(user) && assignee.orgId !== user.orgId) {
    return { fieldErrors: { assignedToId: ["You can only give work to your own branch"] }, error: "Check the highlighted fields." };
  }

  const values = {
    orgId,
    studentId: d.studentId || null,
    applicationId: d.applicationId || null,
    kind,
    title: d.title,
    detail: d.detail || null,
    dueOn,
    assignedToId: d.assignedToId,
    updatedAt: new Date(),
  };
  if (d.taskId) {
    const held = await db.query.tasks.findFirst({ where: eq(tk.id, d.taskId) });
    if (!held) return { error: "That task is gone." };
    if (!isStaff(user) && held.orgId !== user.orgId) return { error: "That task belongs to another branch." };
    await db.update(tk).set(values).where(eq(tk.id, d.taskId));
    await audit(user.id, "task.update", "task", d.taskId, { title: d.title, dueOn });
  } else {
    const [made] = await db.insert(tk).values({ ...values, createdById: user.id, source: "by hand" }).returning({ id: tk.id });
    await audit(user.id, "task.create", "task", made.id, { title: d.title, dueOn, assignedToId: d.assignedToId });
  }
  revalidatePath("/my-day");
  if (d.studentId) revalidatePath(`/students/${d.studentId}`, "layout");
  return { ok: d.taskId ? "Task saved." : `Task given to ${assignee.deskLabel ?? assignee.name}, due ${dueOn}.` };
}

/** Done. The note is for whoever reads the file next, not for a report. */
export async function finishTaskAction(fd: FormData): Promise<void> {
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") return;
  const id = String(fd.get("taskId") ?? "");
  const note = String(fd.get("doneNote") ?? "").trim().slice(0, 300) || null;
  const held = await db.query.tasks.findFirst({ where: eq(tk.id, id) });
  if (!held) return;
  if (!isStaff(user) && held.orgId !== user.orgId) return;
  await db.update(tk).set({ doneAt: new Date(), doneById: user.id, doneNote: note, updatedAt: new Date() }).where(eq(tk.id, id));
  await audit(user.id, "task.done", "task", id, { title: held.title });
  revalidatePath("/my-day");
  if (held.studentId) revalidatePath(`/students/${held.studentId}`, "layout");
}

/** Puts a task back, where it was ticked off by mistake. */
export async function reopenTaskAction(fd: FormData): Promise<void> {
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") return;
  const id = String(fd.get("taskId") ?? "");
  const held = await db.query.tasks.findFirst({ where: eq(tk.id, id) });
  if (!held) return;
  if (!isStaff(user) && held.orgId !== user.orgId) return;
  await db.update(tk).set({ doneAt: null, doneById: null, doneNote: null, updatedAt: new Date() }).where(eq(tk.id, id));
  await audit(user.id, "task.reopen", "task", id, {});
  revalidatePath("/my-day");
  if (held.studentId) revalidatePath(`/students/${held.studentId}`, "layout");
}

/** Pushes a task out by a few days without losing what it was for. */
export async function pushTaskAction(fd: FormData): Promise<void> {
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") return;
  const id = String(fd.get("taskId") ?? "");
  const days = Math.min(30, Math.max(1, Number(fd.get("days") ?? 1) || 1));
  const held = await db.query.tasks.findFirst({ where: eq(tk.id, id) });
  if (!held) return;
  if (!isStaff(user) && held.orgId !== user.orgId) return;
  const from = new Date(`${held.dueOn}T00:00:00Z`);
  const today = new Date();
  // Pushing an overdue task means "look at it again in N days", counted from
  // today rather than from the day it was already late on.
  const base = from.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) ? today : from;
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days));
  await db.update(tk).set({ dueOn: next.toISOString().slice(0, 10), updatedAt: new Date() }).where(eq(tk.id, id));
  await audit(user.id, "task.push", "task", id, { days, to: next.toISOString().slice(0, 10) });
  revalidatePath("/my-day");
  if (held.studentId) revalidatePath(`/students/${held.studentId}`, "layout");
}

/** Takes a task off a desk altogether. */
export async function deleteTaskAction(fd: FormData): Promise<void> {
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") return;
  const id = String(fd.get("taskId") ?? "");
  const held = await db.query.tasks.findFirst({ where: eq(tk.id, id) });
  if (!held) return;
  if (!isStaff(user) && held.orgId !== user.orgId) return;
  if (held.createdById !== user.id && !isStaff(user)) return;
  await db.delete(tk).where(eq(tk.id, id));
  await audit(user.id, "task.delete", "task", id, { title: held.title });
  revalidatePath("/my-day");
  if (held.studentId) revalidatePath(`/students/${held.studentId}`, "layout");
}

const contactSchema = z.object({
  studentId: z.string().min(1),
  channel: z.string().min(1),
  outcome: z.string().min(1, "What came of it"),
  note: z.string().trim().max(1000).optional(),
  nextActionOn: z.string().optional(),
  nextActionNote: z.string().trim().max(200).optional(),
  inbound: z.string().optional(),
});

/**
 * A conversation, logged in two clicks, with the next action as its own task.
 * That is what makes a follow-up list build itself rather than being kept in
 * somebody's notebook.
 */
export async function logContactAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") return { error: "Management reads the portal and changes nothing." };
  const parsed = contactSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!(d.channel in CHANNEL_LABEL)) return { fieldErrors: { channel: ["Pick one from the list"] }, error: "Check the highlighted fields." };
  if (!(d.outcome in OUTCOME_LABEL)) return { fieldErrors: { outcome: ["Pick one from the list"] }, error: "Check the highlighted fields." };
  const channel = d.channel as ContactChannel;
  const outcome = d.outcome as ContactOutcome;
  const student = await getStudentForUser(user, d.studentId);

  const [logged] = await db
    .insert(cl)
    .values({
      orgId: student.orgId,
      studentId: student.id,
      channel,
      inbound: fd.get("inbound") === "on",
      outcome,
      note: d.note || null,
      byId: user.id,
      nextActionOn: dateOnly(d.nextActionOn),
      nextActionNote: d.nextActionNote || null,
    })
    .returning({ id: cl.id });

  // The next action becomes a task on whoever the student is assigned to, or on
  // whoever logged the call when nobody else owns them.
  const due = dateOnly(d.nextActionOn);
  let taskId: string | null = null;
  if (due) {
    const [made] = await db
      .insert(tk)
      .values({
        orgId: student.orgId,
        studentId: student.id,
        kind: "CALL",
        title: d.nextActionNote || `Follow up with ${student.firstName} ${student.lastName}`,
        detail: [OUTCOME_LABEL[outcome], d.note].filter(Boolean).join(". ") || null,
        dueOn: due,
        assignedToId: student.assignedToId ?? user.id,
        createdById: user.id,
        source: `${CHANNEL_LABEL[channel]} on ${new Date().toISOString().slice(0, 10)}`,
        autoKey: autoKeys.callFollowUp(logged.id),
      })
      .onConflictDoNothing({ target: tk.autoKey })
      .returning({ id: tk.id });
    taskId = made?.id ?? null;
    if (taskId) await db.update(cl).set({ taskId }).where(eq(cl.id, logged.id));
  }
  await audit(user.id, "contact.log", "student", student.id, { channel, outcome, nextActionOn: due });
  revalidatePath(`/students/${student.id}`, "layout");
  revalidatePath("/my-day");
  return {
    ok: due ? `Logged. ${d.nextActionNote || "Follow up"} is on the desk for ${due}.` : "Logged.",
  };
}

/** Ticks off every task a person can see that is already done elsewhere. */
export async function clearDoneTasksAction(fd: FormData): Promise<void> {
  const user = await requireUser([...PROCESSING_ROLES, ...PARTNER_ROLES]);
  const ids = fd.getAll("taskId").map(String).filter(Boolean);
  if (!ids.length) return;
  const rows = await db.select({ id: tk.id, orgId: tk.orgId }).from(tk).where(and(inArray(tk.id, ids), isNull(tk.doneAt)));
  const mine = rows.filter((r) => isStaff(user) || r.orgId === user.orgId).map((r) => r.id);
  if (!mine.length) return;
  await db.update(tk).set({ doneAt: new Date(), doneById: user.id, updatedAt: new Date() }).where(inArray(tk.id, mine));
  await audit(user.id, "task.done_many", "task", "*", { count: mine.length });
  revalidatePath("/my-day");
}
