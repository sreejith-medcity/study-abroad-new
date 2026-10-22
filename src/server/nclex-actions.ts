"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { STUDENT_WORK_ROLES } from "@/lib/permissions";
import { NCLEX_STATES, NCLEX_STEPS, type NclexStepKey } from "@/lib/nclex";
import type { FormState } from "@/lib/form-state";
import { getStudentForUser } from "./queries";
import { ensureNclexCase, recordNclexStep } from "./nclex";

const { nclexCases: nc } = schema;

const day = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(t)) ? t : null;
};
const isStep = (v: string): v is NclexStepKey => NCLEX_STEPS.some((s) => s.key === v);

function refresh(studentId: string) {
  revalidatePath(`/students/${studentId}`, "layout");
  revalidatePath("/ausbildung");
}

/** One step, Completed or Pending, as the placement sheet has them. */
export async function saveNclexStepAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  await getStudentForUser(user, studentId);
  const step = String(fd.get("step") ?? "");
  if (!isStep(step)) return { error: "That step could not be saved." };
  const completed = fd.get("completed") === "1";
  // Completed means completed on a day; today unless somebody says otherwise.
  const completedOn = completed ? (day(fd.get("completedOn")) ?? new Date().toISOString().slice(0, 10)) : null;
  await recordNclexStep(studentId, step, user.id, { completed, completedOn });
  await audit(user.id, "nclex.step", "student", studentId, { step, completed, completedOn });
  refresh(studentId);
  const label = NCLEX_STEPS.find((s) => s.key === step)!.label;
  return { ok: `${label}: ${completed ? "completed" : "pending"}.` };
}

/** The board state and the payment link sent for it. */
export async function saveNclexCaseAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  await getStudentForUser(user, studentId);
  const boardState = String(fd.get("boardState") ?? "");
  if (boardState && !NCLEX_STATES.some((s) => s.code === boardState)) return { fieldErrors: { boardState: ["Pick a state from the list"] }, error: "Check the highlighted fields." };
  const link = String(fd.get("paymentLink") ?? "").trim();
  if (link && !/^https:\/\/\S+$/i.test(link)) return { fieldErrors: { paymentLink: ["A link starting with https://"] }, error: "Check the highlighted fields." };
  await ensureNclexCase(studentId, user.id);
  await db
    .update(nc)
    .set({ boardState: boardState || null, paymentLink: link || null, note: String(fd.get("note") ?? "").trim().slice(0, 600) || null, updatedById: user.id, updatedAt: new Date() })
    .where(eq(nc.studentId, studentId));
  await audit(user.id, "nclex.case", "student", studentId, { boardState: boardState || null, paymentLink: Boolean(link) });
  refresh(studentId);
  return { ok: "Saved." };
}

/**
 * The result. A result in means the results step is done, and decides which
 * step comes next: visa screening after a pass, re-examination after a fail.
 */
export async function saveNclexResultAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...STUDENT_WORK_ROLES]);
  const studentId = String(fd.get("studentId") ?? "");
  await getStudentForUser(user, studentId);
  const raw = String(fd.get("result") ?? "");
  const result = raw === "PASS" || raw === "FAIL" ? raw : null;
  const resultOn = result ? (day(fd.get("resultOn")) ?? new Date().toISOString().slice(0, 10)) : null;
  await ensureNclexCase(studentId, user.id);
  await db.update(nc).set({ result, resultOn, updatedById: user.id, updatedAt: new Date() }).where(eq(nc.studentId, studentId));
  if (result) await recordNclexStep(studentId, "EXAM_RESULTS", user.id, { completed: true, completedOn: resultOn });
  await audit(user.id, "nclex.result", "student", studentId, { result, resultOn });
  refresh(studentId);
  return { ok: result ? `Result recorded: ${result === "PASS" ? "pass" : "fail"}.` : "Result cleared." };
}
