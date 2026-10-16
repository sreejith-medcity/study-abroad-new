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
  deadlineList, windowFor,
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
  AlertTiles,
  DashboardHero,
  DataList,
  LinkButton,
  Table,
  Td,
  Th,
  TrendChart,
} from "@/components/ui";
import { IconQueue, IconSearch } from "@/components/icons";
import { Section } from "@/components/section";
import { AgingCard, DashboardFilters, DeadlinesCard, RecentChangesCard } from "./parts";
import { ownApplicationsOnly } from "@/server/scope";

/** The processing desk: what needs a decision today, and who is carrying it. */
export default async function AdminDashboard({ user, f, showMoney = true }: { user: SessionUser; f: ApplicationFilters; showMoney?: boolean }) {
  const { applications: a, countries: c } = schema;
  const filters: ApplicationFilters = { from: f.from, to: f.to, country: f.country, intakeYear: f.intakeYear, intakeMonth: f.intakeMonth };

  const [kpis, groups, late, mine, today, aging, unassignedRows, deadlines, recent, partners, countries, destinations, pathways, points, load, enquiries, commission] =
    await Promise.all([
      kpiTotals(user, applicationWhere(user, filters, await ownApplicationsOnly(user))),
      groupCounts(user),
      lateWork(user),
      agingList(user, 6, eq(a.officerId, user.id)),
      todayCounts(user),
      agingList(user, 8, and(isNotNull(a.officerId), ne(a.officerId, user.id))),
      agingList(user, 6, isNull(a.officerId)),
      deadlineList(user, windowFor((f as Record<string, string | undefined>).dw), 6),
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
          {/* What is wrong first, then what is moving. A lane at nought is
              said in a line underneath rather than drawn as a card. */}
          <AlertTiles
            allClear="Nothing is open across the partners."
            tiles={[
              { label: "Past the service level", value: late.total, tone: "stop", note: "Across every lane", href: "/admin/queue" },
              { label: "Nobody has picked up", value: load.unassigned, tone: "warn", note: "Waiting on this desk", href: "/applications?assignedTo=none" },
              { label: "Pending from partner", value: groups.PENDING_PARTNER, tone: "warn", href: "/applications?group=PENDING_PARTNER" },
              { label: "New / assessment", value: groups.NEW, tone: "brand", always: true, href: "/applications?group=NEW" },
              { label: "In progress", value: groups.IN_PROGRESS, tone: "info", always: true, href: "/applications?group=IN_PROGRESS" },
              { label: "Offer / contract", value: groups.OFFER, tone: "good", always: true, href: "/applications?group=OFFER" },
            ]}
          />

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
          <AgingCard rows={aging} showOrg fold title="Carried by the rest of the desk" subtitle="Assigned to another officer, oldest first" />

          {/* Read when somebody asks a question of them, not every morning,
              so they start folded and say what they hold on the line. */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Section id="trend" title="Last six months" meta="Applications against visas" defaultOpen={false}>
              <TrendChart points={points} aLabel="Applications" bLabel="Visas" />
            </Section>
            <Section id="pathways" title="Pathways" meta="Where the volume sits" defaultOpen={false}>
              <BarList items={pathways} tone="gold" />
            </Section>
          </div>

          <Section id="partner-activity" title="Partner activity" meta="Busiest partners by total applications" defaultOpen={false} bodyClassName="">

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
          </Section>

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

          <Section id="desk-load" title="Desk load" meta="Live files per officer" defaultOpen={false}>
            <BarList
              items={load.officers.map((o) => ({ label: o.name, hint: o.deskLabel ?? undefined, value: o.live }))}
              empty="No officers yet."
            />
          </Section>

          <DeadlinesCard rows={deadlines} window={(f as Record<string, string | undefined>).dw ?? "14"} />

          <Section id="destinations" title="Destinations" meta="Applications by country" defaultOpen={false}>
            <BarList items={destinations} tone="info" />
          </Section>
        </div>
      </div>
    </>
  );
}
