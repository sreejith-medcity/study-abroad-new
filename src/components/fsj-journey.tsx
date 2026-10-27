import { FSJ_STEPS, FSJ_STUDENT_STEP, fsjStepOf } from "@/lib/fsj";
import { translator, type Locale } from "@/lib/i18n";
import { StepJourney } from "@/components/step-journey";

/**
 * The FSJ / BFD journey on the student portal home: which of the 18 steps the
 * student is at, in plain words, what comes next, and who to ring. Drawn by
 * StepJourney, which the Au pair card shares.
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
  return (
    <StepJourney
      locale={locale}
      title={`${t("fsjJourney")} (${programme})`}
      note={t("fsjJourneyNote")}
      steps={FSJ_STEPS}
      studentLine={FSJ_STUDENT_STEP}
      stepOf={fsjStepOf}
      application={application}
      counsellor={counsellor}
      dataAttrs={{ "data-fsj-journey": "true", "data-programme": programme }}
    />
  );
}
