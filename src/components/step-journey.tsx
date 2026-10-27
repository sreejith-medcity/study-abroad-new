import { translator, type Locale } from "@/lib/i18n";
import { Card, CardHeader, cn } from "@/components/ui";
import { IconPhone } from "@/components/icons";

/**
 * A written process's journey on the student portal home: which step the
 * student is at, in plain words, what comes next, and who to ring. Shared by
 * the FSJ / BFD card and the Au pair card, which pass their own steps and
 * student lines. Nothing internal crosses over: no teams, no addresses, no
 * notices.
 */
export function StepJourney({
  locale,
  title,
  note,
  steps,
  studentLine,
  stepOf,
  application,
  counsellor,
  dataAttrs,
}: {
  locale: Locale;
  title: string;
  note: string;
  steps: { step: number }[];
  studentLine: Record<number, string>;
  stepOf: (code: string) => { step: number } | null;
  application: { statusCode: string; statusLabel: string };
  counsellor: { name: string; phone: string | null } | null;
  /** The card's own data attributes, so each process's browser checks can find it. */
  dataAttrs: Record<string, string>;
}) {
  const t = translator(locale);
  const step = stepOf(application.statusCode);
  const count = steps.length;
  const i = step ? steps.findIndex((s) => s.step === step.step) : -1;
  const after = i >= 0 && i + 1 < steps.length ? steps[i + 1] : null;
  // A status the guide does not place (on hold for an intake) has no step, so
  // the status's own student label stands in.
  const nowLine = step ? studentLine[step.step] : application.statusLabel;
  const nextLine = step ? (after ? studentLine[after.step] : t("lastStep")) : null;
  return (
    <Card {...dataAttrs} data-current-step={step?.step ?? ""}>
      <CardHeader title={title} subtitle={note} />
      {step && (
        <div className="px-4 pt-4" aria-label={`${t("fsjStepOf")} ${step.step} / ${count}`}>
          <div className="flex gap-0.5" aria-hidden="true">
            {steps.map((s) => (
              <span key={s.step} className={cn("h-1.5 flex-1 rounded-full", s.step < step.step ? "bg-good-500" : s.step === step.step ? "bg-brand-600" : "bg-line")} />
            ))}
          </div>
          <p className="mt-1 text-2xs text-muted">
            {t("fsjStepOf")} {step.step} / {count}
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
