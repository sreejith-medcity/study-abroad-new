import Link from "next/link";
import { and, asc, count, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { fmtDate, fullName, intakeLabel, MONTHS } from "@/lib/format";
import { applicationWhere, KPI_WHERE, readFilters } from "@/server/queries";
import { Button, Card, Chip, Input, LinkButton, PageHeader, Select, StatusBadge } from "@/components/ui";

export const metadata = { title: "Dashboard" };

const TILES = [
  { key: "", label: "All applications", accent: "border-l-brand-600" },
  { key: "offers", label: "Offers", accent: "border-l-brand-600" },
  { key: "payments", label: "Payments", accent: "border-l-emerald-600" },
  { key: "visa_received", label: "Visa received", accent: "border-l-emerald-600" },
  { key: "visa_rejected", label: "Visa rejected", accent: "border-l-red-600" },
  { key: "non_enrolment", label: "Non-enrolment", accent: "border-l-amber-500" },
  { key: "deferrals", label: "Deferrals", accent: "border-l-amber-500" },
  { key: "pending_partner", label: "Pending from partner", accent: "border-l-amber-500" },
] as const;

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
              <Button variant="secondary" disabled title="Planned for Phase 2">+ Request program options</Button>
              <LinkButton href="/students/new">+ Register new student</LinkButton>
            </>
          ) : undefined
        }
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card className="p-4">
            <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="lg:col-span-2 flex gap-2">
                <Input type="date" name="from" aria-label="Created from" defaultValue={f.from} />
                <Input type="date" name="to" aria-label="Created to" defaultValue={f.to} />
              </div>
              <Select name="intakeMonth" aria-label="Intake month" defaultValue={f.intakeMonth ?? ""}>
                <option value="">Intake</option>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
              <Select name="intakeYear" aria-label="Intake year" defaultValue={f.intakeYear ?? ""}>
                <option value="">Year</option>
                {years.map((y) => <option key={y}>{y}</option>)}
              </Select>
              <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
                <option value="">Countries</option>
                {countries.map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}
              </Select>
              <div className="flex gap-2">
                <Button type="submit" variant="secondary" className="flex-1">Apply filters</Button>
                <LinkButton href="/dashboard" variant="ghost">Clear</LinkButton>
              </div>
            </form>

            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {TILES.map((t) => (
                <Link
                  key={t.label}
                  href={`/applications?${qs(t.key ? { kpi: t.key } : {})}`}
                  className={`rounded-md border border-line border-l-4 ${t.accent} bg-ground/50 px-3 py-3 hover:bg-brand-50`}
                >
                  <p className="text-muted">{t.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular">{t.key ? kpis[t.key] : kpis.all}</p>
                </Link>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold">Recent status changes</h2>
              <Link href="/applications" className="text-brand-600 hover:underline">All applications</Link>
            </div>
            <ul>
              {recent.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                  <Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="font-medium text-ink hover:underline">{r.ackNo}</Link>
                  <span>{fullName(r)}</span>
                  <span className="text-muted">{intakeLabel(r.intakeMonth, r.intakeYear)}</span>
                  <span className="ml-auto flex items-center gap-2"><StatusBadge group={r.statusGroup} label={r.statusLabel} /><span className="text-xs text-muted">{fmtDate(r.changedAt)}</span></span>
                </li>
              ))}
              {recent.length === 0 && <li className="px-4 py-8 text-center text-muted">No applications yet.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-5">
          {partner && org && (
            <Card className="p-4">
              <p className="text-xs text-muted">Your benefits level</p>
              <p className="text-lg font-semibold">{org.tier.charAt(0) + org.tier.slice(1).toLowerCase()}</p>
              <div className="mt-2 h-2 rounded-full bg-ground">
                <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (visas12m / TIER_TARGETS[org.tier]) * 100)}%` }} />
              </div>
              <p className="mt-2 text-muted"><span className="font-medium text-ink tabular">{visas12m}</span> students with a visa in the last 12 months</p>
              {NEXT_TIER[org.tier] && <p className="mt-1 text-xs text-muted">{Math.max(0, TIER_TARGETS[org.tier] - visas12m)} more to unlock {NEXT_TIER[org.tier]}</p>}
              <p className="mt-3 border-t border-line pt-3 text-xs text-muted">Counsellor seats: {org.counsellorSeats} · Active students: <span className="tabular">{openStudents}</span></p>
            </Card>
          )}

          <Card>
            <div className="border-b border-line px-4 py-3"><h2 className="font-semibold">Upcoming deadlines</h2><p className="text-xs text-muted">Next 14 days</p></div>
            <ul>
              {deadlines.map((d) => (
                <li key={d.id} className="border-b border-line px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/students/${d.studentId}/applications?app=${d.id}`} className="font-medium hover:underline">{fullName(d)}</Link>
                    <Chip tone="bad">{fmtDate(d.deadline)}</Chip>
                  </div>
                  <p className="text-xs text-muted">{d.program} · {d.university}</p>
                </li>
              ))}
              {deadlines.length === 0 && <li className="px-4 py-6 text-center text-muted">No upcoming deadlines.</li>}
            </ul>
          </Card>

          {partner && org?.relationshipManager && (
            <Card className="p-4">
              <h2 className="font-semibold">Your relationship manager</h2>
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
