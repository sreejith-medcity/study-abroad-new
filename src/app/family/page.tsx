import Link from "next/link";
import { fmtDate, fmtMoney, intakeLabel } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { datesAhead } from "@/lib/family";
import { DatesAhead, JourneyRail } from "@/components/journey-rail";
import { requireGuardian, familyMoney } from "@/server/family";
import { studentApplications, studentChecklist } from "@/server/portal";
import { Alert, Card, CardHeader, Chip, EmptyState, StatusBadge } from "@/components/ui";
import { IconApplications, IconDoc } from "@/components/icons";

/**
 * What a parent sees: where the file stands, what is still wanted from the
 * student, the dates that matter, and the branch to ring. Read only, and the
 * page says so in the first line rather than leaving them hunting for a button
 * that is not there.
 */
export default async function FamilyHome() {
  const { student, guardian, locale } = await requireGuardian();
  const t = translator(locale);

  const apps = await studentApplications(student.id, locale);
  const [checklist, money] = await Promise.all([studentChecklist(student.id, locale), guardian.seesMoney ? familyMoney(student.id) : Promise.resolve([])]);
  const dates = datesAhead(
    { documents: checklist.outstanding.map((o) => ({ label: o.label, dueOn: o.dueOn })), applications: apps },
    new Date(),
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">{t("familyView")}</p>
        <h1 className="mt-1 font-display text-[26px] font-semibold text-ink">
          {student.firstName} {student.lastName}
        </h1>
        <p className="mt-1 text-[13px] text-muted">{t("familyIntro")}</p>
      </div>

      <JourneyRail current={student.journeyStage} locale={locale} />

      {checklist.outstanding.length > 0 ? (
        <Card className="border-warn-500/30 bg-warn-50/60">
          <CardHeader title={t("stillWanted")} subtitle={`${checklist.outstanding.length}`} />
          <ul className="divide-y divide-line/60">
            {checklist.outstanding.map((o) => (
              <li key={o.code} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-[13px]">
                <span className="font-medium text-ink">{o.label}</span>
                {o.sentBack && <Chip tone="bad">{t("sendAgain")}</Chip>}
                {o.dueOn && <span className="ml-auto tabular text-[12px] text-muted">{t("dueBy")} {fmtDate(o.dueOn)}</span>}
              </li>
            ))}
          </ul>
          <p className="border-t border-line/60 px-4 py-2.5 text-[12.5px] leading-relaxed text-ink-soft">{t("onlyStudentUploads")}</p>
        </Card>
      ) : (
        <Alert tone="ok">{t("nothingWanted")}</Alert>
      )}

      <DatesAhead dates={dates} locale={locale} />

      <section className="space-y-3">
        <h2 className="font-display text-[15px] font-semibold text-ink">{t("yourApplications")}</h2>
        {apps.length === 0 ? (
          <Card>
            <EmptyState title={t("yourApplications")} icon={<IconApplications className="size-5" />}>
              {t("noApplications")}
            </EmptyState>
          </Card>
        ) : (
          apps.map((a) => (
            <Card key={a.id}>
              <CardHeader title={a.university} subtitle={`${a.program} · ${a.country}`} action={<StatusBadge group={a.statusGroup} label={a.statusLabel} />} />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 text-[13px] sm:grid-cols-3">
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
                {a.offerType && (
                  <div>
                    <dt className="text-muted">{t(a.offerType === "UNCONDITIONAL" ? "unconditionalOffer" : "conditionalOffer")}</dt>
                    <dd className="font-medium">{a.offerAcceptBy ? `${t("acceptBy")}: ${fmtDate(a.offerAcceptBy)}` : "✓"}</dd>
                  </div>
                )}
                {(a.visaLodgedOn || a.visaDecision) && (
                  <div>
                    <dt className="text-muted">{t("visa")}</dt>
                    <dd className="font-medium">
                      {a.visaDecision ? t(a.visaDecision === "GRANTED" ? "visaGranted" : "visaRefused") : t("visaLodged")}
                    </dd>
                  </div>
                )}
              </dl>
            </Card>
          ))
        )}
      </section>

      {guardian.seesMoney && (
        <Card className="p-4">
          <h2 className="font-display text-[15px] font-semibold text-ink">{t("feesAndPayments")}</h2>
          {money.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted">{t("noDates")}</p>
          ) : (
            <ul className="mt-2.5 divide-y divide-line">
              {money.map((m) => (
                <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-[13px]">
                  <span className="font-medium text-ink">{m.kind.replace(/_/g, " ").toLowerCase()}</span>
                  {/* What has been asked for and what has been paid. A figure the
                      team is only expecting is not a bill, so it stays in the office
                      until it is invoiced rather than reading as money owed. */}
                  <span className="ml-auto tabular">
                    {m.receivedAmount != null ? (
                      <span className="text-good-700">
                        {t("paid")} {fmtMoney(m.receivedAmount, m.currency)}
                      </span>
                    ) : m.invoicedAmount != null ? (
                      <span>
                        {t("due")} {fmtMoney(m.invoicedAmount, m.currency)}
                      </span>
                    ) : (
                      <span className="text-muted">{t("notConfirmed")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="p-4">
        <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
          <IconDoc className="size-4 text-brand-600" /> {t("counsellor")}
        </h2>
        <p className="mt-2 font-medium">{student.assignedTo?.name ?? student.org.name}</p>
        <p className="text-[13px] text-muted">
          {t("branch")}: {student.org.name}
          {student.org.city ? `, ${student.org.city}` : ""}
        </p>
        {student.org.contactPhone && <p className="mt-1 text-[13px] tabular text-ink-soft">{student.org.contactPhone}</p>}
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{t("callUs")}</p>
        <Link href="/family/documents" className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
          {t("documents")}
        </Link>
      </Card>
    </div>
  );
}
