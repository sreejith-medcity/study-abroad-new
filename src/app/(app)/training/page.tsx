import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { Card, CardHeader, Chip, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Training" };

export default async function TrainingPage() {
  const user = await requireUser([...APP_ROLES]);
  const courses = await db.query.trainingCourses.findMany({ where: eq(schema.trainingCourses.published, true), with: { questions: { columns: { id: true } } }, orderBy: asc(schema.trainingCourses.title) });
  const mine = await db.select().from(schema.trainingAttempts).where(eq(schema.trainingAttempts.userId, user.id));
  // Branch heads see their team; the Overseas team sees every branch.
  const seesTeam = user.role === "PARTNER" || isStaff(user);
  const team = seesTeam
    ? await db
        .select({ id: schema.users.id, name: schema.users.name, org: schema.organizations.name })
        .from(schema.users)
        .innerJoin(schema.organizations, eq(schema.users.orgId, schema.organizations.id))
        .where(and(inArray(schema.users.role, ["PARTNER", "COUNSELLOR"]), eq(schema.users.active, true), isStaff(user) ? undefined : eq(schema.users.orgId, user.orgId)))
        .orderBy(asc(schema.organizations.name), asc(schema.users.name))
    : [];
  const passes = team.length
    ? await db.select({ userId: schema.trainingAttempts.userId, courseId: schema.trainingAttempts.courseId }).from(schema.trainingAttempts).where(and(eq(schema.trainingAttempts.passed, true), inArray(schema.trainingAttempts.userId, team.map((t) => t.id))))
    : [];
  const passed = new Set(passes.map((p) => `${p.userId}:${p.courseId}`));

  return (
    <>
      <PageHeader title="Training" subtitle="Short courses on the destinations and the way the Overseas team works. Pass the quiz for a certificate." />
      <Card>
        {courses.length === 0 ? (
          <EmptyState title="No courses yet">The Overseas team publishes courses here.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {courses.map((c) => {
              const tries = mine.filter((a) => a.courseId === c.id);
              const pass = tries.find((a) => a.passed);
              const best = tries.length ? Math.max(...tries.map((a) => a.score)) : null;
              return (
                <li key={c.id}>
                  <Link href={`/training/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-2/60">
                    <div>
                      <p className="font-medium">{c.title}</p>
                      <p className="text-xs text-muted">{c.questions.length} questions · pass mark {c.passMark}%{c.description ? ` · ${c.description}` : ""}</p>
                    </div>
                    {pass ? <Chip tone="ok">Passed {fmtDate(pass.createdAt)}</Chip> : best != null ? <Chip tone="warn">Best {best}%</Chip> : <Chip>Not started</Chip>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {seesTeam && team.length > 0 && courses.length > 0 && (
        <Card className="mt-5">
          <CardHeader title={isStaff(user) ? "Progress by branch" : "Your team"} subtitle="Who has passed which course" />
          <Table tableClassName="min-w-[640px]">
            <thead><tr><Th>Person</Th>{courses.map((c) => <Th key={c.id}>{c.title}</Th>)}</tr></thead>
            <tbody>
              {team.map((t) => (
                <tr key={t.id}>
                  <Td>{t.name}{isStaff(user) && <p className="text-xs text-muted">{t.org}</p>}</Td>
                  {courses.map((c) => <Td key={c.id}>{passed.has(`${t.id}:${c.id}`) ? <Chip tone="ok">Passed</Chip> : <span className="text-xs text-muted">Not yet</span>}</Td>)}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
