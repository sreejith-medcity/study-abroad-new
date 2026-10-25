import { chargeMoney, stepOfStatus, GERMAN_LEVELS, type ModuleState } from "@/lib/ausbildung";
import { MILESTONE_PHRASE, STUDENT_DESK_PHRASE, deskStanding, nextStep, studentMilestones, studentStepLine } from "@/lib/ausbildung-journey";
import { translator, type Locale } from "@/lib/i18n";
import { Card, CardHeader, Chip, cn } from "@/components/ui";
import { IconCheck, IconPhone } from "@/components/icons";

export type AusbildungJourneyProps = {
  locale: Locale;
  /** The open Ausbildung application the portal shows: its status code and the student's own label for it. */
  application: { statusCode: string; statusLabel: string };
  counsellor: { name: string; phone: string | null } | null;
  mentorName: string | null;
  german: { levels: { level: string; state: ModuleState }[] };
  /** What was raised and received, in one currency; null while nothing is raised. */
  charge: { currency: string; owed: number; received: number } | null;
};

/**
 * The Ausbildung journey as the student sees it on the portal home: the desks
 * of the written process as a track with the current one lit, what is happening
 * now and what comes next in plain words, who to ring, the German levels as a
 * row of chips, and where the service charge stands against the guide's
 * milestones. Nothing internal crosses over: no turnaround days, no desk emails,
 * and no figure that is not on record.
 */
export function AusbildungJourney({ locale, application, counsellor, mentorName, german, charge }: AusbildungJourneyProps) {
  const t = translator(locale);
  const step = stepOfStatus(application.statusCode);
  const after = nextStep(step);
  // A status the guide does not place (on hold, pending from the student)
  // has no step, so the status's own student label stands in for the line.
  const nowLine = studentStepLine(step?.step, locale) ?? application.statusLabel;
  const nextLine = step ? (after ? studentStepLine(after.step, locale) : t("lastStep")) : null;
  const desks = deskStanding(step);
  // The first unfinished level is the one the student is working towards.
  const nextLevel = german.levels.find((l) => l.state !== "COMPLETED")?.level ?? null;
  const milestones = studentMilestones(charge?.owed ?? 0, charge?.received ?? 0, application.statusCode);
  const next = milestones.find((m) => m.next) ?? null;
  const money = (amount: number | null) => (amount != null && charge ? chargeMoney(amount, charge.currency) : t("notRecorded"));

  return (
    <Card data-ausbildung-journey data-current-step={step?.step ?? ""} data-next-step={after?.step ?? ""} data-desk={step?.department ?? ""}>
      <CardHeader title={t("ausbildungJourney")} subtitle={t("ausbildungJourneyNote")} />

      <ol className="flex flex-wrap gap-1.5 px-4 pt-4" aria-label={t("ausbildungJourney")}>
        {desks.map((d, i) => (
          <li
            key={d.key}
            data-journey-desk={d.key}
            data-position={d.position}
            aria-current={d.position === "NOW" ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset",
              d.position === "NOW" && "bg-brand-600 text-white ring-brand-600",
              d.position === "DONE" && "bg-good-50 text-good-700 ring-good-500/25",
              d.position === "AHEAD" && "text-muted ring-line-strong",
            )}
          >
            {d.position === "DONE" ? <IconCheck className="size-3" /> : <span>{i + 1}.</span>}
            {t(STUDENT_DESK_PHRASE[d.key])}
          </li>
        ))}
      </ol>

      <dl className="grid gap-x-6 gap-y-3 px-4 py-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-2xs font-semibold uppercase tracking-wider text-muted">{t("whereYouAre")}</dt>
          <dd className="mt-0.5 font-medium text-ink" data-journey-now>
            {nowLine}
          </dd>
        </div>
        {nextLine && (
          <div>
            <dt className="text-2xs font-semibold uppercase tracking-wider text-muted">{t("whatHappensNext")}</dt>
            <dd className="mt-0.5 text-ink-soft" data-journey-next>
              {nextLine}
            </dd>
          </div>
        )}
      </dl>

      <div className="border-t border-line px-4 py-3 text-sm" data-journey-contacts>
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{t("whoToContact")}</p>
        <ul className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1.5">
          {counsellor && (
            <li data-journey-counsellor>
              <span className="text-muted">{t("counsellor")}: </span>
              <span className="font-medium text-ink">{counsellor.name}</span>
              {counsellor.phone && (
                <a href={`tel:${counsellor.phone.replace(/\s+/g, "")}`} className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline">
                  <IconPhone className="size-3.5" />
                  {counsellor.phone}
                </a>
              )}
            </li>
          )}
          {mentorName && (
            <li data-journey-mentor>
              <span className="text-muted">{t("yourMentor")}: </span>
              <span className="font-medium text-ink">{mentorName}</span>
            </li>
          )}
        </ul>
      </div>

      <div className="border-t border-line px-4 py-3" data-german-levels data-next-level={nextLevel ?? ""}>
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{t("germanLevels")}</p>
        <p className="text-xs text-muted">{nextLevel ? t("germanLevelsNote") : t("allLevelsDone")}</p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {GERMAN_LEVELS.map((level) => {
            const state = german.levels.find((l) => l.level === level)?.state ?? "NOT_STARTED";
            const isNext = level === nextLevel;
            return (
              <li key={level} data-german-level={level} data-state={state} data-next={isNext ? "yes" : undefined}>
                <Chip tone={state === "COMPLETED" ? "ok" : isNext ? "brand" : "neutral"} className={cn(isNext && "ring-2")}>
                  {state === "COMPLETED" && <IconCheck className="size-3" />}
                  {level}
                  <span className="font-normal opacity-80">
                    · {state === "COMPLETED" ? t("levelCompleted") : state === "IN_PROGRESS" ? t("levelInProgress") : isNext ? t("levelNext") : t("levelNotStarted")}
                  </span>
                </Chip>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line px-4 py-3" data-payments data-next-milestone={next?.step ?? ""}>
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{t("paymentsTitle")}</p>
        <p className="text-xs text-muted">{t("paymentsNote")}</p>
        <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">{t("paidSoFar")}</dt>
            <dd className="font-medium tabular text-ink" data-paid-so-far>
              {/* Nothing received is said rather than shown as zero, and the total is only quoted where a figure was raised. */}
              {charge && charge.received > 0 ? chargeMoney(charge.received, charge.currency) : t("notRecorded")}
              {charge && charge.owed > 0 && (
                <span className="font-normal text-muted">
                  {" "}
                  {t("ofTotal")} {chargeMoney(charge.owed, charge.currency)}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted">{t("nextPayment")}</dt>
            <dd className="font-medium text-ink" data-next-payment>
              {next ? (
                <>
                  {t(MILESTONE_PHRASE[next.step].label)}
                  {next.percent != null && <span className="font-normal text-muted"> · {money(next.amount)}</span>}
                </>
              ) : (
                t("allPaid")
              )}
            </dd>
          </div>
        </dl>
        <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {milestones.map((m) => (
            <li
              key={m.step}
              data-milestone={m.step}
              data-met={m.met ? "yes" : "no"}
              data-next={m.next ? "yes" : undefined}
              className={cn("rounded-lg border px-3 py-2", m.met ? "border-good-500/40 bg-good-50/40" : m.next ? "border-brand-200 bg-brand-50/60" : "border-line")}
            >
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="font-medium text-ink">{t(MILESTONE_PHRASE[m.step].label)}</span>
                {m.met ? <Chip tone="ok">{t("milestonePaid")}</Chip> : m.next ? <Chip tone="brand">{t("milestoneNext")}</Chip> : <Chip tone="neutral">{t("milestoneLater")}</Chip>}
              </div>
              <p className="text-xs text-muted">{t(MILESTONE_PHRASE[m.step].when)}</p>
              {m.percent != null && <p className="text-xs tabular text-ink-soft">{money(m.amount)}</p>}
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
