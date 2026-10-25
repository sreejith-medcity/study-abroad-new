import Link from "next/link";
import { Fragment } from "react";
import type { SessionUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { groupInr } from "@/lib/format";
import { FIGURE_KEYS, FIGURE_LABEL, STANDING_LABEL, dayText, monthFiguresByBranch, monthScopeFor, readsJournalReport, type JournalStanding } from "@/lib/journal";
import { isMonth, monthText, shiftMonth, thisMonth } from "@/lib/month";
import { journalBranches, monthDayList, monthFigures } from "@/server/journal";
import { Button, Card, CardHeader, Chip, Input, LinkButton, PageHeader, cn } from "@/components/ui";
import { PrintButton } from "@/components/print-button";

const TONE: Record<JournalStanding, "ok" | "warn" | "bad" | "info"> = {
  VERIFIED: "ok",
  VERIFIED_LATE: "warn",
  FLAGGED: "warn",
  PENDING: "info",
  MISSED: "bad",
};

export type MonthParams = { month?: string; org?: string; user?: string };

/**
 * A month of the counsellors' day end figures: each person's five figures
 * added up over the reports they answered that month, with the days they
 * answered and the days they missed, grouped by branch with a total per branch
 * and one for all of them. A name opens that person's month day by day.
 *
 * The report's readers see every branch and can narrow to one; a branch head
 * sees their own branch and nothing else.
 */
export async function MonthFigures({ user, sp }: { user: SessionUser; sp: MonthParams }) {
  const current = thisMonth();
  // A month ahead has no reports yet, so the address is brought back to now.
  const month = isMonth(sp.month) && sp.month <= current ? sp.month : current;
  const branches = await journalBranches();
  const scope = monthScopeFor(user, sp.org && branches.some((b) => b.id === sp.org) ? sp.org : null)!;
  const people = await monthFigures(month, scope.orgIds);
  const grouped = monthFiguresByBranch(people);
  // The person opened day by day has to be on this list: a branch head cannot
  // open another branch's counsellor by typing their id into the address.
  const subject = sp.user ? (people.find((p) => p.id === sp.user) ?? null) : null;
  const days = subject ? await monthDayList(subject.id, month) : [];

  const q = (extra: Record<string, string | null | undefined>) => {
    const entries = Object.entries({ view: "month", month, org: scope.every ? scope.org : null, ...extra }).filter(([, v]) => v) as [string, string][];
    return `/journal/report?${new URLSearchParams(entries).toString()}`;
  };
  const exportHref = `/api/journal/figures?${new URLSearchParams(Object.entries({ month, org: scope.every ? scope.org : null }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const num = (n: number) => groupInr(n);
  const scopeName = scope.org ? (branches.find((b) => b.id === scope.org)?.name ?? "the branch") : "every branch";

  return (
    <>
      <PageHeader
        title="Day end figures"
        subtitle={`${monthText(month)}, ${scopeName}. Each counsellor's figures added up over the day end reports they answered, with the days answered and missed.`}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <LinkButton variant="secondary" size="sm" href={q({ month: shiftMonth(month, -1), user: null })} data-month-previous>
              {monthText(shiftMonth(month, -1))}
            </LinkButton>
            {month < current && (
              <LinkButton variant="secondary" size="sm" href={q({ month: shiftMonth(month, 1), user: null })} data-month-next>
                {monthText(shiftMonth(month, 1))}
              </LinkButton>
            )}
            {/* A plain form: the browser does the picking and the page reloads with the month in the address. */}
            <form method="get" action="/journal/report" className="flex items-center gap-1.5" data-month-picker>
              <input type="hidden" name="view" value="month" />
              {scope.every && scope.org && <input type="hidden" name="org" value={scope.org} />}
              <Input type="month" name="month" defaultValue={month} max={current} aria-label="Month" className="w-44 py-1 text-sm" />
              <Button type="submit" variant="secondary" size="sm">
                Show
              </Button>
            </form>
            {/* A plain link rather than a button: the browser downloads it, and it works before the page's script has loaded. */}
            <a href={exportHref} data-export-figures className={cn("inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink hover:bg-surface-2")}>
              Download as Excel
            </a>
            {readsJournalReport(user.role) && (
              <LinkButton variant="secondary" size="sm" href="/journal/report" data-day-view>
                Day view
              </LinkButton>
            )}
            <PrintButton />
          </div>
        }
      />

      {scope.every && (
        <div className="mb-4 flex flex-wrap gap-1.5" data-branch-filter data-print="hide">
          <Link href={q({ org: null, user: null })} className={!scope.org ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}>
            All branches
          </Link>
          {branches.map((b) => (
            <Link
              key={b.id}
              href={q({ org: b.id, user: null })}
              data-branch-option={b.id}
              className={b.id === scope.org ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="The month's figures"
          subtitle="Only answered reports count: a day missed adds nothing. Days answered are the reports verified or flagged; days missed are the reports the cutoff closed unanswered. A name opens the person's month day by day."
        />
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm" data-month-figures data-month={month}>
            <thead>
              <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5">Counsellor</th>
                <th className="px-3 py-2.5 text-right">Days answered</th>
                <th className="px-3 py-2.5 text-right">Days missed</th>
                {FIGURE_KEYS.map((k) => (
                  <th key={k} className="px-3 py-2.5 text-right">
                    {FIGURE_LABEL[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.branches.map((b) => (
                <Fragment key={b.orgId}>
                  <tr data-month-branch-head={b.orgId} className="border-b border-line/70 bg-surface-2/60">
                    <th colSpan={8} className="px-4 py-2 text-left text-xs font-semibold text-ink">
                      {b.name}
                    </th>
                  </tr>
                  {b.people.map((p) => (
                    <tr key={p.id} data-month-row={p.id} className={cn("border-b border-line/70", subject?.id === p.id && "bg-brand-50/40")}>
                      <td className="px-4 py-2">
                        <Link href={q({ user: p.id })} className="text-ink hover:underline" data-month-person={p.id}>
                          {p.name}
                        </Link>
                        <span className="block text-2xs text-muted">{ROLE_LABEL[p.role] ?? p.role}</span>
                      </td>
                      <td data-col="answered" className="px-3 py-2 text-right tabular text-ink">
                        {num(p.answered)}
                      </td>
                      <td data-col="missed" className={cn("px-3 py-2 text-right tabular", p.missed > 0 ? "text-stop-700" : "text-ink")}>
                        {num(p.missed)}
                      </td>
                      {FIGURE_KEYS.map((k) => (
                        <td key={k} data-col={k} className="px-3 py-2 text-right tabular text-ink">
                          {p.answered === 0 ? <span className="text-muted">Not given</span> : num(p.figures[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr data-month-branch={b.orgId} className="border-b border-line font-semibold">
                    <td className="px-4 py-2 text-ink-soft">
                      {b.name} total
                      <span className="block text-2xs font-normal text-muted">
                        {b.people.length} {b.people.length === 1 ? "person" : "people"}
                      </span>
                    </td>
                    <td data-col="answered" className="px-3 py-2 text-right tabular text-ink">
                      {num(b.answered)}
                    </td>
                    <td data-col="missed" className="px-3 py-2 text-right tabular text-ink">
                      {num(b.missed)}
                    </td>
                    {FIGURE_KEYS.map((k) => (
                      <td key={k} data-col={k} className="px-3 py-2 text-right tabular text-ink">
                        {num(b.totals[k])}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
              {grouped.branches.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    Nobody who gives figures is issued a day end report here.
                  </td>
                </tr>
              )}
            </tbody>
            {grouped.branches.length > 0 && (
              <tfoot>
                <tr data-month-total className="bg-surface-2/60 font-semibold">
                  <td className="px-4 py-2.5 text-ink">
                    {scope.org ? "Total" : "All branches"}
                    <span className="block text-2xs font-normal text-muted">
                      {grouped.people} {grouped.people === 1 ? "person" : "people"}
                    </span>
                  </td>
                  <td data-col="answered" className="px-3 py-2.5 text-right tabular text-ink">
                    {num(grouped.answered)}
                  </td>
                  <td data-col="missed" className="px-3 py-2.5 text-right tabular text-ink">
                    {num(grouped.missed)}
                  </td>
                  {FIGURE_KEYS.map((k) => (
                    <td key={k} data-col={k} className="px-3 py-2.5 text-right tabular text-ink">
                      {num(grouped.totals[k])}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {subject && (
        <Card className="mt-5" data-month-days={subject.id}>
          <CardHeader
            title={`${subject.name}, day by day`}
            subtitle={`${monthText(month)}, ${subject.branch}. The days a day end report was issued and what was given on each.`}
            action={
              <LinkButton variant="secondary" size="sm" href={q({ user: null })} data-month-days-close>
                Close
              </LinkButton>
            }
          />
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">Day</th>
                  {FIGURE_KEYS.map((k) => (
                    <th key={k} className="px-3 py-2.5 text-right">
                      {FIGURE_LABEL[k]}
                    </th>
                  ))}
                  <th className="px-4 py-2.5">Report</th>
                </tr>
              </thead>
              <tbody>
                {days.map(({ figures, ...d }) => (
                  <tr key={d.day} data-month-day={d.day} data-standing={d.standing} className={cn("border-b border-line/70 last:border-0", d.standing === "MISSED" && "bg-stop-50/50")}>
                    <td className="px-4 py-2 text-ink">
                      {readsJournalReport(user.role) ? (
                        <Link href={`/journal?user=${subject.id}&day=${d.day}`} className="hover:underline">
                          {dayText(d.day)}
                        </Link>
                      ) : (
                        dayText(d.day)
                      )}
                    </td>
                    {figures ? (
                      FIGURE_KEYS.map((k) => (
                        <td key={k} data-col={k} className="px-3 py-2 text-right tabular text-ink">
                          {figures[k] == null ? <span className="text-muted">Not given</span> : num(figures[k])}
                        </td>
                      ))
                    ) : (
                      <td colSpan={5} data-col="none" className="px-3 py-2 text-right text-muted">
                        Not given
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <Chip tone={TONE[d.standing]}>{STANDING_LABEL[d.standing]}</Chip>
                      {d.note && <span className="mt-1 block max-w-[18rem] whitespace-pre-line text-xs text-ink-soft">{d.note}</span>}
                    </td>
                  </tr>
                ))}
                {days.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted">
                      No day end report was issued to {subject.name} in {monthText(month)}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted">Months run on India time. A report is answered when it is verified or flagged; a report not answered by the cutoff is missed, and a Sunday has no report unless Platform settings ask for one.</p>
    </>
  );
}
