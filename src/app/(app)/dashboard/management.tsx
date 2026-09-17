import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { applicationWhere, type ApplicationFilters } from "@/server/queries";
import {
  countryMix,
  funnel,
  groupCounts,
  kpiTotals,
  lateWork,
  monthlyPoints,
  partnerLeaderboard,
  pathwayMix,
  recentChanges,
  todayCounts,
} from "@/server/dashboard";
import { enquiryCounts } from "@/server/enquiries";
import {
  BarList,
  Card,
  CardHeader,
  Chip,
  DashboardHero,
  DataList,
  FunnelSteps,
  Stat,
  Table,
  Td,
  Th,
  TrendChart,
} from "@/components/ui";
import { IconAlert, IconApplications, IconCheck } from "@/components/icons";
import { DashboardFilters, RecentChangesCard } from "./parts";

function rate(a: number, b: number) {
  if (!b) return "0%";
  return `${Math.round((a / b) * 100)}%`;
}

/** Read-only view for management: outcomes, conversion and partner performance. */
export default async function ManagementDashboard({ user, f }: { user: SessionUser; f: ApplicationFilters }) {
  const { countries: c } = schema;
  const filters: ApplicationFilters = { from: f.from, to: f.to, country: f.country, intakeYear: f.intakeYear, intakeMonth: f.intakeMonth };

  const [kpis, steps, points, groups, late, partners, destinations, pathways, recent, today, countries, enquiries] = await Promise.all([
    kpiTotals(user, applicationWhere(user, filters)),
    funnel(user),
    monthlyPoints(user, 12),
    groupCounts(user),
    lateWork(user),
    partnerLeaderboard(10),
    countryMix(user, 6),
    pathwayMix(user),
    recentChanges(user, 6),
    todayCounts(user),
    db.select().from(c).orderBy(asc(c.name)),
    enquiryCounts(user),
  ]);

  const registered = steps[0]?.value ?? 0;
  const applied = steps[1]?.value ?? 0;
  const offers = steps[2]?.value ?? 0;
  const visas = steps[4]?.value ?? 0;

  return (
    <>
      <DashboardHero
        eyebrow="Management view"
        title="Medcity Overseas performance"
        subtitle="Read-only. Volumes, conversion and partner performance across every branch and sub-agent."
        meta={[
          { label: "Students", value: registered },
          { label: "Applications", value: applied },
          { label: "Offers", value: offers },
          { label: "Visas", value: visas },
          { label: "Offer rate", value: rate(offers, applied) },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Applications" tone="brand" icon={<IconApplications className="size-4" />} value={kpis.all} href="/applications" />
            <Stat label="Offers" tone="good" icon={<IconCheck className="size-4" />} value={kpis.offers} href="/applications?kpi=offers" />
            <Stat label="Visas received" tone="good" icon={<IconCheck className="size-4" />} value={kpis.visa_received} href="/applications?kpi=visa_received" />
            <Stat label="Past SLA" tone="stop" icon={<IconAlert className="size-4" />} value={late.total} href="/applications?group=PENDING_PARTNER" />
          </div>

          <Card>
            <CardHeader title="Twelve month trend" subtitle="Applications created against visas received" />
            <TrendChart points={points} aLabel="Applications" bLabel="Visas" />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Conversion funnel" subtitle="Registered through to enrolled" />
              <FunnelSteps steps={[{ label: "Enquiries logged", value: enquiries.total, href: "/enquiries" }, ...steps]} />
            </Card>
            <Card>
              <CardHeader title="Rates" subtitle="Stage to stage, all time" />
              <DataList
                rows={[
                  { label: "Enquiries that registered", value: rate(registered, enquiries.total) },
                  { label: "Students who applied", value: rate(applied, registered) },
                  { label: "Applications with an offer", value: rate(offers, applied), tone: "ok" },
                  { label: "Offers that paid a fee", value: rate(steps[3]?.value ?? 0, offers) },
                  { label: "Fees that became visas", value: rate(visas, steps[3]?.value ?? 0), tone: "ok" },
                  { label: "Visas that enrolled", value: rate(steps[5]?.value ?? 0, visas) },
                  { label: "Visa rejections", value: kpis.visa_rejected, tone: "bad" },
                  { label: "Deferrals", value: kpis.deferrals, tone: "warn" },
                  { label: "Non-enrolment", value: kpis.non_enrolment, tone: "warn" },
                ]}
              />
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Partner performance"
              subtitle="Every branch and sub-agent, busiest first"
              action={<span className="text-[13px] text-muted">Read only</span>}
            />
            <Table tableClassName="min-w-[680px]">
              <thead>
                <tr>
                  <Th>Partner</Th>
                  <Th>Tier</Th>
                  <Th>Students</Th>
                  <Th>Live</Th>
                  <Th>Visas</Th>
                  <Th>Total</Th>
                  <Th>Win rate</Th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <Link href={`/applications?org=${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                      <p className="text-xs text-muted">{p.type === "SUB_AGENT" ? "Sub-agent" : "Branch"}{p.city ? ` · ${p.city}` : ""}</p>
                    </Td>
                    <Td><Chip tone={p.tier === "PLATINUM" || p.tier === "ELITE" ? "gold" : "neutral"}>{p.tier}</Chip></Td>
                    <Td className="tabular">{p.students}</Td>
                    <Td className="tabular">{p.live}</Td>
                    <Td className="tabular">{p.won}</Td>
                    <Td className="tabular font-semibold">{p.total}</Td>
                    <Td className="tabular">{rate(p.won, p.total)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <RecentChangesCard rows={recent} showOrg />
        </div>

        <div className="space-y-5">
          <DashboardFilters f={f as Record<string, string | undefined>} countries={countries} compact />

          <Card>
            <CardHeader title="Today" subtitle="Since midnight" />
            <DataList
              rows={[
                { label: "New students", value: today.students },
                { label: "New applications", value: today.applications },
                { label: "Status changes", value: today.moves },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Destinations" subtitle="Applications by country" />
            <BarList items={destinations} tone="info" />
          </Card>

          <Card>
            <CardHeader title="Pathways" subtitle="Degree, Ausbildung and nursing" />
            <BarList items={pathways} tone="gold" />
          </Card>

          <Card>
            <CardHeader title="Pipeline" subtitle="Where live work sits" />
            <DataList
              rows={[
                { label: "New / assessment", value: groups.NEW },
                { label: "Pending from partner", value: groups.PENDING_PARTNER, tone: "warn" },
                { label: "In progress", value: groups.IN_PROGRESS },
                { label: "Offer / contract", value: groups.OFFER, tone: "ok" },
                { label: "On hold", value: groups.HOLD },
                { label: "Closed", value: groups.CLOSED, tone: "bad" },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
