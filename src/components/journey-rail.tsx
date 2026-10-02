import type { JourneyStage } from "@/db/schema";
import { cn, Card, Chip } from "@/components/ui";
import { stageRail } from "@/lib/journey-copy";
import { translator, type Locale } from "@/lib/i18n";
import { isSoon, type DateAhead } from "@/lib/family";
import { fmtDate } from "@/lib/format";
import { IconCheck, IconClock } from "@/components/icons";

/**
 * The nine stages as a family reads them, on a phone.
 *
 * One rail, used by the student's own dashboard and by the parent's view, so
 * the two never disagree about where the file has got to. Stages already
 * passed are ticked, the current one is named and explained, and the ones
 * ahead are listed quietly so nobody is surprised by what is coming.
 */
export function JourneyRail({ current, locale }: { current: JourneyStage; locale: Locale }) {
  const t = translator(locale);
  const steps = stageRail(current, locale);
  const now = steps.find((s) => s.position === "NOW") ?? steps[0];

  return (
    <Card className="overflow-hidden">
      <div className="brand-wash grain relative px-4 py-4 md:px-5">
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
            {t("stepOf")} {now.number} {t("outOf")} {steps.length}
          </p>
          <h2 className="mt-0.5 font-display text-[22px] font-semibold text-white">{now.title}</h2>
          <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-white/85">{now.now}</p>
        </div>
      </div>

      <ol className="divide-y divide-line">
        {steps.map((s) => (
          <li key={s.stage} className={cn("flex items-start gap-3 px-4 py-2.5 md:px-5", s.position === "NOW" && "bg-brand-50/60")}>
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                s.position === "DONE" && "bg-emerald-600 text-white",
                s.position === "NOW" && "bg-brand-600 text-white",
                s.position === "AHEAD" && "border border-line bg-surface text-muted",
              )}
            >
              {s.position === "DONE" ? <IconCheck className="size-3.5" /> : s.number}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-[14px]", s.position === "AHEAD" ? "text-muted" : "font-medium text-ink")}>{s.title}</p>
              {s.position === "NOW" && <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{s.now}</p>}
            </div>
            <span className="shrink-0 pt-0.5">
              {s.position === "DONE" && <Chip tone="ok">{t("stepDone")}</Chip>}
              {s.position === "NOW" && <Chip tone="brand">{t("stepNow")}</Chip>}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/**
 * How many days away a date is, said the way somebody says it out loud: today,
 * tomorrow, eleven days left, four days late.
 */
function whenText(d: DateAhead, locale: Locale) {
  const t = translator(locale);
  if (d.inDays === 0) return t("dueToday");
  if (d.inDays === 1) return t("dueTomorrow");
  if (d.inDays < 0) return `${Math.abs(d.inDays)} ${t("daysLate")}`;
  return `${d.inDays} ${t("daysLeft")}`;
}

/** The dates a family should have in their heads, nearest first. */
export function DatesAhead({ dates, locale }: { dates: DateAhead[]; locale: Locale }) {
  const t = translator(locale);
  const label = (d: DateAhead) => {
    switch (d.kind) {
      case "DOCUMENT_DUE":
        return `${d.about} · ${t("dueBy")}`;
      case "OFFER_ACCEPT":
        return t("acceptBy");
      case "COURSE_START":
        return t("courseStarts");
      default:
        return t("visaDecisionDate");
    }
  };

  return (
    <Card className="p-4">
      <h2 className="flex items-center gap-1.5 font-semibold text-ink">
        <IconClock className="size-4 text-brand-600" />
        {t("datesToKeep")}
      </h2>
      {dates.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">{t("noDates")}</p>
      ) : (
        <ul className="mt-2.5 space-y-2">
          {dates.map((d, i) => (
            <li key={`${d.kind}-${d.about ?? ""}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="tabular text-[13px] font-medium text-ink">{fmtDate(d.on)}</span>
              <span className="text-[13px] text-ink-soft">{label(d)}</span>
              <span className={cn("ml-auto text-[12px]", d.inDays < 0 ? "font-medium text-rose-700" : isSoon(d) ? "font-medium text-amber-700" : "text-muted")}>
                {whenText(d, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
