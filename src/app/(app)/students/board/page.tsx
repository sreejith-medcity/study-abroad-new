import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES, isStaff, orgScope } from "@/lib/permissions";
import { STAGES, stageLabel } from "@/lib/journey";
import { lastContactFor, openTasksFor } from "@/server/tasks";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Students by stage" };
export const dynamic = "force-dynamic";

/** How long since anybody spoke to them, in the words somebody would use. */
function since(at: Date | null) {
  if (!at) return "never spoken to";
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 0) return "spoken to today";
  if (days === 1) return "spoken to yesterday";
  if (days < 30) return `${days} days since a word`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} since a word`;
}

/**
 * The nine stages as columns, every student a card.
 *
 * It answers the question a branch owner actually asks: where is everybody, and
 * which files has nobody touched. Moving a student along happens on their own
 * file, where the gate and its reasons are, rather than by dragging a card past
 * the rules.
 */
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ branch?: string; who?: string; quiet?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const st = schema.students;

  const rows = await db
    .select({
      id: st.id,
      firstName: st.firstName,
      lastName: st.lastName,
      stage: st.journeyStage,
      stageEnteredAt: st.stageEnteredAt,
      branch: schema.organizations.name,
      orgId: st.orgId,
      assignedTo: schema.users.name,
      assignedToDesk: schema.users.deskLabel,
      assignedToId: st.assignedToId,
      apps: sql<number>`(select count(*) from ${schema.applications} a where a.student_id = ${st.id})`.mapWith(Number),
    })
    .from(st)
    .innerJoin(schema.organizations, eq(schema.organizations.id, st.orgId))
    .leftJoin(schema.users, eq(schema.users.id, st.assignedToId))
    .where(
      and(
        eq(st.archived, false),
        orgScope(user, st.orgId),
        sp.branch ? eq(st.orgId, sp.branch) : undefined,
        sp.who ? eq(st.assignedToId, sp.who) : undefined,
      ),
    )
    .orderBy(asc(st.firstName))
    .limit(600);

  const ids = rows.map((r) => r.id);
  const [contacts, tasks, branches, counsellors] = await Promise.all([
    lastContactFor(ids),
    openTasksFor(ids),
    isStaff(user)
      ? db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).orderBy(asc(schema.organizations.name))
      : Promise.resolve([]),
    db
      .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel })
      .from(schema.users)
      .where(and(eq(schema.users.active, true), inArray(schema.users.role, ["PARTNER", "COUNSELLOR"]), isStaff(user) ? undefined : eq(schema.users.orgId, user.orgId)))
      .orderBy(asc(schema.users.name))
      .limit(60),
  ]);

  const cards = rows.map((r) => {
    const last = contacts.get(r.id) ?? null;
    const days = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null;
    return { ...r, last, quiet: days === null || days >= 14, tasks: tasks.get(r.id) ?? { open: 0, overdue: 0 } };
  });
  const shown = sp.quiet === "1" ? cards.filter((c) => c.quiet) : cards;

  const href = (next: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { branch: sp.branch, who: sp.who, quiet: sp.quiet, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const q = params.toString();
    return `/students/board${q ? `?${q}` : ""}`;
  };
  const pill = (on: boolean) => (on ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink");

  return (
    <>
      <PageHeader
        title="Students by stage"
        subtitle="Where everybody is, and which files nobody has touched in a fortnight. A student moves along on their own file, where the gate and its reasons are."
        actions={<Link href="/students" className="text-[13px] font-medium text-brand-600 hover:underline">The list instead</Link>}
      />

      <Card className="mb-3 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={href({ quiet: undefined })} className={pill(sp.quiet !== "1")}>Everybody ({cards.length})</Link>
          <Link href={href({ quiet: "1" })} className={pill(sp.quiet === "1")}>Nobody has spoken to them ({cards.filter((c) => c.quiet).length})</Link>
        </div>
        {branches.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={href({ branch: undefined })} className={pill(!sp.branch)}>Every branch</Link>
            {branches.map((b) => (
              <Link key={b.id} href={href({ branch: b.id })} className={pill(sp.branch === b.id)}>{b.name}</Link>
            ))}
          </div>
        )}
        {counsellors.length > 1 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={href({ who: undefined })} className={pill(!sp.who)}>Anybody&rsquo;s</Link>
            {counsellors.map((c) => (
              <Link key={c.id} href={href({ who: c.id })} className={pill(sp.who === c.id)}>{c.deskLabel ?? c.name}</Link>
            ))}
          </div>
        )}
      </Card>

      {shown.length === 0 ? (
        <EmptyState title="Nobody here">Register a student, or widen the filters.</EmptyState>
      ) : (
        <div className="overflow-x-auto pb-4" data-print="hide">
          <div className="flex min-w-max gap-3">
            {STAGES.map((s) => {
              const here = shown.filter((c) => c.stage === s.value);
              return (
                <div key={s.value} className="w-72 shrink-0">
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-[13px] font-semibold">{s.number}. {s.label}</h2>
                    <Chip>{here.length}</Chip>
                  </div>
                  <p className="mb-2 text-[11px] leading-snug text-muted">{s.blurb}</p>
                  <div className="space-y-2">
                    {here.map((c) => (
                      <Link
                        key={c.id}
                        href={`/students/${c.id}/timeline`}
                        className="block rounded-lg border border-line bg-surface p-2.5 hover:border-brand-300"
                      >
                        <p className="font-medium">{c.firstName} {c.lastName}</p>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {isStaff(user) ? `${c.branch} · ` : ""}
                          {c.assignedToDesk ?? c.assignedTo ?? "nobody"}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className={c.quiet ? "font-medium text-amber-700" : "text-muted"}>{since(c.last)}</span>
                          {c.tasks.overdue > 0 && <Chip tone="bad">{c.tasks.overdue} overdue</Chip>}
                          {c.tasks.overdue === 0 && c.tasks.open > 0 && <Chip tone="info">{c.tasks.open} to do</Chip>}
                          {c.apps > 0 && <span className="text-muted">{c.apps} application{c.apps === 1 ? "" : "s"}</span>}
                        </p>
                        {c.stageEnteredAt && <p className="mt-0.5 text-[11px] text-muted">On {stageLabel(c.stage).toLowerCase()} since {fmtDate(c.stageEnteredAt)}</p>}
                      </Link>
                    ))}
                    {here.length === 0 && <p className="rounded-lg border border-dashed border-line p-3 text-[11px] text-muted">Nobody</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
