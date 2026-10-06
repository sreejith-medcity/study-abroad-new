import Link from "next/link";
import { and, asc, count, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { applicationWhere, type ApplicationFilters } from "@/server/queries";
import { agingList, deadlineList, kpiTotals, myWork, recentChanges, windowFor } from "@/server/dashboard";
import { ownApplicationsOnly } from "@/server/scope";
import { Card, CardHeader, Chip, DashboardHero, EmptyState, LinkButton, Stat, Table, Td, Th } from "@/components/ui";
import { IconApplications, IconClock, IconQueue, IconStudents } from "@/components/icons";
import { AgingCard, DashboardFilters, DeadlinesCard, RecentChangesCard, partOfDay } from "./parts";
import { greetingName } from "@/lib/format";

/**
 * A counsellor who sits at Medcity Overseas rather than at a branch.
 *
 * Their students are spread across every branch, so the branch workspace was
 * the wrong screen for them twice over: it scoped everything to the head
 * office, where they have no students, and it offered a wallet, a team and a
 * branch funnel that are none of their business. This is the same shape as a
 * branch counsellor's own desk, with the branch named on every row, because for
 * them it is the one thing that differs between two students.
 */
export default async function DeskCounsellorDashboard({ user, f }: { user: SessionUser; f: ApplicationFilters }) {
  const { students: s, countries: c } = schema;
  const filters: ApplicationFilters = { from: f.from, to: f.to, country: f.country, intakeYear: f.intakeYear, intakeMonth: f.intakeMonth };
  const mine = eq(s.assignedToId, user.id);
  const [kpis, work, deadlines, recent, waiting, countries, branches] = await Promise.all([
    kpiTotals(user, and(applicationWhere(user, filters, await ownApplicationsOnly(user)), mine)),
    myWork(user),
    deadlineList(user, windowFor((f as Record<string, string | undefined>).dw), 6, mine),
    recentChanges(user, 6, mine),
    agingList(user, 6, mine),
    db.select().from(c).orderBy(asc(c.name)),
    // Which branches their students sit in: the desk counsellor's own map of
    // where their work actually is.
    db
      .select({ id: schema.organizations.id, name: schema.organizations.name, n: count() })
      .from(s)
      .innerJoin(schema.organizations, eq(schema.organizations.id, s.orgId))
      .where(and(mine, eq(s.archived, false)))
      .groupBy(schema.organizations.id, schema.organizations.name)
      .orderBy(asc(schema.organizations.name)),
  ]);

  return (
    <>
      <DashboardHero
        eyebrow="Overseas desk"
        title={`${partOfDay()}, ${greetingName(user.name)}`}
        subtitle={
          branches.length === 0
            ? "No students are assigned to you yet. A branch head or an admin assigns them, and they appear here."
            : `${work.students} student${work.students === 1 ? "" : "s"} across ${branches.length} branch${branches.length === 1 ? "" : "es"}.`
        }
        actions={
          <>
            <LinkButton href="/students?mine=1">Your students</LinkButton>
            <LinkButton href="/search" variant="secondary">
              Find a course
            </LinkButton>
          </>
        }
      />

      <DashboardFilters countries={countries} f={f} />

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Stat icon={<IconStudents />} label="Your students" value={work.students} />
        </Card>
        <Card className="p-4">
          <Stat icon={<IconApplications />} label="Live applications" value={work.live} />
        </Card>
        <Card className="p-4">
          <Stat icon={<IconQueue />} label="Waiting on you" value={work.waiting} tone={work.waiting > 0 ? "warn" : undefined} />
        </Card>
        <Card className="p-4">
          <Stat icon={<IconClock />} label="Visas granted" value={kpis.visa_received ?? 0} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Where your students are"
            subtitle="A desk counsellor's students sit in somebody else's branch, which is the one thing that differs between two of them."
          />
          {branches.length === 0 ? (
            <EmptyState title="Nothing assigned yet">Students are assigned to you from their own file, or when you register one.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Branch</Th>
                  <Th className="text-right">Your students</Th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.id}>
                    <Td>
                      <Link href={`/students?branch=${b.id}&mine=1`} className="font-medium text-brand-600 hover:underline">
                        {b.name}
                      </Link>
                    </Td>
                    <Td className="text-right tabular">{b.n}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <DeadlinesCard rows={deadlines} window={(f as Record<string, string | undefined>).dw ?? "14"} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AgingCard rows={waiting} showOrg />
        <RecentChangesCard rows={recent} showOrg />
      </div>

      {work.replies.length > 0 && (
        <Card className="mt-4">
          <CardHeader title={`Students have written (${work.replies.length})`} subtitle="Unread, oldest first. Nobody else is going to answer these." />
          <ul className="divide-y divide-line">
            {work.replies.map((r) => (
              <li key={r.id} className="px-4 py-3 text-[13px]">
                <Link href={`/students/${r.studentId}/applications?app=${r.applicationId}`} className="font-medium text-brand-600 hover:underline">
                  {r.firstName} {r.lastName}
                </Link>
                <Chip className="ml-2">{r.authorLabel}</Chip>
                <p className="mt-0.5 line-clamp-2 text-muted">{r.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
