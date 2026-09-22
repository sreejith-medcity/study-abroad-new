import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime, fullName } from "@/lib/format";
import { INTERVIEW_KINDS } from "@/lib/interview";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import { aiConfig } from "@/server/ai";
import { RichText } from "@/components/rich-text";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { InterviewPractice } from "./practice";

export const metadata = { title: "Practice interview" };

export default async function InterviewPage({ searchParams }: { searchParams: Promise<{ app?: string; session?: string }> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const sp = await searchParams;
  const cfg = await aiConfig();
  const on = !!cfg && cfg.enabled && cfg.features.interview;
  const scope = isStaff(user) ? undefined : eq(schema.applications.orgId, user.orgId);
  const apps = on
    ? await db.query.applications.findMany({
        where: scope,
        with: { student: { columns: { firstName: true, lastName: true } }, program: { with: { university: { columns: { name: true } } } } },
        orderBy: desc(schema.applications.createdAt),
        limit: 60,
      })
    : [];
  const s = schema.interviewSessions;
  const sessions = await db.query.interviewSessions.findMany({
    where: isStaff(user) ? undefined : eq(s.orgId, user.orgId),
    with: { student: { columns: { firstName: true, lastName: true } } },
    orderBy: desc(s.createdAt),
    limit: 15,
  });
  const open = sp.session ? await db.query.interviewSessions.findFirst({ where: and(eq(s.id, sp.session), isStaff(user) ? undefined : eq(s.orgId, user.orgId)) }) : null;

  return (
    <>
      <PageHeader title="Practice interview" subtitle="A mock credibility, visa or admission interview: six questions from an AI interviewer, then feedback on each answer." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          {on ? (
            <InterviewPractice apps={apps.map((a) => ({ id: a.id, label: `${a.ackNo} · ${fullName(a.student)} · ${a.program.university.name}` }))} preselect={apps.some((a) => a.id === sp.app) ? sp.app : undefined} />
          ) : (
            <EmptyState title="Practice interviews are not switched on">The platform owner switches them on in Settings, Platform.</EmptyState>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="Past practice" />
          {sessions.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-muted">None yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {sessions.map((x) => (
                <li key={x.id} className="px-4 py-2.5 text-[13px]">
                  <Link href={`/interview?session=${x.id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">{INTERVIEW_KINDS[x.kind as keyof typeof INTERVIEW_KINDS] ?? x.kind}</Link>
                  <p className="text-xs text-muted">{x.student ? fullName(x.student) : "General practice"} · {fmtDateTime(x.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {open && (
        <Card className="mt-5" id="session">
          <CardHeader title={INTERVIEW_KINDS[open.kind as keyof typeof INTERVIEW_KINDS] ?? open.kind} subtitle={open.context} />
          <div className="grid gap-5 p-4 lg:grid-cols-2">
            <ol className="space-y-2 text-[13px]">
              {open.transcript.map((l, i) => (
                <li key={i} className={l.role === "interviewer" ? "font-medium text-ink" : "pl-4 text-ink-soft"}>{l.role === "interviewer" ? "Q: " : "A: "}{l.text}</li>
              ))}
            </ol>
            <RichText text={open.feedback} className="text-[14px] leading-relaxed" />
          </div>
        </Card>
      )}
    </>
  );
}
