import { asc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { PREP_TEST_LABEL } from "@/lib/prep";
import { setPrepCoursePublishedAction } from "@/server/prep";
import { Button, Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";
import { PrepCourseForm } from "./form";

export const metadata = { title: "Test preparation courses" };

export default async function AdminPrepPage() {
  await requireUser([...ADMIN_ROLES]);
  const rows = await db.select().from(schema.prepCourses).orderBy(asc(schema.prepCourses.sortOrder), asc(schema.prepCourses.title));
  const [{ pages }] = await db.execute<{ pages: number }>(sql`select count(*)::int as pages from organizations where prep_page_enabled`);
  return (
    <>
      <PageHeader title="Test preparation courses" subtitle={`Shown on every branch's own prep page, in the branch's look. ${pages} branch${pages === 1 ? " has its" : "es have their"} page switched on.`} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card>
          <CardHeader title="Courses" />
          {rows.length === 0 ? (
            <EmptyState title="No courses yet">Add the first on the right. Branch prep pages show nothing until you do.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                  <div>
                    <p className="font-medium text-ink">{c.title}</p>
                    <p className="text-muted">{PREP_TEST_LABEL[c.test as keyof typeof PREP_TEST_LABEL] ?? c.test} · {c.mode}{c.durationWeeks ? ` · ${c.durationWeeks} weeks` : ""}{c.feeInr != null ? ` · ₹${c.feeInr.toLocaleString("en-IN")}` : " · Fee on request"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {c.published ? <Chip tone="ok">Shown</Chip> : <Chip>Hidden</Chip>}
                    <form action={setPrepCoursePublishedAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="published" value={c.published ? "false" : "true"} />
                      <Button size="sm" variant="quiet">{c.published ? "Hide" : "Show"}</Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">New course</h2>
          <PrepCourseForm />
        </Card>
      </div>
    </>
  );
}
