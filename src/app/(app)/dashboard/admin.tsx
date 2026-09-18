import Link from "next/link";
import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { applicationWhere, type ApplicationFilters } from "@/server/queries";
import {
  ACTIVE_GROUPS,
  GROUP_LABEL,
  agingList,
  countryMix,
  deadlineList,
  groupCounts,
  kpiTotals,
  lateWork,
  monthlyPoints,
  officerLoad,
  partnerLeaderboard,
  pathwayMix,
  recentChanges,
  todayCounts,
} from "@/server/dashboard";
import { enquiryCounts } from "@/server/enquiries";
import { commissionTotals, inr } from "@/server/commission";
import {
  BarList,
  Card,
  CardHeader,
  Chip,
  DashboardHero,
  DataList,
  LinkButton,
  Stat,
  Table,
  Td,
  Th,
  TrendChart,
} from "@/components/ui";
import { IconAlert, IconApplications, IconCheck, IconClock, IconQueue, IconSearch } from "@/components/icons";
import { AgingCard, DashboardFilters, DeadlinesCard, RecentChangesCard } from "./parts";

/** The processing desk: what needs a decision today, and who is carrying it. */
export default async function AdminDashboard({ user, f, showMoney = true }: { user: SessionUser; f: ApplicationFilters; showMoney?: boolean }) {
  const { applications: a, countries: c } = schema;
  const filters: ApplicationFilters = { from: f.from, to: f.to, country: f.country, intakeYear: f.intakeYear, intakeMonth: f.intakeMonth };

  const [kpis, groups, late, mine, today, aging, unassignedRows, deadlines, recent, partners, countries, destinations, pathways, points, load, enquiries, commission] =
    await Promise.all([
      kpiTotals(user, applicationWhere(user, filters)),
      groupCounts(user),
      lateWork(user),
      agingList(user, 6, eq(a.officerId, user.id)),
      todayCounts(user),
      agingList(user, 8, and(isNotNull(a.officerId), ne(a.officerId, user.id))),
      agingList(user, 6, isNull(a.officerId)),
      deadlineList(user, 14, 6),
      recentChanges(user, 8),
      partnerLeaderboard(6),
      db.select().from(c).orderBy(asc(c.name)),
      countryMix(user, 5),
      pathwayMix(user),
      monthlyPoints(user, 6),
      officerLoad(user),
      enquiryCounts(user),
      commissionTotals(user),
    ]);

  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>), ...extra }).toString();

  return (
    <>
      <DashboardHero
        eyebrow={showMoney ? "Processing desk" : "Documentation desk"}
        title={user.deskLabel ?? "Medcity Overseas"}
        subtitle={
          showMoney
            ? "Everything across all partners. Start with the lanes that are late, then clear what is assigned to you."
            : "Every file across all partners. Documents, checks and messages are yours; statuses are moved by the processing team."
        }
        actions={
          <>
            <LinkButton href="/search" variant="secondary">
              <IconSearch className="size-4" /> Search programs
            </LinkButton>
            <LinkButton href="/admin/queue">
              <IconQueue className="size-4" /> Open work queue
            </LinkButton>
          </>
        }
        meta={[
          { label: "Past SLA", value: late.total },
          { label: "Assigned to me", value: load.mine },
          { label: "Unassigned", value: load.unassigned },
          { label: "New today", value: today.applications },
          { label: "Moves today", value: today.moves },
        ]}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="New / assessment" tone="brand" icon={<IconApplications className="size-4" />} value={groups.NEW} href="/applications?group=NEW" />
            <Stat label="Pending from partner" tone="warn" icon={<IconAlert className="size-4" />} value={groups.PENDING_PARTNER} href="/applications?group=PENDING_PARTNER" />
            <Stat label="In progress" tone="info" icon={<IconClock className="size-4" />} value={groups.IN_PROGRESS} href="/applications?group=IN_PROGRESS" />
            <Stat label="Offer / contract" tone="good" icon={<IconCheck className="size-4" />} value={groups.OFFER} href="/applications?group=OFFER" />
          </div>

          <Card>
            <CardHeader
              title="Lane health"
              subtitle="Live work per lane, and how much of it has passed its service level"
              action={<Link href="/admin/queue" className="text-[13px] font-medium text-brand-600 hover:underline">Work queue</Link>}
            />
            <Table tableClassName="min-w-[560px]">
              <thead>
                <tr>
                  <Th>Lane</Th>
                  <Th>Live</Th>
                  <Th>Past SLA</Th>
                  <Th>Open</Th>
                </tr>
              </thead>
              <tbody>
                {ACTIVE_GROUPS.map((g) => (
                  <tr key={g}>
                    <Td className="font-medium">{GROUP_LABEL[g]}</Td>
                    <Td className="tabular">{groups[g]}</Td>
                    <Td>{(late.perGroup[g] ?? 0) > 0 ? <Chip tone="bad">{late.perGroup[g]}</Chip> : <Chip tone="ok">None</Chip>}</Td>
                    <Td>
                      <Link href={`/applications?group=${g}`} className="text-[13px] font-medium text-brand-600 hover:underline">
                        See list
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <AgingCard rows={mine} showOrg title="Assigned to you" subtitle="Your own files, oldest first" />
          <AgingCard rows={unassignedRows} showOrg title="Nobody has picked these up" subtitle="Live applications with no officer" />
          <AgingCard rows={aging} showOrg title="Carried by the rest of the desk" subtitle="Assigned to another officer, oldest first" />

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Last six months" subtitle="Applications created against visas received" />
              <TrendChart points={points} aLabel="Applications" bLabel="Visas" />
            </Card>
            <Card>
              <CardHeader title="Pathways" subtitle="Where the volume sits" />
              <BarList items={pathways} tone="gold" />
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Partner activity"
              subtitle="Busiest partners by total applications"
              action={<Link href="/admin/partners" className="text-[13px] font-medium text-brand-600 hover:underline">Partners and people</Link>}
            />
            <Table tableClassName="min-w-[620px]">
              <thead>
                <tr>
                  <Th>Partner</Th>
                  <Th>Tier</Th>
                  <Th>Students</Th>
                  <Th>Live</Th>
                  <Th>Visas</Th>
                  <Th>Total</Th>
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
            <CardHeader title="Outcomes" subtitle="Across the filters above" />
            <DataList
              rows={[
                { label: "All applications", value: kpis.all, href: `/applications?${qs({})}` },
                { label: "Offers", value: kpis.offers, href: `/applications?${qs({ kpi: "offers" })}`, tone: "ok" },
                { label: "Fees paid", value: kpis.payments, href: `/applications?${qs({ kpi: "payments" })}` },
                { label: "Visas received", value: kpis.visa_received, href: `/applications?${qs({ kpi: "visa_received" })}`, tone: "ok" },
                { label: "Visa rejected", value: kpis.visa_rejected, href: `/applications?${qs({ kpi: "visa_rejected" })}`, tone: "bad" },
                { label: "Deferrals", value: kpis.deferrals, href: `/applications?${qs({ kpi: "deferrals" })}`, tone: "warn" },
                { label: "Non-enrolment", value: kpis.non_enrolment, href: `/applications?${qs({ kpi: "non_enrolment" })}`, tone: "warn" },
                { label: "On hold", value: groups.HOLD, href: "/applications?group=HOLD" },
                { label: "Closed", value: groups.CLOSED, href: "/applications?group=CLOSED" },
                { label: "Open enquiries", value: enquiries.open, href: "/enquiries?stage=OPEN" },
                { label: "Follow ups overdue", value: enquiries.overdue, href: "/enquiries?due=overdue", tone: enquiries.overdue ? "bad" : undefined },
                ...(showMoney
                  ? [
                      { label: "Commission received, not settled", value: inr(commission.RECEIVED.partner), href: "/admin/commission?status=RECEIVED", tone: (commission.RECEIVED.n ? "warn" : undefined) as "warn" | undefined },
                      { label: "Paid to partners", value: inr(commission.SETTLED.partner), href: "/admin/commission?status=SETTLED", tone: "ok" as const },
                    ]
                  : []),
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Desk load" subtitle="Live files per officer" />
            <BarList
              items={load.officers.map((o) => ({ label: o.name, hint: o.deskLabel ?? undefined, value: o.live }))}
              empty="No officers yet."
            />
          </Card>

          <DeadlinesCard rows={deadlines} />

          <Card>
            <CardHeader title="Destinations" subtitle="Applications by country" />
            <BarList items={destinations} tone="info" />
          </Card>
        </div>
      </div>
    </>
  );
}
