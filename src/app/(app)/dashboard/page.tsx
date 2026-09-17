import Link from "next/link";
import { and, asc, count, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { fmtDate, fullName, intakeLabel, MONTHS } from "@/lib/format";
import { applicationWhere, KPI_WHERE, readFilters } from "@/server/queries";
import { Button, Card, CardHeader, Chip, Input, LinkButton, PageHeader, Progress, Select, Stat, StatusBadge, Toolbar } from "@/components/ui";
import { IconAlert, IconApplications, IconCheck, IconClock, IconDoc, IconPlus, IconSpark } from "@/components/icons";

export const metadata = { title: "Dashboard" };

const TILES = [
  { key: "", label: "All applications", tone: "brand" as const },
  { key: "pending_partner", label: "Needs your action", tone: "warn" as const },
  { key: "offers", label: "Offers", tone: "good" as const },
  { key: "visa_received", label: "Visa received", tone: "good" as const },
  { key: "payments", label: "Fees paid", tone: "info" as const },
  { key: "deferrals", label: "Deferrals", tone: "warn" as const },
  { key: "non_enrolment", label: "Non-enrolment", tone: "warn" as const },
  { key: "visa_rejected", label: "Visa rejected", tone: "stop" as const },
] as const;

const TILE_ICON = {
  "": <IconApplications className="size-4" />,
  pending_partner: <IconAlert className="size-4" />,
  offers: <IconCheck className="size-4" />,
  visa_received: <IconCheck className="size-4" />,
  payments: <IconDoc className="size-4" />,
  deferrals: <IconClock className="size-4" />,
  non_enrolment: <IconClock className="size-4" />,
  visa_rejected: <IconAlert className="size-4" />,
} as Record<string, React.ReactNode>;

const TIER_TARGETS = { SILVER: 10, GOLD: 20, ELITE: 50, PLATINUM: 50 } as const;
const NEXT_TIER = { SILVER: "Gold", GOLD: "Elite", ELITE: "Platinum", PLATINUM: null } as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(["ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR"]);
  const f = readFilters(await searchParams);
  const where = applicationWhere(user, { from: f.from, to: f.to, country: f.country, intakeYear: f.intakeYear, intakeMonth: f.intakeMonth });

  const { applications: a, statusDefinitions: sd, programs: p, universities: u, countries: c, students: s } = schema;

  const selection = Object.fromEntries([
    ["all", sql<number>`count(*)::int`],
    ...Object.entries(KPI_WHERE).map(([k, cond]) => [k, sql<number>`(count(*) filter (where ${cond}))::int`]),
  ]) as Record<string, ReturnType<typeof sql<number>>>;

  const [kpis] = await db
    .select(selection)
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .innerJoin(p, eq(a.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where);

  const now = new Date();
  const in14 = new Date(Date.now() + 14 * 86400000);
  const deadlines = await db
    .select({ id: a.id, ackNo: a.ackNo, deadline: a.deadline, studentId: s.id, firstName: s.firstName, lastName: s.lastName, program: p.name, university: u.name })
    .from(a)
    .innerJoin(s, eq(a.studentId, s.id))
    .innerJoin(p, eq(a.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .where(and(applicationWhere(user, {}), isNotNull(a.deadline), gte(a.deadline, now), lte(a.deadline, in14)))
    .orderBy(asc(a.deadline))
    .limit(6);

  const recent = await db
    .select({ id: a.id, ackNo: a.ackNo, studentId: s.id, firstName: s.firstName, lastName: s.lastName, statusLabel: sd.label, statusGroup: sd.group, changedAt: a.statusChangedAt, intakeMonth: a.intakeMonth, intakeYear: a.intakeYear })
    .from(a)
    .innerJoin(s, eq(a.studentId, s.id))
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(applicationWhere(user, {}))
    .orderBy(sql`${a.statusChangedAt} desc`)
    .limit(6);

  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId), with: { relationshipManager: true } });
  const yearAgo = new Date(Date.now() - 365 * 86400000);
  const [{ visas12m }] = await db
    .select({ visas12m: sql<number>`count(distinct ${a.studentId})::int` })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(and(applicationWhere(user, {}), KPI_WHERE.visa_received, gte(a.statusChangedAt, yearAgo)));

  const countries = await db.select().from(c).orderBy(asc(c.name));
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([k]) => ["from", "to", "country", "intakeYear", "intakeMonth"].includes(k))), ...extra }).toString();

  const partner = !isStaff(user);
  const [{ openStudents }] = await db.select({ openStudents: count() }).from(s).where(and(partner ? eq(s.orgId, user.orgId) : undefined, eq(s.archived, false)));

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={partner ? `Welcome, ${user.orgName}` : "All partners"}
        actions={
          partner ? (
            <>
              <LinkButton href="/search" variant="secondary">
                <IconSpark className="size-4" /> Find programs
              </LinkButton>
              <LinkButton href="/students/new">
                <IconPlus className="size-4" /> Register student
              </LinkButton>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Toolbar>
            <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
              <div className="flex gap-2 sm:col-span-2">
                <Input type="date" name="from" aria-label="Created from" defaultValue={f.from} />
                <Input type="date" name="to" aria-label="Created to" defaultValue={f.to} />
              </div>
              <Select name="intakeMonth" aria-label="Intake month" defaultValue={f.intakeMonth ?? ""}>
                <option value="">Intake month</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </Select>
              <Select name="intakeYear" aria-label="Intake year" defaultValue={f.intakeYear ?? ""}>
                <option value="">Intake year</option>
                {years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </Select>
              <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
                <option value="">All countries</option>
                {countries.map((x) => (
                  <option key={x.id} value={x.code}>{x.name}</option>
                ))}
              </Select>
              <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-4">
                <LinkButton href="/dashboard" variant="quiet" size="sm">Clear filters</LinkButton>
                <Button type="submit" variant="secondary" size="sm">Apply filters</Button>
              </div>
            </form>
          </Toolbar>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {TILES.map((t) => (
              <Stat
                key={t.label}
                label={t.label}
                tone={t.tone}
                icon={TILE_ICON[t.key]}
                value={t.key ? kpis[t.key] : kpis.all}
                href={`/applications?${qs(t.key ? { kpi: t.key } : {})}`}
              />
            ))}
          </div>

          <Card>
            <CardHeader
              title="Recent status changes"
              subtitle="What moved most recently"
              action={<Link href="/applications" className="text-[13px] font-medium text-brand-600 hover:underline">All applications</Link>}
            />
            <ul>
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-3 last:border-0">
                  <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="ack font-medium text-brand-700 hover:underline">{r.ackNo}</Link>
                  <span className="font-medium">{fullName(r)}</span>
                  <span className="text-[13px] text-muted">{intakeLabel(r.intakeMonth, r.intakeYear)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <StatusBadge group={r.statusGroup} label={r.statusLabel} />
                    <span className="text-xs text-muted">{fmtDate(r.changedAt)}</span>
                  </span>
                </li>
              ))}
              {recent.length === 0 && <li className="px-4 py-8 text-center text-muted">No applications yet.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          {partner && org && (
            <Card className="overflow-hidden">
              <div className="brand-wash grain relative px-4 py-3.5">
                <p className="relative z-10 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Benefits level</p>
                <p className="relative z-10 font-display text-xl font-semibold text-white">
                  {org.tier.charAt(0) + org.tier.slice(1).toLowerCase()}
                </p>
              </div>
              <div className="p-4">
                <Progress value={visas12m} max={TIER_TARGETS[org.tier]} tone="gold" />
                <p className="mt-2 text-[13px] text-muted">
                  <span className="font-semibold text-ink tabular">{visas12m}</span> students with a visa in the last 12 months
                </p>
                {NEXT_TIER[org.tier] && (
                  <p className="mt-1 text-[13px] text-muted">
                    {Math.max(0, TIER_TARGETS[org.tier] - visas12m)} more to unlock {NEXT_TIER[org.tier]}
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[13px]">
                  <div>
                    <dt className="text-muted">Counsellor seats</dt>
                    <dd className="font-semibold tabular">{org.counsellorSeats}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Active students</dt>
                    <dd className="font-semibold tabular">{openStudents}</dd>
                  </div>
                </dl>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Upcoming deadlines" subtitle="Next 14 days" />
            <ul>
              {deadlines.map((d) => (
                <li key={d.id} className="border-b border-line px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/students/${d.studentId}/applications?app=${d.id}`} className="font-medium hover:underline">{fullName(d)}</Link>
                    <Chip tone="bad"><IconClock className="size-3.5" /> {fmtDate(d.deadline)}</Chip>
                  </div>
                  <p className="text-xs text-muted">{d.program} · {d.university}</p>
                </li>
              ))}
              {deadlines.length === 0 && <li className="px-4 py-6 text-center text-muted">No upcoming deadlines.</li>}
            </ul>
          </Card>

          {partner && org?.relationshipManager && (
            <Card className="p-4">
              <h2 className="font-display text-[15px] font-semibold">Your relationship manager</h2>
              <p className="mt-2 font-medium">{org.relationshipManager.name}</p>
              <p className="text-muted">{org.relationshipManager.deskLabel}</p>
              <p className="text-muted tabular">{org.relationshipManager.phone}</p>
              <a href={`mailto:${org.relationshipManager.email}`} className="text-brand-600 hover:underline">{org.relationshipManager.email}</a>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
