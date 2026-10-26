import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { APP_ROLES, PARTNER_ROLES, isStaff } from "@/lib/permissions";
import { STAGES, stageLabel } from "@/lib/journey";
import { lastContactFor, openTasksFor } from "@/server/tasks";
import { studentWhere } from "@/server/queries";
import { can } from "@/server/capabilities";
import { Chip, EmptyState, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { livingTeams } from "@/server/teams";

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
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ branch?: string; who?: string; quiet?: string; team?: string }> }) {
  const user = await requireUser([...APP_ROLES]);
  const sp = await searchParams;
  const st = schema.students;

  // The board is the students list drawn as columns, so it asks the list's
  // own question about who may see whom. It used to apply the branch filter
  // alone, which put every student of Medcity Kottayam in front of a
  // counsellor whose dashboard said she had ten.
  const seesEvery = await can(user, "SEE_EVERY_STUDENT");
  const where = await studentWhere(user, { org: sp.branch, assignedTo: sp.who, team: sp.team });

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
    .where(where)
    .orderBy(asc(st.firstName))
    .limit(600);

  const ids = rows.map((r) => r.id);
  const [contacts, tasks, branches, counsellors, teams] = await Promise.all([
    lastContactFor(ids),
    openTasksFor(ids),
    isStaff(user)
      ? db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).orderBy(asc(schema.organizations.name))
      : Promise.resolve([]),
    // The counsellor picker offers only people whose students the viewer can
    // see. Somebody who sees only their own students is offered nobody but
    // themselves, which is one name, so the picker does not appear at all.
    db
      .select({ id: schema.users.id, name: schema.users.name, deskLabel: schema.users.deskLabel })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.active, true),
          inArray(schema.users.role, [...PARTNER_ROLES]),
          isStaff(user) ? undefined : eq(schema.users.orgId, user.orgId),
          seesEvery ? undefined : eq(schema.users.id, user.id),
        ),
      )
      .orderBy(asc(schema.users.name))
      .limit(60),
    livingTeams(),
  ]);

  const cards = rows.map((r) => {
    const last = contacts.get(r.id) ?? null;
    const days = last ? Math.floor((Date.now() - last.getTime()) / 86_400_000) : null;
    return { ...r, last, quiet: days === null || days >= 14, tasks: tasks.get(r.id) ?? { open: 0, overdue: 0 } };
  });
  const shown = sp.quiet === "1" ? cards.filter((c) => c.quiet) : cards;


  return (
    <>
      <PageHeader
        title="Students by stage"
        subtitle="Where everybody is, and which files nobody has touched in a fortnight. A student moves along on their own file, where the gate and its reasons are."
        actions={<Link href="/students" className="text-sm font-medium text-brand-600 hover:underline">The list instead</Link>}
      />

      {/* Nineteen branches and a counsellor each made a wall of pills three
          rows deep before the board itself began. The same choices now go
          through the bar every other list in the portal uses, so what is on
          reads as chips you can take off one at a time, and there is one way
          back to everybody. */}
      <FilterBar
        primary={3}
        fields={[
          ...(branches.length > 0
            ? [{ kind: "select" as const, name: "branch", label: "Branch", options: branches.map((b) => ({ value: b.id, label: b.name })) }]
            : []),
          ...(counsellors.length > 1
            ? [{ kind: "select" as const, name: "who", label: "Counsellor", options: counsellors.map((c) => ({ value: c.id, label: c.deskLabel ?? c.name })) }]
            : []),
          ...(teams.length > 0
            ? [{ kind: "select" as const, name: "team", label: "Team", options: teams.map((t) => ({ value: t.id, label: t.name })) }]
            : []),
          {
            kind: "select" as const,
            name: "quiet",
            label: "Contact",
            options: [{ value: "1", label: `Never spoken to (${cards.filter((c) => c.quiet).length})` }],
          },
        ]}
      >
        <span className="pb-2 text-xs text-muted">{shown.length} of {cards.length} on the board</span>
      </FilterBar>

      {shown.length === 0 ? (
        <EmptyState title="Nobody here">Register a student, or widen the filters.</EmptyState>
      ) : (
        <div className="overflow-x-auto pb-4" data-print="hide" data-board>
          <div className="flex min-w-max gap-3">
            {STAGES.map((s) => {
              const here = shown.filter((c) => c.stage === s.value);
              return (
                <div key={s.value} className="w-72 shrink-0">
                  <div className="mb-2 flex items-center gap-2">
                    <h2 className="text-sm font-semibold">{s.number}. {s.label}</h2>
                    <Chip>{here.length}</Chip>
                  </div>
                  <p className="mb-2 text-2xs leading-snug text-muted">{s.blurb}</p>
                  <div className="space-y-2">
                    {here.map((c) => (
                      <Link
                        key={c.id}
                        href={`/students/${c.id}/timeline`}
                        data-board-card={c.id}
                        data-assigned-to={c.assignedToId ?? ""}
                        className="block rounded-lg border border-line bg-surface p-2.5 hover:border-brand-300"
                      >
                        <p className="font-medium">{c.firstName} {c.lastName}</p>
                        <p className="mt-0.5 text-2xs text-muted">
                          {isStaff(user) ? `${c.branch} · ` : ""}
                          {c.assignedToDesk ?? c.assignedTo ?? "nobody"}
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs">
                          <span className={c.quiet ? "font-medium text-warn-700" : "text-muted"}>{since(c.last)}</span>
                          {c.tasks.overdue > 0 && <Chip tone="bad">{c.tasks.overdue} overdue</Chip>}
                          {c.tasks.overdue === 0 && c.tasks.open > 0 && <Chip tone="info">{c.tasks.open} to do</Chip>}
                          {c.apps > 0 && <span className="text-muted">{c.apps} application{c.apps === 1 ? "" : "s"}</span>}
                        </p>
                        {c.stageEnteredAt && <p className="mt-0.5 text-2xs text-muted">On {stageLabel(c.stage).toLowerCase()} since {fmtDate(c.stageEnteredAt)}</p>}
                      </Link>
                    ))}
                    {here.length === 0 && <p className="rounded-lg border border-dashed border-line p-3 text-2xs text-muted">Nobody</p>}
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
