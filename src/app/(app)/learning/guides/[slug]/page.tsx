import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { guideBySlug, mayReadGuide } from "@/lib/staff-guides";
import { Card, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Guide" };

/**
 * A staff guide, read from the code: the learning library's row for it is a
 * link to this address, and the training course lists the same row under
 * "Read first". Shown to the roles in the guide's audience, and to the
 * Overseas team, who read everything in the library.
 */
export default async function StaffGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide || !mayReadGuide(guide, user.role, isStaff(user))) notFound();

  // The published course that quizzes on this guide, so the reader can go
  // straight on to it. Matched by title: the course is seeded under the
  // guide's own title and the admin's course list keeps it so.
  const course = await db.query.trainingCourses.findFirst({
    where: and(eq(schema.trainingCourses.published, true), eq(schema.trainingCourses.title, guide.course.title)),
    columns: { id: true },
    orderBy: asc(schema.trainingCourses.createdAt),
  });

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/learning" className="hover:underline">
            Learning resources
          </Link>
        }
        title={guide.title}
        subtitle={guide.summary}
        actions={course ? <LinkButton href={`/training/${course.id}`} variant="secondary">Take the course</LinkButton> : undefined}
      />
      <Card className="max-w-3xl p-6" data-staff-guide={guide.slug}>
        <article className="space-y-6 text-sm leading-relaxed text-ink">
          {guide.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="font-display text-base font-semibold text-ink">{s.heading}</h2>
              {s.paragraphs?.map((p, i) => (
                <p key={i} className="mt-2 text-ink-soft">
                  {p}
                </p>
              ))}
              {s.steps && (
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-soft">
                  {s.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
              {s.after && <p className="mt-2 text-ink-soft">{s.after}</p>}
            </section>
          ))}
        </article>
      </Card>
    </>
  );
}
