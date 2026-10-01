import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { assignableUsers, taskList } from "@/server/tasks";
import { TASK_KIND_LABEL, WHEN_LABEL, WHEN_ORDER, type When } from "@/lib/crm";
import { Card, Chip, EmptyState, PageHeader, Stat } from "@/components/ui";
import { AddTask, TaskRowActions } from "@/components/crm-forms";

export const metadata = { title: "My day" };
export const dynamic = "force-dynamic";

/**
 * What is due, overdue first. Everything that lands here either somebody put
 * there or the portal worked out: a document a week old with no answer, a vendor
 * gone quiet, a gate that came clear and needs the next step taken.
 */
export default async function MyDayPage({ searchParams }: { searchParams: Promise<{ who?: string; done?: string; kind?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const mine = !sp.who || sp.who === user.id;
  const [rows, people] = await Promise.all([
    taskList(isStaff(user) ? {} : { orgId: user.orgId }, { assignedTo: sp.who ?? user.id, done: sp.done, kind: sp.kind }),
    assignableUsers(user),
  ]);

  const open = rows.filter((r) => !r.doneAt);
  const groups = WHEN_ORDER.map((when) => ({ when, rows: open.filter((r) => r.when === when) })).filter((g) => g.rows.length > 0);
  const done = rows.filter((r) => r.doneAt);
  const overdue = open.filter((r) => r.when === "OVERDUE").length;
  const todayCount = open.filter((r) => r.when === "TODAY").length;

  const href = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { who: sp.who, done: sp.done, kind: sp.kind, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const q = params.toString();
    return `/my-day${q ? `?${q}` : ""}`;
  };
  const pill = (on: boolean) => (on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink");

  return (
    <>
      <PageHeader
        title={mine ? "My day" : `${people.find((p) => p.id === sp.who)?.name ?? "Somebody"}'s day`}
        subtitle="Overdue first, then today. A task is either something somebody asked for or something the portal worked out on its own."
        actions={user.role === "MANAGEMENT" ? undefined : <AddTask people={people} defaultAssignee={user.id} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Overdue" value={overdue} tone={overdue > 0 ? "stop" : "good"} />
        <Stat label="Due today" value={todayCount} tone="brand" />
        <Stat label="Open altogether" value={open.length} tone="info" />
      </div>

      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ who: undefined })} className={pill(mine)}>Mine</Link>
          {people
            .filter((p) => p.id !== user.id)
            .slice(0, 12)
            .map((p) => (
              <Link key={p.id} href={href({ who: p.id })} className={pill(sp.who === p.id)}>{p.deskLabel ?? p.name}</Link>
            ))}
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden="true" />
          <Link href={href({ done: sp.done === "1" ? undefined : "1" })} className={pill(sp.done === "1")}>Show what is finished</Link>
        </div>
      </Card>

      {open.length === 0 ? (
        <EmptyState title="Nothing due">Nothing is waiting on you. New tasks appear here the moment somebody raises one, or the portal does.</EmptyState>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.when}>
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <h2 className="font-semibold">{WHEN_LABEL[g.when as When]}</h2>
                <Chip tone={g.when === "OVERDUE" ? "bad" : g.when === "TODAY" ? "warn" : "neutral"}>{g.rows.length}</Chip>
              </div>
              <ul className="divide-y divide-line">
                {g.rows.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{t.title}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {TASK_KIND_LABEL[t.kind]} · due {fmtDate(t.dueOn)}
                        {t.studentId && (
                          <>
                            {" · "}
                            <Link href={`/students/${t.studentId}`} className="text-brand-600 hover:underline">{t.studentName}</Link>
                          </>
                        )}
                        {t.ackNo ? ` · ${t.ackNo}` : ""}
                        {isStaff(user) ? ` · ${t.branch}` : ""}
                        {t.source !== "by hand" ? ` · raised by ${t.source}` : ""}
                        {!mine || t.assignedToId !== user.id ? ` · for ${t.assignedTo}` : ""}
                      </p>
                      {t.detail && <p className="mt-0.5 text-[13px] text-muted">{t.detail}</p>}
                    </div>
                    {user.role !== "MANAGEMENT" && <TaskRowActions task={{ id: t.id }} done={false} />}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {sp.done === "1" && done.length > 0 && (
        <Card className="mt-4">
          <div className="border-b border-line px-4 py-3">
            <h2 className="font-semibold">Finished</h2>
          </div>
          <ul className="divide-y divide-line">
            {done.slice(0, 50).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="text-muted line-through">{t.title}</span>
                {t.studentName && <span className="text-xs text-muted">{t.studentName}</span>}
                <span className="ml-auto text-xs text-muted">{t.doneAt ? fmtDate(t.doneAt) : ""}</span>
                {user.role !== "MANAGEMENT" && <TaskRowActions task={{ id: t.id }} done />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
