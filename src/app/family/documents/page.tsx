import { fmtDate } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { requireGuardian } from "@/server/family";
import { studentChecklist } from "@/server/portal";
import { Alert, Card, CardHeader, Chip } from "@/components/ui";

/**
 * The document list as a parent reads it: what is still wanted, what is with
 * Medcity being checked, and what is done. The files themselves are not opened
 * here; a parent chases, the student uploads.
 */
export default async function FamilyDocuments() {
  const { student, locale } = await requireGuardian();
  const t = translator(locale);
  const checklist = await studentChecklist(student.id, locale);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">{t("familyView")}</p>
        <h1 className="mt-1 font-display text-[26px] font-semibold text-ink">{t("documentsTitle")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("onlyStudentUploads")}</p>
      </div>

      {checklist.outstanding.length === 0 ? (
        <Alert tone="ok">{t("nothingWanted")}</Alert>
      ) : (
        <Card className="border-warn-500/30">
          <CardHeader title={t("stillWanted")} subtitle={`${checklist.outstanding.length}`} />
          <ul className="divide-y divide-line">
            {checklist.outstanding.map((o) => (
              <li key={o.code} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[14px] font-medium text-ink">{o.label}</span>
                  {o.sentBack ? <Chip tone="bad">{t("sendAgain")}</Chip> : o.asked ? <Chip tone="warn">{t("askedFor")}</Chip> : null}
                  {o.dueOn && <span className="ml-auto tabular text-[12px] text-muted">{t("dueBy")} {fmtDate(o.dueOn)}</span>}
                </div>
                {o.reason && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{o.reason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {checklist.withUs.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold text-ink">{t("beingChecked")}</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {checklist.withUs.map((label) => (
              <li key={label}>
                <Chip tone="info">{label}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {checklist.done.length > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold text-ink">{t("alreadyDone")}</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {checklist.done.map((label) => (
              <li key={label}>
                <Chip tone="ok">{label}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
