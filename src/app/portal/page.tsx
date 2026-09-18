import Link from "next/link";
import { fmtDate, intakeLabel } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { requireStudent, studentApplications, studentDocuments, studentTimeline } from "@/server/portal";
import { Card, CardHeader, Chip, EmptyState, StatusBadge } from "@/components/ui";
import { IconApplications, IconCheck, IconClock, IconDoc } from "@/components/icons";

export default async function PortalHome() {
  const { student, locale } = await requireStudent();
  const t = translator(locale);

  const apps = await studentApplications(student.id, locale);
  const [timeline, docs] = await Promise.all([
    studentTimeline(apps.map((a) => a.id), locale),
    studentDocuments(student.id, [...new Set(apps.flatMap((a) => a.requiredDocs ?? []))], locale),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">{t("portal")}</p>
        <h1 className="mt-1 font-display text-[26px] font-semibold text-ink">
          {t("greeting")}, {student.firstName}
        </h1>
      </div>

      {docs.missing.length > 0 && (
        <Card className="border-warn-500/30 bg-warn-50/60">
          <CardHeader
            title={t("needFromYou")}
            subtitle={`${docs.missing.length}`}
            action={
              <Link href="/portal/documents" className="text-[13px] font-medium text-brand-600 hover:underline">
                {t("uploadHere")}
              </Link>
            }
          />
          <ul className="flex flex-wrap gap-1.5 p-4">
            {docs.missing.map((m) => (
              <li key={m.code}>
                <Chip tone="warn">{m.label}</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="space-y-4">
        <h2 className="font-display text-[15px] font-semibold text-ink">{t("yourApplications")}</h2>
        {apps.length === 0 ? (
          <Card>
            <EmptyState title={t("yourApplications")} icon={<IconApplications className="size-5" />}>
              {t("noApplications")}
            </EmptyState>
          </Card>
        ) : (
          apps.map((a) => {
            const steps = timeline.filter((s) => s.applicationId === a.id);
            return (
              <Card key={a.id}>
                <CardHeader
                  title={a.university}
                  subtitle={`${a.program} · ${a.country}`}
                  action={<StatusBadge group={a.statusGroup} label={a.statusLabel} />}
                />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line px-4 py-3 text-[13px] sm:grid-cols-3">
                  <div>
                    <dt className="text-muted">{t("intake")}</dt>
                    <dd className="font-medium">{intakeLabel(a.intakeMonth, a.intakeYear)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("reference")}</dt>
                    <dd className="ack font-medium">{a.ackNo}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">{t("updated")}</dt>
                    <dd className="font-medium">{fmtDate(a.changedAt)}</dd>
                  </div>
                </dl>
                <div className="p-4">
                  <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{t("milestones")}</p>
                  {steps.length === 0 ? (
                    <p className="text-[13px] text-muted">{t("nothingYet")}</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {steps.map((s) => (
                        <li key={s.id} className="flex items-start gap-2.5">
                          <span
                            className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${
                              s.group === "SUCCESS" ? "bg-good-50 text-good-700" : "bg-brand-50 text-brand-600"
                            }`}
                          >
                            {s.group === "SUCCESS" ? <IconCheck className="size-3" /> : <IconClock className="size-3" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[13px] font-medium text-ink">{s.label}</span>
                            <span className="block text-xs text-muted">{fmtDate(s.createdAt)}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </section>

      <Card className="p-4">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <IconDoc className="size-4 text-brand-600" /> {t("counsellor")}
        </h2>
        <p className="mt-2 font-medium">{student.assignedTo?.name ?? student.org.name}</p>
        <p className="text-[13px] text-muted">
          {t("branch")}: {student.org.name}
          {student.org.city ? `, ${student.org.city}` : ""}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("callUs")}</p>
        <Link href="/portal/messages" className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
          {t("messages")}
        </Link>
      </Card>
    </div>
  );
}
