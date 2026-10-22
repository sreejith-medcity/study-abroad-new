import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { inrShort } from "@/lib/money";
import { db, schema } from "@/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { dashboardTiles, type Flow } from "@/server/dashboard-tiles";
import { activity, branchesCompared, destinations, journey, monthly, stages } from "@/server/dashboard-charts";
import { PERIODS, readLens } from "@/server/dashboard-lens";
import { StatTiles, type StatTile } from "@/components/stat-tiles";
import { LensBar } from "@/components/charts/lens-bar";
import { MonthlyLines, APPS } from "@/components/charts/monthly-lines";
import { ActivityFeed, BranchTable, CountryBars, JourneyFlow, StageRing } from "@/components/charts/dashboard-pictures";
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

/** The greeting, so the screen says hello before it says numbers. */
function partOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The dashboard, as a command centre.
 *
 * Eleven figures asked for by name, as a board, each the way into the list
 * behind it. Then the same figures as pictures: the journey from registering
 * to enrolling, a year month by month, where the applications stand, how the
 * branches compare, and what has just happened.
 *
 * A period picker moves the figures that are things happening, and says how
 * each moved against the stretch before; the ones that are a state of things
 * now are marked as such and stay put. The desk can narrow the whole screen
 * to one branch.
 *
 * The same screen for everybody, scoped to what they may see. Two of the
 * tiles cannot mean the same thing to the desk and to a branch, and those are
 * the only ones that change.
 */
export default async function TileDashboard({ user, searchParams }: { user: SessionUser; searchParams: Record<string, string | string[] | undefined> }) {
  const lens = await readLens(user, searchParams);
  const staff = isStaff(user);
  const [t, months, steps, standing, compared, going, latest, orgs] = await Promise.all([
    dashboardTiles(lens),
    monthly(lens),
    journey(lens),
    stages(lens),
    branchesCompared(lens),
    destinations(lens, 6),
    activity(lens, 8),
    staff
      ? db
          .select({ id: schema.organizations.id, name: schema.organizations.name, type: schema.organizations.type })
          .from(schema.organizations)
          .where(and(inArray(schema.organizations.type, ["BRANCH", "SUB_AGENT"]), eq(schema.organizations.active, true)))
          .orderBy(asc(schema.organizations.type), asc(schema.organizations.name))
      : Promise.resolve([]),
  ]);

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
  const when = PERIODS.find(([k]) => k === lens.period)?.[1].toLowerCase() ?? "all time";

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold text-ink">Dashboard</h1>
          <p className="mt-0.5 text-muted">
            {partOfDay()}, {user.name.split(" ")[0]}. {lens.period === "all" ? "Everything to date" : `Figures for ${when}`}, across {where}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LensBar periods={PERIODS} period={lens.period} orgs={orgs.map((o) => ({ id: o.id, name: o.name, subAgent: o.type === "SUB_AGENT" }))} org={lens.org} />
          <LinkButton href={staff ? "/admin/queue" : "/students"} size="sm">
            <IconQueue className="size-4" /> {staff ? "Open work queue" : "Open students"}
          </LinkButton>
        </div>
      </div>

      <StatTiles tiles={tiles} />

      <Card className="mt-5">
        <CardHeader
          title="From registration to enrolment"
          subtitle={`${lens.period === "all" ? "Every student" : `Students who registered ${when === "today" ? "today" : `this ${when.replace("this ", "")}`}`}, and how far they have got`}
          action={<span className="text-xs text-muted">Each step opens its list</span>}
        />
        <div className="p-4">
          <JourneyFlow steps={steps} />
        </div>
      </Card>

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
          {staff && !lens.org && (
            <Card>
              <CardHeader title="Branches compared" subtitle={`${lens.period === "all" ? "To date" : `For ${when}`}, ranked by registrations. A name opens the dashboard for that branch.`} />
              <BranchTable rows={compared} />
            </Card>
          )}
          <Card>
            <CardHeader title="Where students want to go" subtitle="Preferred country, as registered" />
            <div className="p-4">
              <CountryBars rows={going.rows} notRecorded={going.notRecorded} />
            </div>
          </Card>
        </div>
        <Card className="h-fit min-w-0">
          <CardHeader title="Recent activity" subtitle="Newest first" />
          <ActivityFeed items={latest} />
        </Card>
      </div>
    </>
  );
}
