import Link from "next/link";
import { and, asc, count, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { fmtDate, fullName, greetingName } from "@/lib/format";
import { applicationWhere, type ApplicationFilters } from "@/server/queries";
import { getSettings, tierTargets } from "@/server/settings";
import { agingList, countryMix, deadlineList, windowFor, funnel, kpiTotals, monthlyPoints, myWork, recentChanges, teamLoad } from "@/server/dashboard";
import { STAGE_LABEL, STAGE_TONE, enquiryCounts, followUpQueue } from "@/server/enquiries";
import { commissionTotals, inr, walletBalance } from "@/server/commission";
import {
  BarList,
  Card,
  CardHeader,
  Chip,
  DashboardHero,
  DataList,
  EmptyState,
  FunnelSteps,
  LinkButton,
  Progress,
  Stat,
  Table,
  Td,
  Th,
  TrendChart,
} from "@/components/ui";
import { IconAlert, IconApplications, IconChat, IconCheck, IconClock, IconDoc, IconEnquiry, IconPlus, IconSearch, IconSpark } from "@/components/icons";
import { AgingCard, DashboardFilters, DeadlinesCard, RecentChangesCard } from "./parts";
import { AnnouncementBanner, UpdatesCard } from "./updates-card";

const TILES = [
  { key: "", label: "All applications", tone: "brand" as const, icon: <IconApplications className="size-4" /> },
  { key: "pending_partner", label: "Needs your action", tone: "warn" as const, icon: <IconAlert className="size-4" /> },
  { key: "offers", label: "Offers", tone: "good" as const, icon: <IconCheck className="size-4" /> },
  { key: "visa_received", label: "Visa received", tone: "good" as const, icon: <IconCheck className="size-4" /> },
  { key: "payments", label: "Fees paid", tone: "info" as const, icon: <IconDoc className="size-4" /> },
  { key: "deferrals", label: "Deferrals", tone: "warn" as const, icon: <IconClock className="size-4" /> },
  { key: "non_enrolment", label: "Non-enrolment", tone: "warn" as const, icon: <IconClock className="size-4" /> },
  { key: "visa_rejected", label: "Visa rejected", tone: "stop" as const, icon: <IconAlert className="size-4" /> },
];

const NEXT_TIER = { SILVER: "Gold", GOLD: "Elite", ELITE: "Platinum", PLATINUM: null } as const;

function partOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Two related dashboards. The owner sees the branch: volume, the team and the
 * tier. A counsellor sees only their own desk: what is waiting on them today.
 */
export default async function PartnerDashboard({
  user,
  f,
  variant,
}: {
  user: SessionUser;
  f: ApplicationFilters;
  variant: "owner" | "counsellor";
}) {
  const { applications: a, students: s, countries: c, organizations: og } = schema;
  const filters: ApplicationFilters = { from: f.from, to: f.to, country: f.country, intakeYear: f.intakeYear, intakeMonth: f.intakeMonth };
  const mine = variant === "counsellor" ? eq(s.assignedToId, user.id) : undefined;

  const [kpis, work, deadlines, recent, org, countries, destinations, points, steps, enquiries, followUps, wallet, commission] = await Promise.all([
    kpiTotals(user, and(applicationWhere(user, filters), mine)),
    myWork(user),
    deadlineList(user, windowFor((f as Record<string, string | undefined>).dw), 6, mine),
    recentChanges(user, 6, mine),
    db.query.organizations.findFirst({ where: eq(og.id, user.orgId), with: { relationshipManager: true } }),
    db.select().from(c).orderBy(asc(c.name)),
    countryMix(user, 5),
    monthlyPoints(user, 6),
    funnel(user),
    enquiryCounts(user),
    followUpQueue(user, 5),
    walletBalance(user.orgId),
    commissionTotals(user),
  ]);

  const targets = tierTargets(await getSettings());

  const yearAgo = new Date(Date.now() - 365 * 86400000);
  const [[{ visas12m }], [{ openStudents }], team, waiting] = await Promise.all([
    db
      .select({ visas12m: count() })
      .from(a)
      .innerJoin(schema.statusDefinitions, eq(a.statusId, schema.statusDefinitions.id))
      .where(and(eq(a.orgId, user.orgId), gte(a.statusChangedAt, yearAgo), eq(schema.statusDefinitions.code, "VISA_RECEIVED"))),
    db.select({ openStudents: count() }).from(s).where(and(eq(s.orgId, user.orgId), eq(s.archived, false))),
    variant === "owner" ? teamLoad(user.orgId) : Promise.resolve([]),
    agingList(user, 6, mine),
  ]);

  const qs = (extra: Record<string, string>) =>
    new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>, ...extra }).toString();

  const seatsUsed = team.filter((t) => t.active).length;

  return (
    <>
      <DashboardHero
        eyebrow={variant === "owner" ? `${org?.type === "SUB_AGENT" ? "Sub-agent" : "Branch"} workspace` : "Your desk"}
        title={variant === "owner" ? user.orgName : `${partOfDay()}, ${greetingName(user.name)}`}
        subtitle={
          variant === "owner"
            ? "Your branch at a glance: what is live, what is waiting on your team, and how close you are to the next benefits level."
            : "Everything assigned to you, with the items the Medcity Overseas team is waiting on at the top."
        }
        actions={
          <>
            <LinkButton href="/search" variant="secondary">
              <IconSearch className="size-4" /> Find programs
            </LinkButton>
            <LinkButton href="/program-options/new" variant="secondary">
              Request program options
            </LinkButton>
            <LinkButton href="/students/new">
              <IconPlus className="size-4" /> Register student
            </LinkButton>
          </>
        }
        meta={
          variant === "owner"
            ? [
                { label: "Live applications", value: kpis.all - (kpis.visa_received ?? 0) },
                { label: "Waiting on us", value: kpis.pending_partner },
                { label: "Open enquiries", value: enquiries.open },
                { label: "Offers", value: kpis.offers },
                { label: "Active students", value: Number(openStudents) },
              ]
            : [
                { label: "My students", value: work.students },
                { label: "Waiting on me", value: work.waiting },
                { label: "Live applications", value: work.live },
                { label: "Follow ups due", value: enquiries.overdue + enquiries.dueToday },
                { label: "Student replies", value: work.replies.length },
              ]
        }
      />
      <AnnouncementBanner />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <DashboardFilters f={f as Record<string, string | undefined>} countries={countries} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {TILES.map((t) => (
              <Stat
                key={t.label}
                label={t.label}
                tone={t.tone}
                icon={t.icon}
                value={t.key ? kpis[t.key] : kpis.all}
                href={`/applications?${qs(t.key ? { kpi: t.key } : {})}`}
              />
            ))}
          </div>

          <AgingCard
            rows={waiting}
            title={variant === "owner" ? "Waiting on your branch" : "Waiting on you"}
            subtitle="Oldest first. Anything marked late is holding up the file."
          />

          {variant === "counsellor" && (
            <Card>
              <CardHeader
                title="Student replies"
                subtitle="Messages that came in on WhatsApp and have not been read"
                action={<Link href="/applications?group=PENDING_PARTNER" className="text-[13px] font-medium text-brand-600 hover:underline">Open thread list</Link>}
              />
              {work.replies.length === 0 ? (
                <EmptyState title="No unread replies" icon={<IconChat className="size-5" />}>
                  Replies from students land here as soon as they arrive.
                </EmptyState>
              ) : (
                <ul>
                  {work.replies.map((r) => (
                    <li key={r.id} className="border-b border-line px-4 py-3 last:border-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <Link href={`/students/${r.studentId}/applications?app=${r.applicationId}`} className="font-medium hover:underline">
                          {fullName(r)}
                        </Link>
                        <span className="shrink-0 text-xs text-muted">{fmtDate(r.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{r.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title="Enquiries to call"
              subtitle={enquiries.overdue > 0 ? `${enquiries.overdue} overdue, oldest first` : "Oldest follow-up date first"}
              action={<Link href="/enquiries" className="text-[13px] font-medium text-brand-600 hover:underline">All enquiries</Link>}
            />
            {followUps.length === 0 ? (
              <EmptyState title="Nothing to chase" icon={<IconEnquiry className="size-5" />}>
                New walk-ins and calls appear here with their follow-up date.
              </EmptyState>
            ) : (
              <ul>
                {followUps.map((q) => {
                  const overdue = q.nextFollowUpAt && q.nextFollowUpAt.getTime() < Date.now();
                  return (
                    <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-0">
                      <Link href={`/enquiries/${q.id}`} className="font-medium hover:underline">{q.name}</Link>
                      <span className="text-[13px] text-muted tabular">{q.phone}</span>
                      <span className="text-[13px] text-muted">{q.interestCountry ?? "Destination open"}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <Chip tone={STAGE_TONE[q.stage]}>{STAGE_LABEL[q.stage]}</Chip>
                        <Chip tone={overdue ? "bad" : "neutral"}>{q.nextFollowUpAt ? fmtDate(q.nextFollowUpAt) : "No date"}</Chip>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader
                title={variant === "owner" ? "Your funnel" : "Branch funnel"}
                subtitle={variant === "owner" ? "Everything your organisation has registered" : `Everything ${user.orgName} has registered, not only your students`}
              />
              <FunnelSteps steps={steps} />
            </Card>
            <Card>
              <CardHeader title="Last six months" subtitle="Applications created against visas received" />
              <TrendChart points={points} aLabel="Applications" bLabel="Visas" />
            </Card>
          </div>

          <RecentChangesCard rows={recent} />

          {variant === "owner" && (
            <Card>
              <CardHeader
                title="Your team"
                subtitle={`${seatsUsed} of ${org?.counsellorSeats ?? 0} counsellor seats in use`}
                action={<span className="text-[13px] text-muted">Assign students from the student list</span>}
              />
              {team.length === 0 ? (
                <EmptyState title="No counsellors yet">Ask your relationship manager to add seats.</EmptyState>
              ) : (
                <Table tableClassName="min-w-[620px]">
                  <thead>
                    <tr>
                      <Th>Person</Th>
                      <Th>Students</Th>
                      <Th>Live</Th>
                      <Th>Waiting on them</Th>
                      <Th>Visas</Th>
                      <Th>Last seen</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.map((t) => (
                      <tr key={t.id}>
                        <Td>
                          <p className={t.active ? "font-medium" : "text-muted line-through"}>{t.name}</p>
                          <p className="text-xs text-muted">{t.deskLabel ?? (t.role === "PARTNER" ? "Owner" : "Counsellor")}</p>
                        </Td>
                        <Td className="tabular">{t.students}</Td>
                        <Td className="tabular">{t.live}</Td>
                        <Td>{t.waiting > 0 ? <Chip tone="warn">{t.waiting}</Chip> : <span className="text-muted">0</span>}</Td>
                        <Td className="tabular">{t.won}</Td>
                        <Td className="whitespace-nowrap text-[13px] text-muted">{t.lastSignInAt ? fmtDate(t.lastSignInAt) : "Never"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {org && (
            <Card className="overflow-hidden">
              {/* The companion surface, so the hero stays the only block of crimson. */}
              <div className="tier-wash grain relative px-4 py-3.5">
                <p className="relative z-10 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Benefits level</p>
                <p className="relative z-10 font-display text-xl font-semibold text-gold-300">
                  {org.tier.charAt(0) + org.tier.slice(1).toLowerCase()}
                </p>
              </div>
              <div className="p-4">
                <Progress value={Number(visas12m)} max={targets[org.tier]} tone="gold" />
                <p className="mt-2 text-[13px] text-muted">
                  <span className="font-semibold text-ink tabular">{Number(visas12m)}</span> students with a visa in the last 12 months
                </p>
                {NEXT_TIER[org.tier] && (
                  <p className="mt-1 text-[13px] text-muted">
                    {Math.max(0, targets[org.tier] - Number(visas12m))} more to unlock {NEXT_TIER[org.tier]}
                  </p>
                )}
              </div>
              <DataList
                rows={[
                  { label: "Wallet balance", value: inr(wallet.balance), href: "/wallet", tone: wallet.balance > 0 ? "ok" : undefined },
                  { label: "Commission in flight", value: inr(commission.EXPECTED.partner + commission.INVOICED.partner + commission.RECEIVED.partner), href: "/commission" },
                  { label: "Counsellor seats", value: org.counsellorSeats },
                  { label: "Active students", value: Number(openStudents) },
                  { label: variant === "counsellor" ? "My documents" : "Documents on file", value: variant === "counsellor" ? work.documents : work.orgDocuments },
                ]}
              />
            </Card>
          )}

          <DeadlinesCard rows={deadlines} window={(f as Record<string, string | undefined>).dw ?? "14"} />

          <UpdatesCard country={(f as Record<string, string | undefined>).uc} />

          <Card>
            <CardHeader title="Where you send students" subtitle="Applications by destination" />
            <BarList items={destinations} empty="No applications yet." />
          </Card>

          {org?.relationshipManager && (
            <Card className="p-4">
              <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
                <IconSpark className="size-4 text-brand-600" /> Your relationship manager
              </h2>
              <p className="mt-2 font-medium">{org.relationshipManager.name}</p>
              <p className="text-muted">{org.relationshipManager.deskLabel}</p>
              <p className="text-muted tabular">{org.relationshipManager.phone}</p>
              <a href={`mailto:${org.relationshipManager.email}`} className="text-brand-600 hover:underline">
                {org.relationshipManager.email}
              </a>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
