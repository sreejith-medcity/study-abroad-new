import { AU_PAIR_STEPS, AU_PAIR_STUDENT_STEP, auPairStepOf } from "@/lib/au-pair";
import { translator, type Locale } from "@/lib/i18n";
import { StepJourney } from "@/components/step-journey";

/** The Au pair journey on the student portal home: which of the 15 steps the student is at, in plain words. */
export function AuPairJourney({
  locale,
  application,
  counsellor,
}: {
  locale: Locale;
  application: { statusCode: string; statusLabel: string };
  counsellor: { name: string; phone: string | null } | null;
}) {
  const t = translator(locale);
  return (
    <StepJourney
      locale={locale}
      title={t("auPairJourney")}
      note={t("auPairJourneyNote")}
      steps={AU_PAIR_STEPS}
      studentLine={AU_PAIR_STUDENT_STEP}
      stepOf={auPairStepOf}
      application={application}
      counsellor={counsellor}
      dataAttrs={{ "data-au-pair-journey": "true" }}
    />
  );
}
