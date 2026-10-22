import Link from "next/link";
import { deskPool, deskStanding } from "@/server/documentation";
import { documentBoard, documentFigures, documentsToCome } from "@/server/dashboard-work";
import type { Lens } from "@/server/dashboard-lens";
import { Card, CardHeader, LinkButton } from "@/components/ui";
import { FigureStrip, Leaderboard, PipelineColumns, ProgressList, ageText } from "@/components/dashboard/role-pieces";
import { IconDoc } from "@/components/icons";
import { Controls, ViewingAsNote, firstName, partOfDay } from "./controls";

/**
 * The documentation desk's dashboard, as a pipeline board of documents.
 *
 * A strip of the desk's figures, every one the state of things now, then the
 * documents themselves as cards, column by column the way a document moves:
 * asked for, in and waiting for a check, being checked, sent back, and
 * accepted this week. Underneath, the students who owe the most, and who on
 * the desk has what in hand.
 *
 * Money is never on this screen. The people checking a bank statement have no
 * business knowing what the placement pays.
 */
export default async function Documents({ lens }: { lens: Lens }) {
  const { user } = lens;
  const [f, board, owed, standing, pool] = await Promise.all([documentFigures(lens), documentBoard(lens), documentsToCome(lens), deskStanding(), deskPool()]);

  return (
    <>
      <ViewingAsNote lens={lens} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-ink">Documents</h1>
          <p className="mt-0.5 text-muted">
            {partOfDay()}, {firstName(user.name)}. What is waiting, who has it, and who still owes what, right now.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Controls lens={lens} periods={false} />
          <LinkButton href="/documentation" size="sm">
            <IconDoc className="size-4" /> Open the queue
          </LinkButton>
        </div>
      </div>

      <FigureStrip
        figures={[
          { slug: "waiting-for-a-check", label: "Waiting for a check", value: f.waiting, note: pool.oldestHours != null && f.waiting > 0 ? `oldest ${pool.oldestHours}h` : undefined, tone: "warn", href: "/documentation" },
          { slug: f.mine ? "claimed-by-me" : "being-checked", label: f.mine ? "With me" : "Being checked", value: f.claimed, tone: "info", href: f.mine ? "/documentation?mine=1" : "/documentation" },
          { slug: "asked-not-in", label: "Asked, not in", value: f.asked, note: `${f.students} students owe`, tone: "brand", href: "/documentation" },
          { slug: "sent-back", label: "Sent back", value: f.sentBack, tone: "stop", href: "/documentation" },
          { slug: "past-due", label: "Past due", value: f.overdue, tone: "stop", href: "/documentation" },
          { slug: "accepted-this-week", label: "Accepted this week", value: f.acceptedWeek, tone: "good", href: "/documentation?view=branch" },
          { slug: "expiring-soon", label: "Expiring in 60 days", value: f.expiring, tone: "gold", href: "/documentation" },
        ]}
      />

      <Card className="mt-5">
        <CardHeader
          title="Documents by stage"
          subtitle="Every document in play as a card, the oldest at the top of each column"
          action={
            <Link href="/documentation" className="text-xs font-medium text-brand-700 hover:underline">
              Open the queue
            </Link>
          }
        />
        <PipelineColumns
          columns={board.map((c) => ({
            key: c.key,
            label: c.label,
            blurb: c.blurb,
            total: c.total,
            href: c.key === "IN_REVIEW" && !lens.viewingAs ? "/documentation?mine=1" : "/documentation",
            cards: c.cards.map((card) => ({
              id: card.id,
              href: `/students/${card.studentId}/documentation`,
              title: card.student,
              lines: [card.document, card.branch],
              age: ageText(card.days),
              late: card.overdue,
              who: c.key === "IN_REVIEW" ? card.who : undefined,
            })),
          }))}
        />
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="Students who owe the most" subtitle="Of what was asked, how much has come in, least complete first" />
          <ProgressList
            rows={owed.rows.map((r) => ({ id: r.id, label: r.student, done: r.in, of: r.asked, href: `/students/${r.id}/documentation` }))}
            footer={owed.students > 0 ? <span className="text-muted">{owed.owed} items owed across {owed.students} students</span> : undefined}
          />
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Who has what" subtitle="Documents in hand now, and decided in the last seven days" />
          <Leaderboard
            head={["Officer", "In hand", "Decided", "Sent back"]}
            empty="Nobody on the desk has a document in hand or has decided one this week."
            rows={standing.map((o) => ({ id: o.id, name: o.name, sub: o.deskLabel ?? undefined, cells: [o.carrying, o.decidedWeek, o.sentBackWeek] }))}
          />
        </Card>
      </div>
    </>
  );
}
