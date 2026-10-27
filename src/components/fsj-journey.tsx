import { FSJ_STEP_COUNT, FSJ_STEPS, FSJ_STUDENT_STEP, fsjStepOf } from "@/lib/fsj";
import { translator, type Locale } from "@/lib/i18n";
import { Card, CardHeader, cn } from "@/components/ui";
import { IconPhone } from "@/components/icons";

/**
 * The FSJ / BFD journey on the student portal home: which of the 18 steps the
 * student is at, in plain words, what comes next, and who to ring. Nothing
 * internal crosses over: no department owners, no addresses, no notices.
 */
export function FsjJourney({
  locale,
  programme,
  application,
  counsellor,
}: {
  locale: Locale;
  programme: string;
  application: { statusCode: string; statusLabel: string };
  counsellor: { name: string; phone: string | null } | null;
}) {
  const t = translator(locale);
  const step = fsjStepOf(application.statusCode);
  const i = step ? FSJ_STEPS.findIndex((s) => s.step === step.step) : -1;
  const after = i >= 0 && i + 1 < FSJ_STEPS.length ? FSJ_STEPS[i + 1] : null;
  // A status the guide does not place (on hold for an intake) has no step, so
  // the status's own student label stands in.
  const nowLine = step ? FSJ_STUDENT_STEP[step.step] : application.statusLabel;
  const nextLine = step ? (after ? FSJ_STUDENT_STEP[after.step] : t("lastStep")) : null;
  return (
    <Card data-fsj-journey data-current-step={step?.step ?? ""} data-programme={programme}>
      <CardHeader title={`${t("fsjJourney")} (${programme})`} subtitle={t("fsjJourneyNote")} />
      {step && (
        <div className="px-4 pt-4" aria-label={`${t("fsjStepOf")} ${step.step} / ${FSJ_STEP_COUNT}`}>
          <div className="flex gap-0.5" aria-hidden="true">
            {FSJ_STEPS.map((s) => (
              <span key={s.step} className={cn("h-1.5 flex-1 rounded-full", s.step < step.step ? "bg-good-500" : s.step === step.step ? "bg-brand-600" : "bg-line")} />
            ))}
          </div>
          <p className="mt-1 text-2xs text-muted">
            {t("fsjStepOf")} {step.step} / {FSJ_STEP_COUNT}
          </p>
        </div>
      )}
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
        {counsellor && (
          <div className="sm:col-span-2">
            <dt className="text-2xs font-semibold uppercase tracking-wider text-muted">{t("whoToContact")}</dt>
            <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-ink">
              {counsellor.name}
              {counsellor.phone && (
                <a href={`tel:${counsellor.phone}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                  <IconPhone className="size-3.5" />
                  {counsellor.phone}
                </a>
              )}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );
}
