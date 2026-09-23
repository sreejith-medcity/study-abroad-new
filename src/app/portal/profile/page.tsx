import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { maskPassport } from "@/lib/permissions";
import { requireStudent } from "@/server/portal";
import { Card, CardHeader, DataList } from "@/components/ui";

export default async function PortalProfile() {
  const { session, student, locale } = await requireStudent();
  const t = translator(locale);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink">{t("profileTitle")}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{t("profileIntro")}</p>
      </div>

      <Card>
        <CardHeader title={student.firstName + " " + student.lastName} subtitle={student.org.name} />
        <DataList
          rows={[
            { label: t("name"), value: `${student.firstName} ${student.lastName}` },
            { label: t("email"), value: student.email ?? t("notGiven") },
            { label: t("phone"), value: student.phone },
            { label: t("dateOfBirth"), value: student.dateOfBirth ? fmtDate(student.dateOfBirth) : t("notGiven") },
            { label: t("city"), value: student.city ?? t("notGiven") },
            // Even to the student, only the masked number: the portal is often
            // open on a shared phone.
            { label: t("passport"), value: student.passportNumber ? maskPassport(student.passportNumber) : t("notGiven") },
            { label: t("passportExpiry"), value: student.passportExpiry ? fmtDate(student.passportExpiry) : t("notGiven") },
          ]}
        />
      </Card>

      <Card className="p-4">
        <p className="text-[13px] leading-relaxed text-muted">{t("callUs")}</p>
        <Link href="/portal/messages" className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
          {t("askCorrection")}
        </Link>
      </Card>

      <Card className="p-4">
        <p className="text-[13px] text-muted">
          {t("signedInAs")} {session.email}
        </p>
        <Link href="/change-password" className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
          {t("changePassword")}
        </Link>
      </Card>
    </div>
  );
}
