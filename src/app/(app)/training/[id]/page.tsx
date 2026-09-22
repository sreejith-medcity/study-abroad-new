import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { Alert, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { QuizForm } from "@/components/training-forms";

export const metadata = { title: "Course" };

export default async function CoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ attempt?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const { id } = await params;
  const sp = await searchParams;
  const course = await db.query.trainingCourses.findFirst({
    where: and(eq(schema.trainingCourses.id, id), eq(schema.trainingCourses.published, true)),
    with: { questions: { orderBy: asc(schema.trainingQuestions.sortOrder) } },
  });
  if (!course) notFound();
  const reading = course.resourceIds.length
    ? await db.select({ id: schema.resources.id, title: schema.resources.title, url: schema.resources.url, storageKey: schema.resources.storageKey }).from(schema.resources).where(inArray(schema.resources.id, course.resourceIds))
    : [];
  const attempt = sp.attempt
    ? await db.query.trainingAttempts.findFirst({ where: and(eq(schema.trainingAttempts.id, sp.attempt), eq(schema.trainingAttempts.userId, user.id)) })
    : undefined;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/training" className="text-[13px] font-medium text-brand-600 hover:underline">← Training</Link>}
        title={course.title}
        subtitle={`${course.questions.length} questions · pass mark ${course.passMark}%`}
      />
      {attempt && (
        <Alert tone={attempt.passed ? "ok" : "warn"} title={attempt.passed ? `Passed with ${attempt.score}%` : `${attempt.score}%: not a pass yet`}>
          {attempt.passed ? (
            <LinkButton href={`/training/certificate/${attempt.id}`} variant="secondary" size="sm">Open your certificate</LinkButton>
          ) : (
            `The pass mark is ${course.passMark}%. Go back over the reading and try again.`
          )}
        </Alert>
      )}
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Quiz" />
          <div className="p-4"><QuizForm courseId={course.id} questions={course.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options }))} /></div>
        </Card>
        <Card className="self-start">
          <CardHeader title="Read first" subtitle={course.description ?? undefined} />
          {reading.length ? (
            <ul className="divide-y divide-line text-[13px]">
              {reading.map((r) => (
                <li key={r.id} className="px-4 py-2.5">
                  <a href={r.storageKey ? `/api/resources/${r.id}` : (r.url ?? "#")} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{r.title} ↗</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-muted">No reading attached.</p>
          )}
        </Card>
      </div>
    </>
  );
}
