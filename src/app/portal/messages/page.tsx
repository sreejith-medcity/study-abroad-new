import { fmtDateTime, intakeLabel } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { requireStudent, studentApplications, studentThread } from "@/server/portal";
import { Card, CardHeader, cn } from "@/components/ui";
import { PortalMessageForm } from "../forms";

export default async function PortalMessages() {
  const { session, student, locale } = await requireStudent();
  const t = translator(locale);
  const apps = await studentApplications(student.id, locale);
  const thread = await studentThread(apps.map((a) => a.id));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[24px] font-semibold text-ink">{t("messagesTitle")}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-muted">{t("messagesIntro")}</p>
      </div>

      <Card>
        <CardHeader title={t("messagesTitle")} subtitle={student.org.name} />
        {thread.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">{t("noMessages")}</p>
        ) : (
          <ul className="space-y-3 p-4">
            {thread.map((m) => {
              const mine = m.authorId === session.id || m.source === "WHATSAPP";
              return (
                <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed",
                      mine ? "bg-brand-600 text-white" : "bg-surface-2 text-ink",
                    )}
                  >
                    <p className={cn("mb-0.5 text-[11px] font-semibold", mine ? "text-white/70" : "text-muted")}>
                      {mine ? t("you") : (m.authorName ?? t("team"))}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className={cn("mt-1 text-[11px]", mine ? "text-white/60" : "text-muted")}>{fmtDateTime(m.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {apps.length > 0 && (
          <div className="border-t border-line p-4">
            <PortalMessageForm
              applications={apps.map((a) => ({ id: a.id, label: `${a.university} · ${intakeLabel(a.intakeMonth, a.intakeYear)}` }))}
              placeholder={t("writeMessage")}
              sendLabel={t("send")}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
