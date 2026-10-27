import { inrShort } from "@/lib/money";
import { PROCESSING_ROLES } from "@/lib/permissions";
import { dashboardTiles, type Flow } from "@/server/dashboard-tiles";
import { activity, branchesCompared, destinations, journey, monthly } from "@/server/dashboard-charts";
import { pastServiceLevel, placements } from "@/server/dashboard-work";
import { PERIODS, type Lens } from "@/server/dashboard-lens";
import { Card, CardHeader } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { ActivityFeed, BranchTable, CountryBars } from "@/components/charts/dashboard-pictures";
import { AreaLine, AttentionList, ExecHero, FlowRibbon, Gauge, MiniTiles, Placements } from "@/components/dashboard/role-pieces";
import { TargetsCard } from "./targets-card";
import { DayFiguresStrip } from "./day-figures-card";
import { Controls, ViewingAsNote, firstName, partOfDay, periodLinks } from "./controls";

/**
 * Leadership's dashboard, as an executive summary: the super admin, the ops
 * manager and management.
 *
 * It opens on a band of the four figures the business is run by, with what
 * the work on the books is worth as a gauge filling as the money comes in.
 * Under it, how students flow from registering to a visa and where the rest
 * stopped, beside the few things that need somebody to move them. Then the
 * year as a line beside the figures read in passing, and the branches side
 * by side beside what has just happened.
 */
export default async function Executive({ lens, sp }: { lens: Lens; sp: Record<string, string | string[] | undefined> }) {
  const { user } = lens;
  // Management reads everything and works nothing, so the work queues are not
  // theirs to open; their links go to the lists instead.
  const works = (PROCESSING_ROLES as readonly string[]).includes(user.role);
  const [t, steps, months, compared, going, late, latest, placed] = await Promise.all([
    dashboardTiles(lens),
    journey(lens),
    monthly(lens),
    branchesCompared(lens),
    destinations(lens, 6),
    pastServiceLevel(lens),
    activity(lens, 6),
    placements(lens),
  ]);

  const when = PERIODS.find(([k]) => k === lens.period)?.[1] ?? "All time";
  const moved = (f: Flow) => {
    if (f.before === null || !lens.versus) return undefined;
    const d = f.value - f.before;
    return d === 0 ? `No change ${lens.versus}` : `${d > 0 ? "+" : "−"}${Math.abs(d).toLocaleString("en-IN")} ${lens.versus}`;
  };
  const registered = steps[0]?.value ?? 0;
  const applied = steps[1]?.value ?? 0;
  const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

  const revenue = t.revenue;
  const gauge = revenue ? (
    <Gauge
      label="Fills as commission comes in"
      value={revenue.received}
      of={revenue.expected + revenue.received}
      middle={inrShort(revenue.expected)}
      under={revenue.received > 0 ? `revenue expected, ${inrShort(revenue.received)} already in` : "revenue expected, nothing in yet"}
    />
  ) : undefined;

  return (
    <>
      <ViewingAsNote lens={lens} />
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <Controls lens={lens} periods={false} />
        <PrintButton />
      </div>

      <ExecHero
        eyebrow={`${lens.orgName ?? "Medcity Overseas"} · ${when}`}
        greeting={`${partOfDay()}, ${firstName(user.name)}`}
        line={registered > 0 ? `${share(applied, registered)} of students registered ${lens.period === "all" ? "so far" : "in this period"} have applied.` : "Nobody has registered in this period yet."}
        periods={periodLinks(lens, sp)}
        figures={[
          { slug: "total-registrations", label: "Total registrations", value: t.registrations.value.toLocaleString("en-IN"), note: moved(t.registrations), href: "/students" },
          { slug: "total-applications", label: "Total applications", value: t.applications.value.toLocaleString("en-IN"), note: moved(t.applications), href: "/applications" },
          {
            slug: "offers-received",
            label: "Offers received",
            value: t.offers.value.toLocaleString("en-IN"),
            note: t.applications.value > 0 ? `${share(t.offers.value, t.applications.value)} of applications` : undefined,
            href: "/applications?kpi=offers",
          },
          { slug: "visas-received", label: "Visas received", value: t.visaReceived.value.toLocaleString("en-IN"), note: moved(t.visaReceived), href: "/applications?kpi=visa_received" },
        ]}
        gauge={gauge}
      />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="How students flow through" subtitle="From registering to a visa and enrolling, with where the rest stopped" />
          <div className="p-4">
            <FlowRibbon steps={steps} />
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Needs attention" subtitle="The things only somebody can move" />
          <AttentionList
            rows={[
              {
                slug: "pending-documents",
                value: t.documents.items,
                label: "Pending documents",
                note: `across ${t.documents.students} ${t.documents.students === 1 ? "student" : "students"}`,
                tone: "warn",
                href: works ? "/documentation" : "/students",
                action: works ? "Chase now" : "See who",
              },
              { slug: "payments-pending", value: t.feesDue, label: "Payments pending", note: "Tuition fee due and not paid", tone: "stop", href: "/applications?kpi=fees_due", action: "See who" },
              { slug: "past-service-level", value: late, label: "Past service level", note: "Files sat at a stage too long", tone: "stop", href: works ? "/admin/queue?officer=all" : "/applications", action: works ? "Open queue" : "See files" },
              {
                slug: "waiting-on-branches",
                value: t.fromBranches.n + t.fromSubAgents.n,
                label: "Waiting on a branch or partner",
                note: `${t.fromBranches.n} with branches, ${t.fromSubAgents.n} with sub-agents`,
                tone: "info",
                href: "/applications?group=PENDING_PARTNER",
                action: "See files",
              },
            ]}
          />
        </Card>
      </div>

      <TargetsCard lens={lens} className="mt-5" />
      <DayFiguresStrip lens={lens} className="mt-5" />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Registrations, last twelve months" subtitle="One line, the latest month labelled" />
          <div className="p-4">
            <AreaLine points={months.map((m) => ({ key: m.key, label: m.label, value: m.registrations }))} />
          </div>
        </Card>
        <MiniTiles
          tiles={[
            { slug: "visas-rejected", label: "Visas rejected", value: t.visaRejected.value, tone: "stop", href: "/applications?kpi=visa_rejected" },
            { slug: "deferrals", label: "Deferrals", value: t.deferrals, tone: "warn", href: "/applications?kpi=deferrals" },
            { slug: "payments-done", label: "Payments done", value: t.feesPaid, tone: "good", href: "/applications?kpi=payments" },
            { slug: "pending-from-branches", label: "Pending from branches", value: t.fromBranches.n, tone: "info", href: "/applications?group=PENDING_PARTNER&orgType=BRANCH" },
            { slug: "pending-from-partners", label: "Pending from partners", value: t.fromSubAgents.n, tone: "info", href: "/applications?group=PENDING_PARTNER&orgType=SUB_AGENT" },
            { slug: "enrolled", label: "Enrolled", value: steps[4]?.value ?? 0, tone: "good", href: "/applications?group=SUCCESS" },
          ]}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          {!lens.org && (
            <Card>
              <CardHeader title="Branches compared" subtitle={`${lens.period === "all" ? "To date" : `For ${when.toLowerCase()}`}, ranked by registrations. A name opens the dashboard for that branch.`} />
              <BranchTable rows={compared} />
            </Card>
          )}
          <Card>
            <CardHeader title="Placements" subtitle="Ausbildung, NCLEX-RN and FSJ / BFD, each figure opening its tracker" />
            <Placements ausbildung={placed.ausbildung} nclex={placed.nclex} fsj={placed.fsj} query={lens.org ? `branch=${lens.org}` : ""} />
          </Card>
          <Card>
            <CardHeader title="Where students want to go" subtitle="Preferred country, as registered" />
            <div className="p-4">
              <CountryBars rows={going.rows} notRecorded={going.notRecorded} />
            </div>
          </Card>
        </div>
        <Card className="h-fit min-w-0">
          <CardHeader title="Latest" subtitle="Newest first" />
          <ActivityFeed items={latest} />
        </Card>
      </div>
    </>
  );
}
