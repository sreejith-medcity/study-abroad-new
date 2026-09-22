"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { ADMIN_ROLES, APP_ROLES } from "@/lib/permissions";
import { gradeQuiz } from "@/lib/training";

const course = z.object({
  title: z.string().trim().min(3, "Give it a title").max(200),
  description: z.string().trim().max(2000).transform((v) => v || null),
  passMark: z.coerce.number({ message: "A percentage" }).int().min(1, "Between 1 and 100").max(100, "Between 1 and 100"),
});

export async function createCourseAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = course.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const resourceIds = fd.getAll("resource").map(String).filter(Boolean);
  const [row] = await db.insert(schema.trainingCourses).values({ ...parsed.data, resourceIds, createdById: user.id }).returning();
  await audit(user.id, "training.course", "training", row.id, { title: row.title });
  revalidatePath("/admin/training");
  return { ok: "Course created as a draft. Add questions, then publish it." };
}

export async function addQuestionAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const courseId = String(fd.get("courseId") ?? "");
  const prompt = String(fd.get("prompt") ?? "").trim();
  const raw = [0, 1, 2, 3].map((i) => String(fd.get(`option${i}`) ?? "").trim());
  const correctRaw = Number(fd.get("correct"));
  const errors: Record<string, string[]> = {};
  if (prompt.length < 5) errors.prompt = ["Write the question"];
  const filled = raw.map((o, i) => ({ o, i })).filter((x) => x.o);
  if (filled.length < 2) errors.option0 = ["At least two answers"];
  if (!raw[correctRaw]) errors.correct = ["Pick which filled-in answer is right"];
  if (Object.keys(errors).length) return { error: "Check the highlighted fields.", fieldErrors: errors };
  const options = filled.map((x) => x.o);
  const correctIndex = filled.findIndex((x) => x.i === correctRaw);
  const existing = await db.select({ id: schema.trainingQuestions.id }).from(schema.trainingQuestions).where(eq(schema.trainingQuestions.courseId, courseId));
  await db.insert(schema.trainingQuestions).values({ courseId, prompt, options, correctIndex, sortOrder: existing.length });
  await audit(user.id, "training.question", "training", courseId);
  revalidatePath("/admin/training");
  return { ok: "Question added." };
}

export async function deleteQuestionAction(fd: FormData) {
  await requireUser([...ADMIN_ROLES]);
  await db.delete(schema.trainingQuestions).where(eq(schema.trainingQuestions.id, String(fd.get("id") ?? "")));
  revalidatePath("/admin/training");
}

export async function setCoursePublishedAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("id") ?? "");
  const published = fd.get("published") === "true";
  if (published) {
    const q = await db.query.trainingQuestions.findFirst({ where: eq(schema.trainingQuestions.courseId, id) });
    if (!q) return;
  }
  await db.update(schema.trainingCourses).set({ published }).where(eq(schema.trainingCourses.id, id));
  await audit(user.id, published ? "training.publish" : "training.unpublish", "training", id);
  revalidatePath("/admin/training");
}

/** Marks an attempt and keeps it; the page then shows the result. */
export async function submitQuizAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...APP_ROLES]);
  const courseId = String(fd.get("courseId") ?? "");
  const c = await db.query.trainingCourses.findFirst({ where: and(eq(schema.trainingCourses.id, courseId), eq(schema.trainingCourses.published, true)), with: { questions: true } });
  if (!c) return { error: "That course is not available." };
  const answers: Record<string, number | undefined> = {};
  const missing: string[] = [];
  for (const q of c.questions) {
    const v = fd.get(`q_${q.id}`);
    if (v == null || v === "") missing.push(q.id);
    else answers[q.id] = Number(v);
  }
  if (missing.length) return { error: `Answer every question: ${missing.length} left.` };
  const result = gradeQuiz(c.questions, answers, c.passMark);
  const [attempt] = await db.insert(schema.trainingAttempts).values({ courseId, userId: user.id, score: result.score, passed: result.passed }).returning();
  await audit(user.id, "training.attempt", "training", courseId, { score: result.score, passed: result.passed });
  return { redirectTo: `/training/${courseId}?attempt=${attempt.id}` };
}
