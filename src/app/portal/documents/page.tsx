import { fmtDate } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { requireStudent, studentApplications, studentDocuments } from "@/server/portal";
import { Alert, Card, CardHeader, Chip } from "@/components/ui";
import { IconCheck } from "@/components/icons";
import { PortalUploadForm } from "../forms";

export default async function PortalDocuments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { student, locale } = await requireStudent();
  const t = translator(locale);
  const sp = await searchParams;
  const uploadedCode = (Array.isArray(sp.uploaded) ? sp.uploaded[0] : sp.uploaded) ?? null;
  const apps = await studentApplications(student.id, locale);
  const required = [...new Set(apps.flatMap((a) => a.requiredDocs ?? []))];
  const docs = await studentDocuments(student.id, required, locale);
  const justUploaded = uploadedCode ? (docs.rows.find((r) => r.code === uploadedCode) ?? null) : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink">{t("documentsTitle")}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{t("documentsIntro")}</p>
      </div>

      {justUploaded && (
        <Alert tone="ok" title={`${justUploaded.label}: ${t("uploaded")}`}>
          {t("weHaveIt")}
        </Alert>
      )}

      <Card>
        <CardHeader
          title={t("required")}
          subtitle={`${docs.missing.length}`}
        />
        {docs.missing.length === 0 ? (
          <p className="flex items-center gap-2 px-4 py-6 text-[14px] text-good-700">
            <IconCheck className="size-4" /> {t("allDocumentsIn")}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {docs.rows
              .filter((r) => !r.document && !r.byTeam)
              .map((r) => (
                <li key={r.code} className="px-4 py-3.5">
                  <p className="font-medium">{r.label}</p>
                  {r.guidance && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{r.guidance}</p>}
                  {r.hasSample && (
                    <a href={`/api/document-samples/${r.code}`} target="_blank" rel="noreferrer" className="text-[13px] font-medium text-brand-600 hover:underline">
                      {t("seeSample")}
                    </a>
                  )}
                  <div className="mt-2">
                    <PortalUploadForm typeCode={r.code} label={r.label} chooseLabel={t("chooseFile")} uploadLabel={t("upload")} />
                  </div>
                </li>
              ))}
          </ul>
        )}
      </Card>

      {docs.shared.length > 0 && (
        <Card>
          <CardHeader title={t("sharedWithYou")} subtitle={`${docs.shared.length}`} />
          <ul className="divide-y divide-line">
            {docs.shared.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="font-medium">{d.label ?? d.fileName}</span>
                <span className="text-xs text-muted">{fmtDate(d.createdAt)}</span>
                <a href={`/api/documents/${d.id}`} target="_blank" rel="noreferrer" className="ml-auto text-[13px] font-medium text-brand-600 hover:underline">
                  {t("openFile")}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title={t("received")} subtitle={`${docs.held.length}`} />
        <ul className="divide-y divide-line">
          {docs.rows
            .filter((r) => r.document || r.byTeam)
            .map((r) => (
              <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="font-medium">{r.label}</span>
                {r.document ? (
                  <>
                    <Chip tone="ok">
                      <IconCheck className="size-3.5" /> {t("uploaded")}
                    </Chip>
                    <span className="ml-auto text-xs text-muted">
                      {t("uploadedOn")} {fmtDate(r.document.createdAt)}
                    </span>
                  </>
                ) : (
                  <Chip>{t("teamUploads")}</Chip>
                )}
              </li>
            ))}
          {docs.rows.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-muted">{t("nothingYet")}</li>}
        </ul>
      </Card>
    </div>
  );
}
