import Link from "next/link";
import { ROLE_LABEL } from "@/lib/permissions";
import { dayText, readsMonthFigures } from "@/lib/journal";
import { monthText } from "@/server/targets";
import { dayFigures } from "@/server/dashboard-figures";
import type { Lens } from "@/server/dashboard-lens";
import { Card, CardHeader } from "@/components/ui";
import { DayFigureBranches, DayFigureTable, DayFigureTiles } from "@/components/dashboard/role-pieces";

/**
 * The day's figures on a dashboard: today's five, with the month so far under
 * each, and for a branch its people one by one for the month. Today and this
 * month are fixed in India time; the period control does not move them,
 * because the day end report is about the day.
 */
export async function DayFiguresCard({ lens, className }: { lens: Lens; className?: string }) {
  const f = await dayFigures(lens);
  if (!f || f.kind === "branches") return null;
  const reportHref = `/journal/report?month=${f.month}`;
  const whenToday = dayText(f.day);

  if (f.kind === "person") {
    const own = !lens.viewingAs;
    const answered = f.person.today.source === "answered";
    const subtitle = answered
      ? `Today, ${whenToday}, as given on ${own ? "your" : `${f.person.name}'s`} day end report. The month so far adds up the reports answered.`
      : `Today, ${whenToday}, counted from the portal so far; leads received and connected calls come with the day end report. The month so far adds up the reports answered.`;
    return (
      <Card className={className} data-day-figures="person" data-today-source={f.person.today.source}>
        <CardHeader
          title="The day's figures"
          subtitle={subtitle}
          action={
            own ? (
              <Link href="/journal" className="text-xs font-medium text-brand-700 hover:underline">
                Day end report
              </Link>
            ) : undefined
          }
        />
        <div className="p-4">
          <DayFigureTiles today={f.person.today} month={f.person.month} />
        </div>
      </Card>
    );
  }

  const t = f.todayTotal;
  const whose = lens.viewingAs && !lens.org ? "every branch's people" : "the branch's people";
  return (
    <Card className={className} data-day-figures="branch" data-answered-today={t.answered} data-of-today={t.of}>
      <CardHeader
        title="The day's figures"
        subtitle={`Today, ${whenToday}, added up over ${whose}: ${t.answered} of ${t.of} have answered the day end report, the rest counted from the portal so far. The month so far adds up the reports answered.`}
        action={
          // The month view is the branch head's; a senior counsellor reads
          // the same board and has no report page to go to.
          readsMonthFigures(lens.user.role, lens.user.orgType) ? (
            <Link href={reportHref} className="text-xs font-medium text-brand-700 hover:underline">
              Reports for {monthText(f.month)}
            </Link>
          ) : undefined
        }
      />
      <div className="p-4">
        <DayFigureTiles today={{ source: t.answered === t.of && t.of > 0 ? "answered" : "live", figures: t.figures }} month={f.monthTotal} />
      </div>
      <div className="border-t border-line">
        <p className="px-4 pt-3 text-sm font-semibold text-ink">Each person, {monthText(f.month)} so far</p>
        <DayFigureTable
          rows={f.people.map((p) => ({ id: p.id, name: p.name, sub: lens.org || !lens.viewingAs ? (ROLE_LABEL[p.role] ?? p.role) : p.branch, month: p.month }))}
          empty="Nobody in the branch gives day end figures."
        />
      </div>
    </Card>
  );
}

/**
 * Leadership's strip: each branch's month so far, only where at least one
 * report has been answered this month. A branch yet to answer is left out
 * rather than shown as a row of noughts.
 */
export async function DayFiguresStrip({ lens, className }: { lens: Lens; className?: string }) {
  const f = await dayFigures(lens);
  if (!f || f.kind !== "branches") return null;
  const rows = f.branches.filter((b) => b.month.reports > 0);
  if (rows.length === 0) return null;
  const reportHref = `/journal/report?month=${f.month}`;
  return (
    <Card className={className} data-day-figures="branches">
      <CardHeader
        title={`The day's figures, ${monthText(f.month)} so far`}
        subtitle="Each branch's leads, calls, connected calls, follow-ups and registrations, added up over the day end reports its people answered this month"
        action={
          <Link href={reportHref} className="text-xs font-medium text-brand-700 hover:underline">
            Day end reports
          </Link>
        }
      />
      <DayFigureBranches rows={rows} href={reportHref} />
    </Card>
  );
}
