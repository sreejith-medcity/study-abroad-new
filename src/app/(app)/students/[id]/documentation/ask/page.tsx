import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { outstandingForStudent, portalLink, requestsFor } from "@/server/documentation";
import { stageLabel } from "@/lib/journey";
import { Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";
import { AskForm } from "./form";

export const metadata = { title: "Ask the student" };
export const dynamic = "force-dynamic";

export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "MANAGEMENT") {
    return <EmptyState title="Read only">Management can read a student&rsquo;s list but not write to them.</EmptyState>;
  }
  const student = await getStudentForUser(user, id);
  const locale = student.preferredLanguage === "ml" ? "ml" : "en";
  const [items, sent] = await Promise.all([outstandingForStudent(id, locale), requestsFor(id)]);

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Ask ${student.firstName} for what is missing`}
        subtitle="Everything outstanding is ticked. Untick whatever you will collect yourself. One message goes out, with one link, and every reminder afterwards is the same list, shorter."
        actions={<Link href={`/students/${id}/documentation`} className="text-[13px] font-medium text-brand-600 hover:underline">Back to the list</Link>}
      />

      {items.length === 0 ? (
        <EmptyState title="Nothing to ask for">
          Everything owed by {student.firstName} is either in or set aside. What is left is owed by Medcity, the university or the vendor.
        </EmptyState>
      ) : (
        <AskForm
          studentId={id}
          firstName={student.firstName}
          branchName={student.org.name}
          link={portalLink()}
          locale={locale}
          whatsappOptIn={student.whatsappOptIn}
          whatsappAllowed={student.org.studentWhatsappMessages}
          items={items.map((i) => ({
            id: i.id,
            label: i.label,
            labelForStudent: i.labelForStudent,
            reasonForStudent: i.reasonForStudent,
            stage: stageLabel(i.stage),
            state: i.state,
            required: i.required,
            dueOn: i.dueOn,
          }))}
        />
      )}

      {sent.length > 0 && (
        <Card>
          <CardHeader title="What has gone out before" subtitle="Every ask and reminder on this file, newest first." />
          <ul className="divide-y divide-line">
            {sent.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={r.kind === "NUDGE" ? "warn" : "info"}>{r.kind === "NUDGE" ? "Reminder" : "First ask"}</Chip>
                  <Chip>{r.channel === "WHATSAPP" ? "WhatsApp" : "Portal only"}</Chip>
                  <span className="text-xs text-muted">
                    {r.itemCount} document{r.itemCount === 1 ? "" : "s"} · {fmtDate(r.createdAt)} · {r.sentBy ? (r.sentBy.deskLabel ?? r.sentBy.name) : "the portal itself"}
                    {r.dueOn ? ` · wanted by ${fmtDate(r.dueOn)}` : ""}
                    {r.locale === "ml" ? " · in Malayalam" : ""}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{r.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
