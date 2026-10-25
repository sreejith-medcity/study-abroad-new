import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, ROLE_LABEL } from "@/lib/permissions";
import { FIGURE_KEYS, FIGURE_LABEL, KIND_LABEL, STANDING_LABEL, clockText, dayText, istClock, istDay, journalIssued, readsJournalReport, type JournalStanding } from "@/lib/journal";
import { guideHref } from "@/lib/staff-guides";
import { catchUp, journalFor, journalHistory, kindCounts, markViewed } from "@/server/journal";
import { Card, CardHeader, Chip, EmptyState, LinkButton, PageHeader, cn } from "@/components/ui";
import { AnswerJournal } from "./forms";

export const metadata = { title: "Day end report" };
export const dynamic = "force-dynamic";

const TONE: Record<JournalStanding, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  VERIFIED: "ok",
  VERIFIED_LATE: "warn",
  FLAGGED: "warn",
  PENDING: "info",
  MISSED: "bad",
};

/**
 * The day end report: everything one person did in the portal on one working
 * day, from the records themselves, to view and verify at the end of the day
 * the way a bank teller signs the batch journal at close. A counsellor adds
 * the day's figures when answering.
 *
 * Somebody's own report by default. The Overseas admin, operations, the
 * super admin and management can open anybody's from the consolidated report,
 * to read, never to answer for them.
 */
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ day?: string; user?: string }> }) {
  const me = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  await catchUp();
  const today = istDay();
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && sp.day <= today ? sp.day : today;

  // Somebody else's, for the people who read the report.
  const otherId = sp.user && sp.user !== me.id && readsJournalReport(me.role) ? sp.user : null;
  const subject = otherId
    ? await db
        .select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, orgType: schema.organizations.type, branch: schema.organizations.name })
        .from(schema.users)
        .innerJoin(schema.organizations, eq(schema.users.orgId, schema.organizations.id))
        .where(eq(schema.users.id, otherId))
        .then((r) => r[0] ?? null)
    : { id: me.id, name: me.name, role: me.role, orgType: me.orgType, branch: me.orgName };

  if (!subject || !journalIssued(subject.role, subject.orgType)) {
    return (
      <>
        <PageHeader title="Day end report" />
        <Card>
          <EmptyState
            title={subject && otherId ? `${subject.name} is not issued a day end report` : "Day end reports are for Medcity's own staff"}
            action={readsJournalReport(me.role) ? <LinkButton href="/journal/report">Open the day end reports</LinkButton> : undefined}
          >
            A day end report is issued every working day to the Overseas desk and the Medcity branches. A sub-agent firm&apos;s staff, the super admin and management are not issued one.
          </EmptyState>
        </Card>
      </>
    );
  }

  const own = subject.id === me.id;
  const j = await journalFor(subject.id, subject.role, day);
  if (own && day === today && j.phase === "OPEN" && !j.row?.state) await markViewed(me.id, day);
  const history = own ? await journalHistory(me.id) : [];
  const counts = [...kindCounts(j.entries)].filter(([k]) => k !== "signin");
  const lateSignIns = j.entries.filter((e) => e.kind === "signin" && e.outOfHours);
  const lateActions = j.entries.filter((e) => e.kind !== "signin" && e.outOfHours).length;
  const work = j.entries.filter((e) => e.kind !== "signin").length;
  const canAnswer = own && day === today && j.phase === "OPEN" && !j.row?.state;
  const dayEnd = clockText(j.clock.dayEnd);
  const afterHours = clockText(j.clock.outOfHours);
  const cutoff = clockText(j.clock.cutoff);
  // What a counsellor gave when answering, shown once the day is answered.
  const given = j.figures;

  return (
    <>
      <PageHeader
        title={own ? "My day end report" : `${subject.name}'s day end report`}
        subtitle={`${dayText(day, true)}${own ? "" : ` · ${ROLE_LABEL[subject.role] ?? subject.role}, ${subject.branch}`}`}
        actions={
          <>
            {/* The staff guide on this screen, in the learning library. */}
            <Link href={guideHref("day-end-report")} data-how-this-works className="text-sm font-medium text-brand-600 hover:underline">
              How this works
            </Link>
            {readsJournalReport(me.role) && (
              <LinkButton variant="secondary" href={`/journal/report?day=${day}`}>
                Everybody&apos;s reports
              </LinkButton>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {j.phase === "NONE" ? <Chip>No report on Sundays</Chip> : <Chip tone={TONE[j.standing]}>{j.phase === "BEFORE" && !j.row?.state ? "The day is not over yet" : STANDING_LABEL[j.standing]}</Chip>}
        {j.row?.decidedAt && <span className="text-sm text-muted">at {istClock(j.row.decidedAt)}</span>}
        {lateSignIns.length > 0 && (
          <Chip tone="bad">
            Signed in after hours: {lateSignIns.map((e) => istClock(e.at)).join(", ")}
          </Chip>
        )}
      </div>

      {/* What to do now, in one sentence, whichever part of the day it is. */}
      <Card className="mb-5 p-4" data-journal-phase={j.phase}>
        {j.phase === "BEFORE" && (
          <p className="text-sm text-ink-soft">
            The working day ends at <strong>{dayEnd}</strong>. Your day end report is issued then, to view and verify before you leave. This is the day so far.
          </p>
        )}
        {j.phase === "OPEN" && canAnswer && (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              Read every line below. If it is your day as it happened, verify it. If anything is wrong, flag it and say what. It closes at <strong>{cutoff}</strong>, and signing in after{" "}
              <strong>{afterHours}</strong> is recorded as out of hours.
            </p>
            <AnswerJournal count={work} figures={j.prefill} />
          </div>
        )}
        {j.row?.state === "VERIFIED" && <p className="text-sm text-good-700">Verified at {istClock(j.row.decidedAt!)}. What you verified is kept as it was, below.</p>}
        {j.row?.state === "FLAGGED" && (
          <div className="text-sm">
            <p className="font-medium text-warn-700">Flagged at {istClock(j.row.decidedAt!)}.</p>
            <p className="mt-1 whitespace-pre-line text-ink-soft">{j.row.note}</p>
          </div>
        )}
        {j.phase === "OPEN" && !own && !j.row?.state && <p className="text-sm text-ink-soft">Not answered yet. It closes at {cutoff}.</p>}
        {j.standing === "MISSED" && <p className="text-sm text-stop-700">Not verified before {cutoff}, so it is recorded as missed. This is the report that was issued.</p>}
        {j.phase === "NONE" && <p className="text-sm text-ink-soft">Sundays are not working days, so no day end report is issued. Anything done today is still in the audit log.</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="min-w-0">
          <CardHeader
            title={work === 0 ? "Nothing recorded" : `${work} ${work === 1 ? "thing" : "things"} done`}
            subtitle={lateActions > 0 ? `${lateActions} of them after ${afterHours}` : "Oldest first, each opening the file it was done on"}
          />
          {j.entries.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Nothing was done in the portal {own ? "by you " : ""}on this day.</p>
          ) : (
            <ol data-journal-lines className="divide-y divide-line">
              {j.entries.map((e, i) => (
                <li key={i} data-kind={e.kind} className={cn("flex items-baseline gap-3 px-4 py-2.5 text-sm", e.outOfHours && "bg-stop-50/60")}>
                  <span className="w-20 shrink-0 tabular text-muted">{istClock(e.at)}</span>
                  <span className="min-w-0 flex-1">
                    {e.href ? (
                      <Link href={e.href} className="text-ink hover:text-brand-700 hover:underline">
                        {e.text}
                      </Link>
                    ) : (
                      <span className={e.kind === "signin" ? "text-muted" : "text-ink"}>{e.text}</span>
                    )}
                  </span>
                  {e.outOfHours && <Chip tone="bad">After hours</Chip>}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="space-y-5">
          {given && (
            <Card data-day-end-figures-given>
              <CardHeader title="The day's figures" subtitle={own ? "What you gave when you answered" : `What ${subject.name} gave when answering`} />
              <dl className="divide-y divide-line">
                {FIGURE_KEYS.map((k) => (
                  <div key={k} className="flex items-center justify-between px-4 py-2 text-sm">
                    <dt className="text-ink-soft">{FIGURE_LABEL[k]}</dt>
                    <dd data-figure-given={k} className="font-semibold tabular text-ink">
                      {given[k] ?? <span className="font-normal text-muted">Not given</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          <Card>
            <CardHeader title="The day in totals" />
            {counts.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">Nothing recorded.</p>
            ) : (
              <dl className="divide-y divide-line">
                {counts.map(([k, n]) => (
                  <div key={k} className="flex items-center justify-between px-4 py-2 text-sm">
                    <dt className="text-ink-soft">{KIND_LABEL[k] ?? k}</dt>
                    <dd className="font-semibold tabular text-ink">{n}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
          {own && history.length > 0 && (
            <Card>
              <CardHeader title="Your last two weeks" />
              <ul className="divide-y divide-line">
                {history.map((h) => (
                  <li key={h.day}>
                    <Link href={`/journal?day=${h.day}`} className={cn("flex items-center justify-between px-4 py-2 text-sm hover:bg-surface-2", h.day === day && "bg-surface-2")}>
                      <span className="text-ink-soft">{dayText(h.day)}</span>
                      <Chip tone={TONE[h.standing]}>{STANDING_LABEL[h.standing]}</Chip>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted">
        Times are India time. The day ends at {dayEnd}; a sign-in from {afterHours} is out of hours; an unanswered report is missed at {cutoff}.
      </p>
    </>
  );
}
