import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { Button, Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";
import { CourseForm, QuestionForm } from "@/components/training-forms";
import { deleteQuestionAction, setCoursePublishedAction } from "@/server/training";

export const metadata = { title: "Training" };

export default async function AdminTrainingPage() {
  await requireUser([...ADMIN_ROLES]);
  const courses = await db.query.trainingCourses.findMany({
    with: { questions: { orderBy: asc(schema.trainingQuestions.sortOrder) }, attempts: { columns: { userId: true, passed: true } } },
    orderBy: desc(schema.trainingCourses.createdAt),
  });
  const resources = await db.select({ id: schema.resources.id, title: schema.resources.title }).from(schema.resources).where(eq(schema.resources.published, true)).orderBy(asc(schema.resources.title));

  return (
    <>
      <PageHeader title="Training" subtitle="Courses for partner staff: reading from the learning library and a quiz. A pass earns a printable certificate." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {courses.length === 0 && <Card><EmptyState title="No courses yet">Create one on the right.</EmptyState></Card>}
          {courses.map((c) => {
            const passedBy = new Set(c.attempts.filter((a) => a.passed).map((a) => a.userId)).size;
            return (
              <Card key={c.id}>
                <CardHeader
                  title={c.title}
                  subtitle={`${c.questions.length} questions · pass mark ${c.passMark}% · ${c.resourceIds.length} reading item${c.resourceIds.length === 1 ? "" : "s"} · passed by ${passedBy}`}
                  action={
                    <div className="flex items-center gap-2">
                      {c.published ? <Chip tone="ok">Published</Chip> : <Chip>Draft</Chip>}
                      <form action={setCoursePublishedAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="published" value={c.published ? "false" : "true"} />
                        <Button type="submit" variant="quiet" size="sm" disabled={!c.published && c.questions.length === 0}>{c.published ? "Unpublish" : "Publish"}</Button>
                      </form>
                    </div>
                  }
                />
                {c.questions.length > 0 && (
                  <ol className="divide-y divide-line border-b border-line text-[13px]">
                    {c.questions.map((q, n) => (
                      <li key={q.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                        <div>
                          <p className="font-medium">{n + 1}. {q.prompt}</p>
                          <p className="text-xs text-muted">{q.options.map((o, i) => (i === q.correctIndex ? `✓ ${o}` : o)).join(" · ")}</p>
                        </div>
                        <form action={deleteQuestionAction}>
                          <input type="hidden" name="id" value={q.id} />
                          <Button type="submit" variant="quiet" size="sm">Remove</Button>
                        </form>
                      </li>
                    ))}
                  </ol>
                )}
                <details className="px-4 py-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-brand-600">Add a question</summary>
                  <div className="mt-2"><QuestionForm courseId={c.id} /></div>
                </details>
              </Card>
            );
          })}
        </div>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">New course</h2>
          <CourseForm resources={resources} />
        </Card>
      </div>
    </>
  );
}
