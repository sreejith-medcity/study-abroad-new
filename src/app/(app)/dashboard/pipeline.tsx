import Link from "next/link";
import { PROCESSING_ROLES, isStaff } from "@/lib/permissions";
import { inrShort } from "@/lib/money";
import { can } from "@/server/capabilities";
import { walletBalance } from "@/server/commission";
import { commissionVisible } from "@/server/commission-visibility";
import { dashboardTiles } from "@/server/dashboard-tiles";
import { destinations } from "@/server/dashboard-charts";
import { documentsToCome, followUps, pipeline, placements, teamBoard, unassigned } from "@/server/dashboard-work";
import { PERIODS, type Lens } from "@/server/dashboard-lens";
import { Card, CardHeader, LinkButton } from "@/components/ui";
import { CountryBars } from "@/components/charts/dashboard-pictures";
import { FigureStrip, Leaderboard, PipelineColumns, Placements, ProgressList, TaskList, ageText } from "@/components/dashboard/role-pieces";
import { IconPlus } from "@/components/icons";
import { TargetsCard } from "./targets-card";
import { Controls, ViewingAsNote, firstName, partOfDay } from "./controls";

/**
 * A branch's dashboard and a counsellor's, as a pipeline board.
 *
 * A strip of every figure along the top, then the work itself: every live
 * application as a card in its stage, the one waiting longest at the top.
 * Underneath, the students who still owe documents, and beside them the
 * branch's team side by side for a branch head, or the follow-ups due for a
 * counsellor, and where the students want to go.
 *
 * A counsellor's board holds only the students assigned to them. A branch
 * head and a senior counsellor read the whole branch.
 */
export default async function Pipeline({ lens }: { lens: Lens }) {
  const { user, kind } = lens;
  const counsellor = kind === "counsellor";
  const staff = isStaff(user);
  // The wallet belongs to one branch: the branch head's own, or the branch
  // somebody at the desk picked while looking as one. A senior counsellor
  // runs the students, not the branch, so has none.
  const walletOrg = kind === "branch" ? (user.role === "PARTNER" ? user.orgId : lens.viewingAs ? lens.org : null) : null;
  const [t, board, owed, people, tasks, going, loose, money, mayRegister, placed] = await Promise.all([
    dashboardTiles(lens),
    pipeline(lens),
    documentsToCome(lens),
    counsellor ? Promise.resolve([]) : teamBoard(lens),
    counsellor ? followUps(lens) : Promise.resolve(null),
    destinations(lens, 5),
    counsellor ? Promise.resolve(0) : unassigned(lens),
    commissionVisible(user),
    lens.viewingAs ? Promise.resolve(false) : can(user, "REGISTER_STUDENT"),
    placements(lens),
  ]);
  const wallet = walletOrg && money ? await walletBalance(walletOrg) : null;

  const mine = lens.person ? `&assignedTo=${lens.person.id}` : "";
  const studentsHref = lens.person ? `/students?assignedTo=${lens.person.id}` : "/students";
  const when = PERIODS.find(([k]) => k === lens.period)?.[1].toLowerCase() ?? "all time";
  const waiting = t.fromBranches.n + t.fromSubAgents.n;
  // The documentation queue is the desk's. A branch chases its own students
  // from their files, so its link goes to the students.
  const docsHref = (PROCESSING_ROLES as readonly string[]).includes(user.role) ? "/documentation" : studentsHref;

  const figures = [
    { slug: counsellor ? "my-students" : "total-registrations", label: counsellor ? "My students" : "Registrations", value: t.registrations.value, tone: "brand" as const, href: studentsHref },
    ...(tasks
      ? [
          { slug: "follow-ups-today", label: "Follow-ups today", value: tasks.today, tone: "warn" as const, href: "/my-day" },
          { slug: "follow-ups-late", label: "Follow-ups late", value: tasks.late, tone: "stop" as const, href: "/my-day" },
        ]
      : []),
    { slug: "total-applications", label: "Applications", value: t.applications.value, tone: "info" as const, href: lens.person ? `/applications?assignedTo=${lens.person.id}` : "/applications" },
    { slug: "offers-received", label: "Offers", value: t.offers.value, tone: "good" as const, href: `/applications?kpi=offers${mine}` },
    { slug: "visas-received", label: "Visas", value: t.visaReceived.value, tone: "good" as const, href: `/applications?kpi=visa_received${mine}` },
    { slug: "visas-rejected", label: "Rejected", value: t.visaRejected.value, tone: "stop" as const, href: `/applications?kpi=visa_rejected${mine}` },
    { slug: "pending-documents", label: "Docs pending", value: t.documents.items, note: t.documents.students ? `${t.documents.students} students` : undefined, tone: "warn" as const, href: docsHref },
    { slug: "deferrals", label: "Deferrals", value: t.deferrals, tone: "warn" as const, href: `/applications?kpi=deferrals${mine}` },
    { slug: "payments-done", label: "Paid", value: t.feesPaid, tone: "good" as const, href: `/applications?kpi=payments${mine}` },
    { slug: "payments-pending", label: "Fee pending", value: t.feesDue, tone: "stop" as const, href: `/applications?kpi=fees_due${mine}` },
    { slug: "waiting-on-you", label: "Waiting on you", value: waiting, tone: "warn" as const, href: `/applications?group=PENDING_PARTNER${mine}` },
    ...(!counsellor ? [{ slug: "not-given-to-anyone", label: "Not given to anyone", value: loose, tone: "info" as const, href: "/students?assignedTo=none" }] : []),
    ...(t.revenue ? [{ slug: "total-revenue-expected", label: "Revenue due", value: inrShort(t.revenue.expected), tone: "gold" as const, href: staff ? "/admin/commission?status=EXPECTED" : "/commission" }] : []),
    ...(wallet ? [{ slug: "wallet", label: "Wallet", value: inrShort(wallet.balance), tone: "gold" as const, href: "/wallet" }] : []),
  ];

  const whose = counsellor
    ? lens.person
      ? lens.viewingAs
        ? `${lens.person.name}'s own students`
        : "your own students"
      : "every counsellor's students"
    : (lens.orgName ?? (staff ? "every branch" : user.orgName));

  return (
    <>
      <ViewingAsNote lens={lens} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-ink">{counsellor ? "My pipeline" : "Pipeline"}</h1>
          <p className="mt-0.5 text-muted">
            {partOfDay()}, {firstName(user.name)}. Where every student is right now, across {whose}
            {lens.period === "all" ? "" : `; figures for ${when}`}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Controls lens={lens} />
          {mayRegister && (
            <LinkButton href="/students/new" size="sm">
              <IconPlus className="size-4" /> Register a student
            </LinkButton>
          )}
        </div>
      </div>

      {counsellor && lens.person && !lens.viewingAs && t.registrations.value === 0 && lens.period === "all" && (
        <p data-first-day className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm text-ink-soft">
          No students are assigned to you yet. The ones your branch gives you, and the ones you register yourself, fill this board as they come.
        </p>
      )}
      <FigureStrip figures={figures} />

      <TargetsCard lens={lens} className="mt-5" />

      <Card className="mt-5">
        <CardHeader
          title="Applications by stage"
          subtitle="Every live application as a card, the one waiting longest at the top of each column"
          action={
            <Link href="/students/board" className="text-xs font-medium text-brand-700 hover:underline">
              Open the full board
            </Link>
          }
        />
        <PipelineColumns
          columns={board.map((c) => ({
            key: c.key,
            label: c.label,
            total: c.total,
            href: c.href,
            cards: c.cards.map((card) => ({
              id: card.id,
              href: `/students/${card.studentId}/applications?app=${card.id}`,
              title: card.student,
              lines: [`${card.country ? `${card.country} · ` : ""}${card.university}`, counsellor ? card.program : card.branch],
              age: ageText(card.days),
              late: card.late,
            })),
          }))}
        />
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Documents still to come" subtitle="Students who owe documents, least complete first" />
          <ProgressList
            rows={owed.rows.map((r) => ({ id: r.id, label: r.student, done: r.in, of: r.asked, href: `/students/${r.id}/documentation` }))}
            footer={
              owed.students > 0 ? (
                <Link href={docsHref} className="font-medium text-brand-700 hover:underline">
                  {owed.owed} {owed.owed === 1 ? "item" : "items"} owed across {owed.students} {owed.students === 1 ? "student" : "students"}
                </Link>
              ) : undefined
            }
          />
        </Card>
        {tasks ? (
          <Card className="min-w-0">
            <CardHeader
              title="Follow-ups"
              subtitle={`${tasks.late} late, ${tasks.today} due today, ${tasks.open} open`}
              action={
                <Link href="/my-day" className="text-xs font-medium text-brand-700 hover:underline">
                  My day
                </Link>
              }
            />
            <TaskList rows={tasks.rows} todayIs={tasks.todayIs} />
          </Card>
        ) : (
          <Card className="min-w-0">
            <CardHeader title={lens.org || !staff ? "The team" : "Counsellors"} subtitle="Students carried, applications made and offers come back" />
            <Leaderboard
              head={["Name", "Students", "Apps", "Offers"]}
              empty="Nobody in the team carries a student yet."
              rows={people.map((p) => ({ id: p.id, name: p.name, sub: lens.org || !staff ? undefined : p.branch, href: `/students?assignedTo=${p.id}`, cells: [p.students, p.applications, p.offers] }))}
            />
          </Card>
        )}
        <Card className="min-w-0">
          <CardHeader title="Where students want to go" subtitle="Preferred country, as registered" />
          <div className="p-4">
            <CountryBars rows={going.rows} notRecorded={going.notRecorded} />
          </div>
        </Card>
      </div>

      {/* Placement work, where the branch or the counsellor has any. A board of
          noughts for somebody who never places anybody would be noise. */}
      {placed.ausbildung.students + placed.nclex.students > 0 && (
        <Card className="mt-5">
          <CardHeader title="Placements" subtitle="Ausbildung and NCLEX-RN, each figure opening the placement tracker" />
          <Placements
            ausbildung={placed.ausbildung}
            nclex={placed.nclex}
            query={[lens.viewingAs && lens.org ? `branch=${lens.org}` : "", lens.person ? `who=${lens.person.id}` : ""].filter(Boolean).join("&")}
          />
        </Card>
      )}
    </>
  );
}
