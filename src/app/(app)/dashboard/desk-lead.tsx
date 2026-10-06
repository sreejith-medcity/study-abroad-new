import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { deskPool, deskStanding, queueCounts } from "@/server/documentation";
import { CLAIM_MINUTES } from "@/lib/journey";
import { ROLE_LABEL } from "@/lib/permissions";
import { Card, CardHeader, Chip, DashboardHero, EmptyState, LinkButton, Stat, Table, Td, Th, cn } from "@/components/ui";
import { IconAlert, IconCheck, IconClock, IconQueue } from "@/components/icons";

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
  const [standing, pool, counts] = await Promise.all([deskStanding(), deskPool(), queueCounts(user.id)]);
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
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <Stat icon={<IconQueue />} label="Waiting on nobody" value={pool.waiting} />
          <p className="mt-1 text-xs text-muted">{pool.oldestHours == null ? "Nothing waiting" : `Oldest: ${waited(pool.oldestHours)}`}</p>
        </Card>
        <Card className="p-4">
          <Stat icon={<IconClock />} label="Claimed and still open" value={carrying} />
          <p className="mt-1 text-xs text-muted">{stale > 0 ? `${stale} held longer than ${CLAIM_MINUTES} minutes` : "None held too long"}</p>
        </Card>
        <Card className="p-4">
          <Stat icon={<IconAlert />} label="Past the date asked for" value={overdue} tone={overdue > 0 ? "stop" : undefined} />
          <p className="mt-1 text-xs text-muted">{overdue > 0 ? "Chased or let go, but not left" : "Nothing overdue"}</p>
        </Card>
        <Card className="p-4">
          <Stat icon={<IconCheck />} label="Decided this week" value={decidedWeek} />
          <p className="mt-1 text-xs text-muted">
            {decidedWeek > 0 ? `${sentBackWeek} sent back, ${Math.round((sentBackWeek / decidedWeek) * 100)}%` : "Nothing decided yet this week"}
          </p>
        </Card>
      </div>

      {stale > 0 && (
        <Card className="border-amber-300 bg-amber-50/60 p-4 text-[13px]">
          <span className="font-medium">{stale} document{stale === 1 ? " has" : "s have"} been claimed longer than a check takes.</span> Usually somebody opened
          it and went home. They can be moved to another officer, or put back in the pool, from the queue.
        </Card>
      )}

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
                  <Td className={cn("whitespace-nowrap text-[13px]", o.stale > 0 && "font-medium text-amber-700")}>
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
