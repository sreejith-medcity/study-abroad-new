import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { getStudentForUser } from "@/server/queries";
import { studentTimeline } from "@/server/timeline";
import { assignableUsers, contactsFor, taskList } from "@/server/tasks";
import { CHANNEL_LABEL, OUTCOME_LABEL, TASK_KIND_LABEL, TIMELINE_LABEL, whenDue } from "@/lib/crm";
import { Card, CardHeader, Chip, EmptyState, Table, Td, Th } from "@/components/ui";
import { AddTask, LogContact, TaskRowActions } from "@/components/crm-forms";

export const metadata = { title: "Timeline" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "neutral" | "info" | "warn" | "bad" | "ok" | "brand"> = {
  CONTACT: "brand",
  COMMENT: "info",
  DOCUMENT: "neutral",
  CHECKLIST: "info",
  REQUEST: "warn",
  STATUS: "ok",
  VENDOR_UPDATE: "ok",
  HANDOVER: "brand",
  STAGE: "ok",
  TASK: "neutral",
  PAYMENT: "ok",
  APPLICATION: "info",
};

export default async function TimelinePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ only?: string }> }) {
  const { id } = await params;
  const { only } = await searchParams;
  const user = await requireUser([...APP_ROLES]);
  const student = await getStudentForUser(user, id);
  const canWrite = user.role !== "MANAGEMENT";
  const [entries, contacts, tasks, people] = await Promise.all([
    studentTimeline(id),
    contactsFor(id, 20),
    taskList(isStaff(user) ? {} : { orgId: user.orgId }, { studentId: id, done: "1" }),
    assignableUsers(user),
  ]);
  const shown = only ? entries.filter((e) => e.kind === only) : entries;
  const kinds = [...new Set(entries.map((e) => e.kind))];
  const openTasks = tasks.filter((t) => !t.doneAt);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="font-semibold">The whole story</h1>
            <p className="text-xs text-muted">
              Every call, message, document, status change and vendor reply in one feed, assembled from what is already recorded rather than written twice.
            </p>
          </div>
          {canWrite && (
            <div className="ml-auto flex flex-wrap gap-2">
              <LogContact studentId={id} studentName={student.firstName} />
              <AddTask people={people} defaultAssignee={student.assignedToId ?? user.id} studentId={id} />
            </div>
          )}
        </div>
      </Card>

      {openTasks.length > 0 && (
        <Card>
          <CardHeader title="Waiting on somebody" subtitle="Open tasks against this student." />
          <ul className="divide-y divide-line">
            {openTasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted">
                    {TASK_KIND_LABEL[t.kind]} · due {fmtDate(t.dueOn)} · for {t.assignedTo}
                    {whenDue(t.dueOn) === "OVERDUE" ? " · overdue" : ""}
                    {t.source !== "by hand" ? ` · raised by ${t.source}` : ""}
                  </p>
                </div>
                {canWrite && <TaskRowActions task={{ id: t.id }} done={false} />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {contacts.length > 0 && (
        <Card>
          <CardHeader title="Conversations" subtitle="How this student has been spoken to, and what came of it." />
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>How</Th>
                <Th>What came of it</Th>
                <Th>Note</Th>
                <Th>Next</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <Td className="whitespace-nowrap text-xs tabular">{fmtDateTime(c.happenedAt)}</Td>
                  <Td className="text-xs">{CHANNEL_LABEL[c.channel]}{c.inbound ? " in" : ""}</Td>
                  <Td><Chip tone={c.outcome === "NO_ANSWER" || c.outcome === "WRONG_NUMBER" ? "warn" : c.outcome === "NOT_INTERESTED" ? "bad" : "ok"}>{OUTCOME_LABEL[c.outcome]}</Chip></Td>
                  <Td className="max-w-sm text-[13px]">{c.note ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-xs">{c.nextActionOn ? `${fmtDate(c.nextActionOn)}${c.nextActionNote ? `: ${c.nextActionNote}` : ""}` : "—"}</Td>
                  <Td className="text-xs">{c.by ? (c.by.deskLabel ?? c.by.name) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card>
        <CardHeader title={`Everything, newest first (${shown.length})`} />
        <div className="flex flex-wrap gap-2 border-b border-line px-4 pb-3">
          <Link href={`/students/${id}/timeline`} className={!only ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}>
            Everything
          </Link>
          {kinds.map((k) => (
            <Link
              key={k}
              href={`/students/${id}/timeline?only=${k}`}
              className={only === k ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}
            >
              {TIMELINE_LABEL[k]}
            </Link>
          ))}
        </div>
        {shown.length === 0 ? (
          <EmptyState title="Nothing yet">Everything that happens on this file appears here as it happens.</EmptyState>
        ) : (
          <ol className="divide-y divide-line">
            {shown.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className="w-36 shrink-0 text-xs tabular text-muted">{fmtDateTime(e.at)}</span>
                <Chip tone={TONE[e.kind] ?? "neutral"} className="shrink-0">{TIMELINE_LABEL[e.kind]}</Chip>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {e.href ? (
                      <a href={e.href} className="text-brand-600 hover:underline">{e.title}</a>
                    ) : (
                      e.title
                    )}
                  </p>
                  {e.detail && <p className="mt-0.5 text-[13px] text-muted">{e.detail}</p>}
                </div>
                {e.who && <span className="shrink-0 text-xs text-muted">{e.who}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
