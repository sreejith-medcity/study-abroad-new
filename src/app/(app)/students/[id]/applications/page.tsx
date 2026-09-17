import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { summarise } from "@/lib/checks";
import { fmtDate, fmtDateTime, fmtMoney, intakeLabel } from "@/lib/format";
import { isStaff } from "@/lib/permissions";
import { checkApplication, statusesFor } from "@/server/applications";
import { getStudentForUser } from "@/server/queries";
import { Button, Card, Chip, EmptyState, Select, StatusBadge, cn } from "@/components/ui";
import { markFeePaidAction, setDocumentTypeAction } from "./actions";
import { ApplyForm, CommentComposer, StatusForm } from "./client";

export const metadata = { title: "Applications" };

export default async function StudentApplicationsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ app?: string; tab?: string; ch?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(["ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR"]);
  const student = await getStudentForUser(user, id);
  const canWrite = user.role !== "MANAGEMENT";

  const apps = await db.query.applications.findMany({
    where: eq(schema.applications.studentId, id),
    with: { status: true, program: { with: { university: { with: { country: true } } } }, officer: { columns: { name: true, phone: true, deskLabel: true } } },
    orderBy: desc(schema.applications.createdAt),
  });

  const tab = sp.tab === "apply" || apps.length === 0 ? "apply" : "applied";
  const selected = apps.find((a) => a.id === sp.app) ?? apps[0];
  const channel = sp.ch === "STUDENT" ? "STUDENT" : "TEAM";

  return (
    <Card>
      <div className="flex justify-center gap-8 border-b border-line" role="tablist">
        <TabLink href={`/students/${id}/applications?tab=apply`} active={tab === "apply"}>Apply to programs</TabLink>
        <TabLink href={`/students/${id}/applications`} active={tab === "applied"}>Applied programs ({apps.length})</TabLink>
      </div>

      {tab === "apply" ? (
        <div className="mx-auto max-w-2xl p-5">
          {canWrite ? <ApplyPanel studentId={id} defaultPathway={student.preferredPathway ?? ""} /> : <EmptyState title="Read-only access" />}
        </div>
      ) : selected ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="space-y-3">
            {apps.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/students/${id}/applications?app=${a.id}`}
                  aria-current={a.id === selected.id ? "true" : undefined}
                  className={cn("block overflow-hidden rounded-md border bg-white", a.id === selected.id ? "border-brand-600 ring-2 ring-brand-100" : "border-line hover:border-brand-500")}
                >
                  <div className="border-b border-line px-3 py-1.5"><StatusBadge group={a.status.group} label={a.status.label} /></div>
                  <dl className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 px-3 py-2 text-xs">
                    <dt className="text-muted">Ack. no</dt><dd className="tabular">{a.ackNo}</dd>
                    <dt className="text-muted">Date</dt><dd>{fmtDateTime(a.createdAt)}</dd>
                    <dt className="text-muted">Course</dt><dd>{a.program.name}</dd>
                    <dt className="text-muted">University</dt><dd>{a.program.university.name}</dd>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
          <ApplicationDetail appId={selected.id} studentId={id} channel={channel} userRole={user.role} staff={isStaff(user)} canWrite={canWrite} whatsapp={student.whatsappOptIn} />
        </div>
      ) : null}
    </Card>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} role="tab" aria-selected={active} className={cn("-mb-px border-b-2 px-2 py-3 font-medium", active ? "border-brand-600 text-brand-600" : "border-transparent text-muted hover:text-ink")}>
      {children}
    </Link>
  );
}

async function ApplyPanel({ studentId, defaultPathway }: { studentId: string; defaultPathway: string }) {
  const rows = await db.query.programs.findMany({
    where: eq(schema.programs.status, "LIVE"),
    with: { university: { with: { country: true } } },
    orderBy: asc(schema.programs.name),
  });
  const programs = rows.map((p) => ({
    id: p.id,
    name: p.name,
    university: p.university.name,
    country: p.university.country.name,
    pathway: p.pathway,
    intakeMonths: p.intakeMonths,
    tuition: p.tuitionPerYear ? `${fmtMoney(p.tuitionPerYear, p.university.country.currency)}/yr` : "No tuition fee",
    requirements: [
      p.minIelts && `IELTS ${p.minIelts}`,
      p.minPte && `PTE ${p.minPte}`,
      p.minOetGrade && `OET ${p.minOetGrade}`,
      p.minGermanLevel && `German ${p.minGermanLevel}`,
      p.maxBacklogs != null && `backlogs ≤ ${p.maxBacklogs}`,
      p.moiAccepted && "MOI accepted",
    ].filter(Boolean).join(", "),
  }));
  return (
    <>
      <h2 className="mb-3 text-base font-semibold">Start a new application</h2>
      <ApplyForm studentId={studentId} programs={programs} defaultPathway={defaultPathway} />
    </>
  );
}

async function ApplicationDetail({ appId, studentId, channel, userRole, staff, canWrite, whatsapp }: { appId: string; studentId: string; channel: "TEAM" | "STUDENT"; userRole: string; staff: boolean; canWrite: boolean; whatsapp: boolean }) {
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, appId),
    with: {
      status: true,
      program: { with: { university: { with: { country: true } } } },
      officer: { columns: { name: true, phone: true, deskLabel: true } },
      history: { with: { toStatus: true, changedBy: { columns: { name: true } } }, orderBy: desc(schema.statusHistory.createdAt) },
    },
  });
  if (!app) return null;

  const comments = await db.query.comments.findMany({
    where: and(eq(schema.comments.applicationId, appId), eq(schema.comments.channel, channel)),
    with: { author: { columns: { name: true, role: true, deskLabel: true } }, attachments: true },
    orderBy: asc(schema.comments.createdAt),
  });
  const docTypes = await db.select().from(schema.documentTypes).orderBy(asc(schema.documentTypes.sortOrder));
  const checks = await checkApplication(appId);
  const { blockers, warnings } = summarise(checks);
  const statuses = userRole === "ADMIN" ? await statusesFor(app.status.pathway) : [];
  const currency = app.program.university.country.currency;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted">{fmtDateTime(app.createdAt)}</p>
            <p className="text-lg font-semibold tabular">{app.ackNo}</p>
            <p className="text-base">{app.program.name}</p>
            <p className="text-muted">{app.program.university.name}, {app.program.university.country.name} · {intakeLabel(app.intakeMonth, app.intakeYear)}</p>
          </div>
          <div className="text-right">
            <StatusBadge group={app.status.group} label={app.status.label} className="text-sm" />
            <p className="mt-1 text-xs text-muted">since {fmtDate(app.statusChangedAt)}</p>
            {app.deadline && <p className="mt-1 text-xs text-red-600">Deadline {fmtDate(app.deadline)}</p>}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <span className="text-muted">Application fee:</span>
          {app.feeStatus === "NOT_APPLICABLE" ? <Chip tone="ok">No application fee</Chip> : app.feeStatus === "PAID" ? <Chip tone="ok">Paid {fmtMoney(app.program.applicationFee, currency)}</Chip> : <Chip tone="warn">Due {fmtMoney(app.program.applicationFee, currency)}</Chip>}
          {app.feeStatus === "DUE" && userRole === "ADMIN" && (
            <form action={markFeePaidAction}><input type="hidden" name="applicationId" value={app.id} /><Button variant="quiet" className="py-1 text-xs">Mark paid</Button></form>
          )}
          <span className="ml-auto text-muted">Officer: {app.officer ? `${app.officer.name}${app.officer.phone ? ` · ${app.officer.phone}` : ""}` : "not assigned yet"}</span>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Pre-submission check</h3>
            {blockers > 0 ? <Chip tone="bad">{blockers} blocker{blockers > 1 ? "s" : ""}</Chip> : warnings > 0 ? <Chip tone="warn">{warnings} warning{warnings > 1 ? "s" : ""}</Chip> : <Chip tone="ok">Ready</Chip>}
          </div>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.code} className="flex items-start gap-2">
                <Chip tone={c.severity === "blocker" ? "bad" : c.severity === "warning" ? "warn" : "ok"} className="shrink-0">{c.severity === "blocker" ? "Blocker" : c.severity === "warning" ? "Warning" : "Pass"}</Chip>
                <span>{c.message}</span>
              </li>
            ))}
            {checks.length === 0 && <li className="text-muted">No rules configured for this program.</li>}
          </ul>
          {staff && userRole === "ADMIN" && <Link href={`/admin/applications/${app.id}/check`} className="mt-3 inline-block text-brand-600 hover:underline">Open check and ask partner</Link>}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 font-semibold">Status</h3>
          {userRole === "ADMIN" && canWrite && (
            <div className="mb-3 border-b border-line pb-3">
              <StatusForm applicationId={app.id} currentId={app.statusId} statuses={statuses.map((s) => ({ id: s.id, label: s.label, requiresReason: s.requiresReason, isMilestone: s.isMilestone }))} />
            </div>
          )}
          <ol className="space-y-2">
            {app.history.map((h) => (
              <li key={h.id} className="flex items-start gap-2">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
                <div>
                  <p>{h.toStatus.label}</p>
                  <p className="text-xs text-muted">{fmtDateTime(h.createdAt)} · {h.changedBy.name}{h.reason ? ` · ${h.reason}` : ""}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-6 border-b border-line px-4">
          <h3 className="py-3 font-semibold text-brand-600">Comments</h3>
          <div className="ml-auto flex gap-4" role="tablist">
            <TabLink href={`/students/${studentId}/applications?app=${app.id}&ch=TEAM`} active={channel === "TEAM"}>Team</TabLink>
            <TabLink href={`/students/${studentId}/applications?app=${app.id}&ch=STUDENT`} active={channel === "STUDENT"}>Student{whatsapp ? " · WhatsApp" : ""}</TabLink>
          </div>
        </div>
        <div className="space-y-4 p-4">
          {canWrite && <CommentComposer applicationId={app.id} channel={channel} whatsapp={whatsapp} />}
          <ul className="space-y-3">
            {[...comments].reverse().map((c) => {
              const mine = c.author && (c.author.role === "PARTNER" || c.author.role === "COUNSELLOR");
              const fromStudent = c.source === "WHATSAPP";
              const system = c.source === "SYSTEM";
              return (
                <li key={c.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-lg px-3 py-2", system ? "bg-ground text-muted" : fromStudent ? "bg-emerald-50" : mine ? "bg-slate-100" : "bg-brand-50")}>
                    <p className="text-xs font-semibold">
                      {fromStudent ? c.authorLabel ?? "Student (WhatsApp)" : c.author ? c.author.deskLabel ?? c.author.name : "System"}
                      {fromStudent && <span className="ml-1 font-normal text-emerald-700">via WhatsApp</span>}
                    </p>
                    <p className="whitespace-pre-wrap">{c.body}</p>
                    {c.attachments.map((d) => (
                      <div key={d.id} className="mt-2 flex flex-wrap items-center gap-2">
                        <a href={`/api/documents/${d.id}`} className="rounded bg-white px-2 py-1 text-xs text-brand-600 hover:underline">📎 {d.fileName}</a>
                        {canWrite && (!d.typeCode || d.typeCode === "OTHER") && (
                          <form action={setDocumentTypeAction} className="flex items-center gap-1">
                            <input type="hidden" name="documentId" value={d.id} />
                            <Select name="typeCode" aria-label="File as" className="py-1 text-xs" defaultValue="">
                              <option value="" disabled>File as…</option>
                              {docTypes.filter((t) => t.code !== "OTHER").map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                            </Select>
                            <Button variant="secondary" className="px-2 py-1 text-xs">File</Button>
                          </form>
                        )}
                      </div>
                    ))}
                    <p className="mt-1 text-[11px] text-muted">{fmtDateTime(c.createdAt)}{c.deliveredAt ? " · delivered on WhatsApp" : ""}</p>
                  </div>
                </li>
              );
            })}
            {comments.length === 0 && <li className="py-4 text-center text-muted">No {channel === "TEAM" ? "team" : "student"} messages yet.</li>}
          </ul>
        </div>
      </Card>
    </div>
  );
}
