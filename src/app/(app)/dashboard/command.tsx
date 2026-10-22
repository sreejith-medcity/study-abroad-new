import { isStaff } from "@/lib/permissions";
import { inrShort } from "@/lib/money";
import { dashboardTiles, type Flow } from "@/server/dashboard-tiles";
import { activity, branchesCompared, journey, monthly, stages } from "@/server/dashboard-charts";
import { deadlinesThisWeek, officerLoad, pastServiceLevel } from "@/server/dashboard-work";
import { PERIODS, type Lens } from "@/server/dashboard-lens";
import { DEADLINE_LABEL } from "@/lib/deadline-types";
import { StatTiles, type StatTile } from "@/components/stat-tiles";
import { MonthlyLines, APPS } from "@/components/charts/monthly-lines";
import { ActivityFeed, BranchTable, JourneyFlow, StageRing } from "@/components/charts/dashboard-pictures";
import { Leaderboard, WeekStrip, shortDate } from "@/components/dashboard/role-pieces";
import { Controls, ViewingAsNote, firstName, partOfDay } from "./controls";
import Link from "next/link";
import { Card, CardHeader, LinkButton } from "@/components/ui";
import {
  IconAlert,
  IconApplications,
  IconBuilding,
  IconCheck,
  IconClock,
  IconCommission,
  IconDoc,
  IconGlobe,
  IconPartners,
  IconQueue,
  IconStudents,
  IconWallet,
} from "@/components/icons";

/**
 * The processing desk's dashboard, as a command centre: the Overseas admin
 * and the application team leader.
 *
 * The board of figures first, each the way into the list behind it, with one
 * more the desk is measured by: files sat at a stage past their service
 * level. Then the journey beside the week's deadlines, a year month by month
 * beside where the applications stand, and who on the desk is carrying what
 * beside what has just happened.
 *
 * A period picker moves the figures that are things happening, and says how
 * each moved against the stretch before; the ones that are a state of things
 * now are marked as such and stay put. The desk can narrow the whole screen
 * to one branch.
 */
export default async function CommandCentre({ lens }: { lens: Lens }) {
  const { user } = lens;
  const staff = isStaff(user);
  const [t, months, steps, standing, compared, week, load, late] = await Promise.all([
    dashboardTiles(lens),
    monthly(lens),
    journey(lens),
    stages(lens),
    branchesCompared(lens),
    deadlinesThisWeek(lens),
    officerLoad(lens),
    pastServiceLevel(lens),
  ]);
  const latest = await activity(lens, 8);

  /** How a happening moved against the stretch before, in the tile's words. */
  const change = (f: Flow, upIsGood = true): StatTile["change"] => {
    if (f.before === null || !lens.versus) return undefined;
    const d = f.value - f.before;
    if (d === 0) return { text: `No change ${lens.versus}`, good: null };
    const text = f.before > 0 ? `${d > 0 ? "+" : "−"}${Math.abs(Math.round((d / f.before) * 100))}% ${lens.versus}` : `+${d} ${lens.versus}`;
    return { text, good: d > 0 ? upIsGood : !upIsGood };
  };
  const days = (n: number | null) => (n === null ? undefined : n === 0 ? "oldest from today" : `oldest ${n} ${n === 1 ? "day" : "days"}`);

  const waiting: StatTile[] = staff
    ? [
        { label: "Pending from branches", value: t.fromBranches.n, note: days(t.fromBranches.days) ?? "Waiting on a branch", now: true, tone: "warn", icon: <IconBuilding />, href: "/applications?group=PENDING_PARTNER&orgType=BRANCH" },
        { label: "Pending from partners", value: t.fromSubAgents.n, note: days(t.fromSubAgents.days) ?? "Waiting on a sub-agent", now: true, tone: "warn", icon: <IconPartners />, href: "/applications?group=PENDING_PARTNER&orgType=SUB_AGENT" },
      ]
    : [
        // A branch sees its own files and a sub-agent sees its own, so the
        // desk's two waiting tiles are one question to them.
        {
          label: "Waiting on you",
          value: t.fromBranches.n + t.fromSubAgents.n,
          note: days([t.fromBranches.days, t.fromSubAgents.days].filter((d): d is number => d !== null).reduce<number | null>((a, b) => (a === null ? b : Math.max(a, b)), null)) ?? "The desk has asked and is waiting",
          now: true,
          tone: "warn",
          icon: <IconBuilding />,
          href: "/applications?group=PENDING_PARTNER",
        },
      ];

  const tiles: StatTile[] = [
    { label: "Total registrations", value: t.registrations.value.toLocaleString("en-IN"), change: change(t.registrations), note: "Students on the books", spark: t.registrations.spark, tone: "brand", icon: <IconStudents />, href: "/students" },
    { label: "Total applications", value: t.applications.value.toLocaleString("en-IN"), change: change(t.applications), note: "Every application made", spark: t.applications.spark, tone: "info", icon: <IconApplications />, href: "/applications" },
    { label: "Offers received", value: t.offers.value, change: change(t.offers), note: "Counting those now further on", spark: t.offers.spark, tone: "good", icon: <IconCheck />, href: "/applications?kpi=offers" },
    { label: "Visas received", value: t.visaReceived.value, change: change(t.visaReceived), note: "Visa in hand or further", spark: t.visaReceived.spark, tone: "good", icon: <IconGlobe />, href: "/applications?kpi=visa_received" },
    { label: "Visas rejected", value: t.visaRejected.value, change: change(t.visaRejected, false), note: "Refused at least once", spark: t.visaRejected.spark, tone: "stop", icon: <IconAlert />, href: "/applications?kpi=visa_rejected" },
    {
      label: "Pending documents",
      value: t.documents.items,
      note: t.documents.items === 0 ? "Nothing outstanding" : `across ${t.documents.students} ${t.documents.students === 1 ? "student" : "students"}`,
      now: true,
      tone: "warn",
      icon: <IconDoc />,
      href: "/documentation",
    },
    { label: "Deferrals", value: t.deferrals, note: "Moved to a later intake", now: true, tone: "warn", icon: <IconClock />, href: "/applications?kpi=deferrals" },
    { label: "Payments done", value: t.feesPaid, note: "Tuition fee paid", now: true, tone: "good", icon: <IconCheck />, href: "/applications?kpi=payments" },
    { label: "Payments pending", value: t.feesDue, note: "Fee due and not paid", now: true, tone: "stop", icon: <IconWallet />, href: "/applications?kpi=fees_due" },
    ...waiting,
    ...(t.revenue
      ? [
          {
            label: "Total revenue expected",
            // Said the way it is said aloud, because the full figure does not
            // fit a tile; the exact one is a click away on the commission list.
            value: inrShort(t.revenue.expected),
            note: t.revenue.received > 0 ? `${inrShort(t.revenue.received)} already in` : "Nothing received yet",
            now: true,
            tone: "gold" as const,
            icon: <IconCommission />,
            href: staff ? "/admin/commission?status=EXPECTED" : "/commission",
          },
        ]
      : []),
  ];

  const where = lens.orgName ?? (staff ? "all branches and partners" : user.orgName);
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const when = PERIODS.find(([k]) => k === lens.period)?.[1].toLowerCase() ?? "all time";

  return (
    <>
      <ViewingAsNote lens={lens} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-ink">
            {partOfDay()}, {firstName(user.name)}
          </h1>
          <p className="mt-0.5 text-muted">
            {lens.period === "all" ? "Everything to date" : `Figures for ${when}`}, across {where}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Controls lens={lens} />
          <LinkButton href="/admin/queue" size="sm">
            <IconQueue className="size-4" /> Open work queue
          </LinkButton>
        </div>
      </div>

      <StatTiles tiles={tiles} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title="From registration to enrolment"
            subtitle={`${lens.period === "all" ? "Every student" : `Students who registered ${when === "today" ? "today" : `this ${when.replace("this ", "")}`}`}, and how far they have got`}
            action={<span className="text-xs text-muted">Each step opens its list</span>}
          />
          <div className="p-4">
            <JourneyFlow steps={steps} />
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Deadlines this week" subtitle="Open milestones on applications" action={<Link href="/deadlines" className="text-xs font-medium text-brand-700 hover:underline">All deadlines</Link>} />
          <WeekStrip
            days={week.days}
            today={week.today}
            late={week.late}
            more={Math.max(0, week.total - week.items.length)}
            items={week.items.map((d) => ({
              id: d.id,
              title: DEADLINE_LABEL[d.type] ?? d.type,
              sub: `${d.student} · ${d.university}`,
              due: d.dueOn === week.today ? "Today" : `${DAY[new Date(`${d.dueOn}T00:00:00`).getDay()]} ${shortDate(d.dueOn)}`,
              href: `/students/${d.studentId}/applications?app=${d.appId}`,
            }))}
          />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader
            title="Month by month"
            subtitle="Registrations and applications, last twelve months"
            action={
              <span className="flex gap-3.5 text-xs text-ink-soft">
                <span className="flex items-center gap-1.5">
                  <i className="size-2.5 rounded-[3px] bg-info-500" /> Registrations
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="size-2.5 rounded-[3px]" style={{ background: APPS }} /> Applications
                </span>
              </span>
            }
          />
          <div className="p-4">
            <MonthlyLines months={months} />
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Where applications stand" subtitle="Every application, by its stage now" />
          <div className="p-4">
            <StageRing stages={standing} />
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Who is carrying what"
              subtitle="Open files per officer, how many are past their service level, and the oldest"
              action={
                <Link href="/admin/queue?officer=all" data-past-service-level={late} className={late > 0 ? "rounded-md bg-stop-50 px-2 py-1 text-xs font-semibold text-stop-700" : "rounded-md bg-good-50 px-2 py-1 text-xs font-semibold text-good-700"}>
                  {late > 0 ? `${late} past service level` : "All within service level"}
                </Link>
              }
            />
            <Leaderboard
              head={["Officer", "Open", "Late", "Oldest"]}
              empty="No open files."
              rows={load.map((o) => ({
                id: o.id ?? "nobody",
                name: o.name,
                href: "/admin/queue?officer=all",
                cells: [o.open, o.late, `${o.oldest}d`],
              }))}
            />
          </Card>
          {staff && !lens.org && (
            <Card>
              <CardHeader title="Branches compared" subtitle={`${lens.period === "all" ? "To date" : `For ${when}`}, ranked by registrations. A name opens the dashboard for that branch.`} />
              <BranchTable rows={compared} />
            </Card>
          )}
        </div>
        <Card className="h-fit min-w-0">
          <CardHeader title="Recent activity" subtitle="Newest first" />
          <ActivityFeed items={latest} />
        </Card>
      </div>
    </>
  );
}
