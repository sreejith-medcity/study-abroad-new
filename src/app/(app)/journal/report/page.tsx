import Link from "next/link";
import { Fragment } from "react";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { FIGURE_KEYS, FIGURE_LABEL, REPORT_ROLES, STANDING_LABEL, clockText, dayText, istClock, istDay, previousDay, nextDay, type JournalStanding } from "@/lib/journal";
import { catchUp, consolidated } from "@/server/journal";
import { Card, CardHeader, Chip, LinkButton, PageHeader, cn } from "@/components/ui";
import { FigureStrip } from "@/components/dashboard/role-pieces";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Day end reports" };
export const dynamic = "force-dynamic";

const TONE: Record<JournalStanding, "ok" | "warn" | "bad" | "info"> = {
  VERIFIED: "ok",
  VERIFIED_LATE: "warn",
  FLAGGED: "warn",
  PENDING: "info",
  MISSED: "bad",
};

/**
 * The consolidated report: every day end report issued for a day, and how
 * each was answered. Read live from the end of the day, so the Overseas admin
 * can see who has verified as it happens; sent to them as a notification when
 * the last person answers, or at the cutoff with whoever did not marked
 * missed.
 *
 * The ones that need a look come first: missed, then flagged, then not yet
 * answered, then verified after hours, then verified. Anybody who signed in
 * after hours is shown whatever else they did. Under that, the counsellors'
 * figures for the day, by branch, with totals.
 */
export default async function JournalReportPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  await requireUser([...REPORT_ROLES]);
  const sp = await searchParams;
  await catchUp();
  const today = istDay();
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && sp.day <= today ? sp.day : today;
  const r = await consolidated(day);
  const t = r.totals;
  const dayEnd = clockText(r.clock.dayEnd);
  const afterHours = clockText(r.clock.outOfHours);
  const cutoff = clockText(r.clock.cutoff);

  return (
    <>
      <PageHeader
        title="Day end reports"
        subtitle={`${dayText(day, true)}. Every day end report issued for the day, how each was answered, and the counsellors' figures.`}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-print="hide">
            <LinkButton variant="secondary" size="sm" href={`/journal/report?day=${previousDay(day)}`}>
              Day before
            </LinkButton>
            {day < today && (
              <LinkButton variant="secondary" size="sm" href={day === previousDay(today) ? "/journal/report" : `/journal/report?day=${nextDay(day)}`}>
                Day after
              </LinkButton>
            )}
            <PrintButton />
          </div>
        }
      />

      <p className="mb-4 text-sm text-muted" data-report-state>
        {r.phase === "NONE"
          ? "Sunday: no day end reports are issued."
          : r.phase === "BEFORE"
            ? `The day is not over yet. Day end reports are issued at ${dayEnd}.`
            : r.phase === "OPEN"
              ? `Open: day end reports can be verified until ${cutoff}. This page fills in as people answer.`
              : r.sentAt
                ? `Closed. Sent at ${istClock(r.sentAt)}${r.reason === "ALL_DONE" ? ", when the last person answered" : ", at the cutoff"}.`
                : "Closed."}
      </p>

      {r.phase !== "NONE" && (
        <FigureStrip
          figures={[
            { slug: "issued", label: "Reports issued", value: t.staff, tone: "brand", href: `/journal/report?day=${day}` },
            { slug: "verified", label: "Verified", value: t.verified, tone: "good", href: `/journal/report?day=${day}` },
            { slug: "verified-late", label: `Verified after ${afterHours}`, value: t.verifiedLate, tone: "warn", href: `/journal/report?day=${day}` },
            { slug: "flagged", label: "Flagged a problem", value: t.flagged, tone: "warn", href: `/journal/report?day=${day}` },
            { slug: "pending", label: "Not yet verified", value: t.pending, tone: "info", href: `/journal/report?day=${day}` },
            { slug: "missed", label: "Missed", value: t.missed, tone: "stop", href: `/journal/report?day=${day}` },
            { slug: "out-of-hours", label: "Signed in after hours", value: t.outOfHours, tone: "stop", href: `/journal/report?day=${day}` },
          ]}
        />
      )}

      <Card className="mt-5">
        <CardHeader title="Everybody issued a day end report" subtitle="The ones that need a look first. A name opens what that person saw." />
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm" data-journal-report>
            <thead>
              <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5">Person</th>
                <th className="px-3 py-2.5">Where</th>
                <th className="px-3 py-2.5 text-right">Things done</th>
                <th className="px-3 py-2.5">Report</th>
                <th className="px-3 py-2.5">Answered</th>
                <th className="px-4 py-2.5">After hours</th>
              </tr>
            </thead>
            <tbody>
              {r.people.map((p) => (
                <tr key={p.id} data-person={p.id} data-standing={p.standing} className={cn("border-b border-line/70 align-top last:border-0", p.standing === "MISSED" && "bg-stop-50/50")}>
                  <td className="px-4 py-2.5">
                    <Link href={`/journal?user=${p.id}&day=${day}`} className="font-medium text-ink hover:underline">
                      {p.name}
                    </Link>
                    <span className="block text-2xs text-muted">{ROLE_LABEL[p.role] ?? p.role}</span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft">{p.branch}</td>
                  <td className="px-3 py-2.5 text-right tabular">{p.actions === 0 ? <span className="text-muted">Nothing recorded</span> : p.actions}</td>
                  <td className="px-3 py-2.5">
                    <Chip tone={TONE[p.standing]}>{STANDING_LABEL[p.standing]}</Chip>
                    {p.note && <span className="mt-1 block max-w-[18rem] whitespace-pre-line text-xs text-ink-soft">{p.note}</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular text-ink-soft">
                    {p.decidedAt ? istClock(p.decidedAt) : p.viewedAt ? <span className="text-muted">Opened at {istClock(p.viewedAt)}, not answered</span> : <span className="text-muted">Not opened</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {p.lateSignIns.length > 0 ? (
                      <span className="text-stop-700">
                        Signed in at {p.lateSignIns.map((at) => istClock(at)).join(", ")}
                        {p.lateActions > 0 && <span className="block text-xs">{p.lateActions} {p.lateActions === 1 ? "thing" : "things"} done after {afterHours}</span>}
                      </span>
                    ) : p.lateActions > 0 ? (
                      <span className="text-warn-700">{p.lateActions} {p.lateActions === 1 ? "thing" : "things"} done after {afterHours}</span>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </td>
                </tr>
              ))}
              {r.people.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    Nobody is issued a day end report.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      {r.phase !== "NONE" && (
        <Card className="mt-5">
          <CardHeader
            title="The day's figures"
            subtitle="What each counsellor and branch head gave at the end of the day. Calls, follow-ups and registrations start from the portal's own count; leads and connected calls are theirs alone."
          />
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm" data-day-end-figures-report>
              <thead>
                <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5">Counsellor</th>
                  {FIGURE_KEYS.map((k) => (
                    <th key={k} className="px-3 py-2.5 text-right">
                      {FIGURE_LABEL[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.figures.branches.map((b) => (
                  <Fragment key={b.orgId}>
                    <tr data-figures-branch-head={b.orgId} className="border-b border-line/70 bg-surface-2/60">
                      <th colSpan={6} className="px-4 py-2 text-left text-xs font-semibold text-ink">
                        {b.name}
                      </th>
                    </tr>
                    {b.people.map((p) => (
                      <tr key={p.id} data-figures-row={p.id} className="border-b border-line/70">
                        <td className="px-4 py-2">
                          <Link href={`/journal?user=${p.id}&day=${day}`} className="text-ink hover:underline">
                            {p.name}
                          </Link>
                          <span className="block text-2xs text-muted">{ROLE_LABEL[p.role] ?? p.role}</span>
                        </td>
                        {p.figures ? (
                          FIGURE_KEYS.map((k) => (
                            <td key={k} data-col={k} className="px-3 py-2 text-right tabular text-ink">
                              {p.figures![k] ?? <span className="text-muted">Not given</span>}
                            </td>
                          ))
                        ) : (
                          <td colSpan={5} data-col="none" className="px-3 py-2 text-right text-muted">
                            Not given
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr data-figures-branch={b.orgId} className="border-b border-line font-semibold">
                      <td className="px-4 py-2 text-ink-soft">
                        {b.name} total
                        <span className="block text-2xs font-normal text-muted">
                          {b.given} of {b.people.length} {b.people.length === 1 ? "person" : "people"} gave figures
                        </span>
                      </td>
                      {FIGURE_KEYS.map((k) => (
                        <td key={k} data-col={k} className="px-3 py-2 text-right tabular text-ink">
                          {b.totals[k]}
                        </td>
                      ))}
                    </tr>
                  </Fragment>
                ))}
                {r.figures.branches.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">
                      Nobody who gives figures is issued a day end report.
                    </td>
                  </tr>
                )}
              </tbody>
              {r.figures.branches.length > 0 && (
                <tfoot>
                  <tr data-figures-total className="bg-surface-2/60 font-semibold">
                    <td className="px-4 py-2.5 text-ink">
                      All branches
                      <span className="block text-2xs font-normal text-muted">
                        {r.figures.given} of {r.figures.people} gave figures
                      </span>
                    </td>
                    {FIGURE_KEYS.map((k) => (
                      <td key={k} data-col={k} className="px-3 py-2.5 text-right tabular text-ink">
                        {r.figures.totals[k]}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}
      <p className="mt-4 text-xs text-muted">
        Times are India time. The day ends at {dayEnd}; signing in from {afterHours} is out of hours; a report not answered by {cutoff} is missed. Change these in Platform settings.
      </p>
    </>
  );
}
