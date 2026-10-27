import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { can } from "@/server/capabilities";
import { dashboardTiles } from "@/server/dashboard-tiles";
import { followUps, pipeline } from "@/server/dashboard-work";
import { lensListHref, type Lens } from "@/server/dashboard-lens";
import { Card, CardHeader } from "@/components/ui";
import { FigureStrip, PipelineColumns, ageText } from "@/components/dashboard/role-pieces";

/**
 * "My students" on a desk dashboard: the documentation desk's and the
 * processing desk's.
 *
 * Those two dashboards count documents and the desk's work, so a person on
 * them who is also the counsellor named on students (the documentation team
 * carry files of their own, and so do some admins) saw none of their own
 * students on the board at all: forty-two students in the list, nothing on
 * the dashboard. This adds the counsellor's view of their own students to
 * those boards, counted by exactly the rule their students list applies
 * (server/scope.ts ownedBy), so the figure and the total under the list are
 * one number, and the list a figure opens holds what it counted.
 *
 * Drawn only on a person's own dashboard, not when somebody is viewing as
 * this dashboard, and only when they have any students at all, so somebody
 * who carries none is shown nothing new.
 */
export async function MyStudents({ lens, className }: { lens: Lens; className?: string }) {
  if (lens.viewingAs) return null;
  const { user } = lens;
  const person = { id: user.id, name: user.name, role: user.role, orgId: user.orgId };
  // Somebody who sees every student has a plain list of everyone, so their
  // figures link to the list of their own files instead (the "of" filter).
  const ofPerson = (await can(person, "SEE_EVERY_STUDENT")) ? person.id : null;
  const mine: Lens = { ...lens, kind: "counsellor", person, ofPerson, org: null, orgName: null };

  const [t, board, tasks, [assigned]] = await Promise.all([
    dashboardTiles(mine),
    pipeline(mine),
    followUps(mine),
    db
      .select({ n: count() })
      .from(schema.students)
      .where(and(eq(schema.students.assignedToId, user.id), eq(schema.students.archived, false))),
  ]);
  const assignedCount = Number(assigned?.n ?? 0);
  if (t.registrations.value === 0 && assignedCount === 0) return null;

  const apps = (query = "") => lensListHref(mine, "/applications", query);
  const figures = [
    { slug: "my-students", label: "My students", value: t.registrations.value, tone: "brand" as const, href: lensListHref(mine, "/students") },
    { slug: "assigned-to-me", label: "Assigned to me", value: assignedCount, tone: "brand" as const, href: `/students?assignedTo=${user.id}` },
    { slug: "follow-ups-today", label: "Follow-ups today", value: tasks.today, tone: "warn" as const, href: "/my-day" },
    { slug: "follow-ups-late", label: "Follow-ups late", value: tasks.late, tone: "stop" as const, href: "/my-day" },
    { slug: "my-applications", label: "Applications", value: t.applications.value, tone: "info" as const, href: apps() },
    { slug: "my-offers", label: "Offers", value: t.offers.value, tone: "good" as const, href: apps("kpi=offers") },
    { slug: "my-visas", label: "Visas", value: t.visaReceived.value, tone: "good" as const, href: apps("kpi=visa_received") },
  ];

  return (
    <section className={className} aria-labelledby="my-students-heading">
      <h2 id="my-students-heading" className="mb-2 font-display text-lg font-semibold text-ink">
        My students
      </h2>
      <FigureStrip figures={figures} />
      <Card className="mt-3">
        <CardHeader
          title="My students' applications by stage"
          subtitle="Every live application of a student who is yours, the one waiting longest at the top of each column"
          action={
            <Link href={lensListHref(mine, "/students")} className="text-xs font-medium text-brand-700 hover:underline">
              Open my students
            </Link>
          }
        />
        <PipelineColumns
          columns={board.map((c) => ({
            key: c.key,
            label: c.label,
            total: c.total,
            href: c.href,
            cards: c.cards.map((card) => ({
              id: card.id,
              href: `/students/${card.studentId}/applications?app=${card.id}`,
              title: card.student,
              lines: [`${card.country ? `${card.country} · ` : ""}${card.university}`, card.program],
              age: ageText(card.days),
              late: card.late,
            })),
          }))}
        />
      </Card>
    </section>
  );
}
