import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { deskPool, deskStanding, queueCounts } from "@/server/documentation";
import { CLAIM_MINUTES } from "@/lib/journey";
import { ROLE_LABEL } from "@/lib/permissions";
import { AlertTiles, Card, CardHeader, Chip, DashboardHero, EmptyState, HeroBand, KpiBoard, LinkButton, PersonRow, Table, Td, Th, cn } from "@/components/ui";

/** Hours, in the words somebody would use out loud rather than a decimal. */
function waited(hours: number | null) {
  if (hours == null) return "—";
  if (hours < 1) return "Under an hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * The desk, for whoever runs it.
 *
 * Not the queue again: the queue is one screen away and they work it like
 * anybody else. What this answers is the question a queue cannot, which is how
 * the work is spread. A desk with nothing waiting can still be a desk where one
 * person is carrying eleven files and another two, and that only shows up when
 * somebody looks at it per person.
 */
export default async function DeskLeadDashboard({ user }: { user: SessionUser }) {
  const r = schema.optionRequests;
  const [standing, pool, counts, options] = await Promise.all([
    deskStanding(),
    deskPool(),
    queueCounts(user.id),
    // Programme options asked for and not yet sent. The desk lead is who
    // chases them, so they belong here rather than only on their own screen.
    db
      .select({
        id: r.id,
        requestNo: r.requestNo,
        studentName: r.studentName,
        destinations: r.destinations,
        status: r.status,
        createdAt: r.createdAt,
        assignedToId: r.assignedToId,
        orgName: sql<string>`org.name`,
        waitingHours: sql<number>`round(extract(epoch from (now() - ${r.createdAt})) / 3600)::int`,
      })
      .from(r)
      .leftJoin(sql`organizations as org`, sql`org.id = ${r.orgId}`)
      .where(and(eq(r.archived, false), eq(r.status, "REQUESTED")))
      .orderBy(desc(r.createdAt))
      .limit(8),
  ]);
  const carrying = standing.reduce((n, o) => n + o.carrying, 0);
  const stale = standing.reduce((n, o) => n + o.stale, 0);
  const overdue = pool.overdue + standing.reduce((n, o) => n + o.overdue, 0);
  const decidedWeek = standing.reduce((n, o) => n + o.decidedWeek, 0);
  const sentBackWeek = standing.reduce((n, o) => n + o.sentBackWeek, 0);
  // Who is carrying most against who is carrying least, among the people who
  // are actually holding something. Said plainly rather than as a chart,
  // because the answer is one sentence and the action is one reassignment.
  const holding = standing.filter((o) => o.carrying > 0);
  const spread =
    holding.length > 1
      ? `${holding[0].deskLabel ?? holding[0].name} is carrying ${holding[0].carrying}, ${holding[holding.length - 1].deskLabel ?? holding[holding.length - 1].name} ${holding[holding.length - 1].carrying}.`
      : holding.length === 1
        ? `${holding[0].deskLabel ?? holding[0].name} is carrying all ${holding[0].carrying} of them.`
        : "Nothing is claimed at the moment.";

  return (
    <div className="space-y-5">
      <DashboardHero
        eyebrow="The documentation desk"
        title={`${pool.waiting} waiting, ${carrying} in hand`}
        subtitle={spread}
        actions={
          <>
            <LinkButton href="/documentation">Open the queue</LinkButton>
            <LinkButton href="/documentation?mine=1" variant="secondary">
              Your own {counts.mine}
            </LinkButton>
          </>
        }
      >
        <HeroBand
          figures={[
            { label: "Waiting", value: pool.waiting, href: "/documentation" },
            { label: "Claimed", value: carrying },
            { label: "Overdue", value: overdue },
            { label: "Decided this week", value: decidedWeek },
            { label: "Options owed", value: options.length, href: "/program-options" },
          ]}
        />
      </DashboardHero>

      <AlertTiles
        allClear="Nothing is waiting on this desk."
        tiles={[
          {
            label: "Past the date asked for",
            value: overdue,
            tone: "stop",
            note: "Chased or let go, but not left",
            href: "/documentation",
          },
          {
            label: "Waiting on nobody",
            value: pool.waiting,
            tone: "warn",
            note: pool.oldestHours == null ? undefined : `Oldest ${waited(pool.oldestHours)}`,
            href: "/documentation",
          },
          {
            label: `Held over ${CLAIM_MINUTES} minutes`,
            value: stale,
            tone: "warn",
            note: "Somebody opened it and went home",
            href: "/documentation",
          },
        ]}
      />

      {/* Two different things were in one row. The alerts above come and go
          with the trouble, which is right for an alert. What the desk got
          through is not an alert, and a figure that disappears on a quiet
          week is a figure nobody can read by position. */}
      <KpiBoard
        columns={3}
        tiles={[
          {
            label: "Decided this week",
            value: decidedWeek,
            tone: "good",
            note: decidedWeek > 0 ? `${sentBackWeek} sent back, ${Math.round((sentBackWeek / decidedWeek) * 100)}%` : "Nothing decided yet this week",
          },
        ]}
      />

      {stale > 0 && (
        <Card className="border-warn-500/25 bg-warn-50/60 p-4 text-[13px]">
          <span className="font-medium">{stale} document{stale === 1 ? " has" : "s have"} been claimed longer than a check takes.</span> Usually somebody opened
          it and went home. They can be moved to another officer, or put back in the pool, from the queue.
        </Card>
      )}

      {/* Asked for by a branch, owed by this desk. It used to live only on its
          own screen, so whoever ran the desk found out a request was sitting
          there when the branch rang to ask. */}
      <Card>
        <CardHeader
          title="Programme options asked for"
          subtitle="Requests from the branches that have not been sent back yet, oldest waiting first"
          action={<LinkButton href="/program-options" variant="secondary">Open them</LinkButton>}
        />
        {options.length === 0 ? (
          <EmptyState title="Nothing is waiting">Every request the branches have sent has been answered.</EmptyState>
        ) : (
          <ul>
            {options.map((o) => (
              <PersonRow
                key={o.id}
                name={o.studentName}
                href={`/program-options?id=${o.id}`}
                meta={
                  <>
                    {o.orgName}
                    {o.destinations.length > 0 && ` · ${o.destinations.join(", ")}`}
                    {!o.assignedToId && " · nobody on it"}
                  </>
                }
                pill={waited(o.waitingHours)}
                tone={o.waitingHours != null && o.waitingHours > 48 ? "bad" : "warn"}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Who is carrying what"
          subtitle={`Claimed and still open, against what each person has decided in the last seven days. Somebody with neither is left off rather than listed as a row of noughts.`}
        />
        {standing.length === 0 ? (
          <EmptyState title="Nobody is on the desk yet">
            Nothing has been claimed or decided this week. Once the desk is working, this says who is carrying what.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[760px]">
            <thead>
              <tr>
                <Th>Officer</Th>
                <Th className="text-right">Carrying</Th>
                <Th>Longest held</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">Decided, 7 days</Th>
                <Th>Of those, sent back</Th>
              </tr>
            </thead>
            <tbody>
              {standing.map((o) => (
                <tr key={o.id} className="hover:bg-surface-2/60">
                  <Td>
                    <span className="font-medium text-ink">{o.deskLabel ?? o.name}</span>
                    {o.deskLabel && <span className="ml-1.5 text-xs text-muted">{o.name}</span>}
                    <p className="text-xs text-muted">{ROLE_LABEL[o.role] ?? o.role}</p>
                  </Td>
                  <Td className="text-right tabular font-medium">{o.carrying}</Td>
                  <Td className={cn("whitespace-nowrap text-[13px]", o.stale > 0 && "font-medium text-warn-700")}>
                    {waited(o.oldestHours)}
                    {o.stale > 0 && <span className="block text-xs">{o.stale} held too long</span>}
                  </Td>
                  <Td className={cn("text-right tabular", o.overdue > 0 && "font-medium text-stop-700")}>{o.overdue || "—"}</Td>
                  <Td className="text-right tabular">{o.decidedWeek}</Td>
                  <Td className="text-[13px]">
                    {o.decidedWeek === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <>
                        {o.sentBackWeek} <span className="text-muted">of {o.decidedWeek}</span>
                        {/* A rate without the count behind it reads as a verdict
                            on a person. Three sent back out of four is a bad
                            week, not a bad officer. */}
                        {o.decidedWeek >= 5 && o.sentBackWeek / o.decidedWeek > 0.5 && <Chip tone="warn" className="ml-1.5">Over half</Chip>}
                      </>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="border-t border-line px-4 py-2.5 text-[13px] text-muted">
          A document is moved from the <Link href="/documentation" className="font-medium text-brand-600 hover:underline">queue</Link> itself, on the row it sits on.
        </p>
      </Card>
    </div>
  );
}
