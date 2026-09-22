import Link from "next/link";
import { and, asc, count, eq, gte, ilike, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isStaff, orgScope } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth";
import { DEADLINE_LABEL, DEADLINE_TYPES } from "@/lib/deadline-types";
import { LEVEL_LABEL, dayText, daysUntil } from "@/lib/catalogue";
import { MONTHS } from "@/lib/format";
import { readFilters } from "@/server/queries";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th, Toolbar, cn } from "@/components/ui";
import { IconClock } from "@/components/icons";

export const metadata = { title: "Deadlines" };

const PAGE = 100;
const WINDOWS = [30, 60, 120, 365] as const;

/**
 * Application deadlines coming up across live programs, soonest first, with
 * the branch's own students who have the program on their shortlist.
 */
export default async function DeadlinesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const f = readFilters(await searchParams) as Record<string, string>;
  if (f.tab === "applications") return <ApplicationDeadlines user={user} f={f} />;
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const days = (WINDOWS as readonly number[]).includes(Number(f.days)) ? Number(f.days) : 60;
  const { programDeadlines: d, programs: p, universities: u, countries: c, shortlists: sl, students: st } = schema;

  // Whose shortlists count: the branch's own students, or everyone's for the Overseas team.
  const scope = isStaff(user) ? sql`true` : sql`${st.orgId} = ${user.orgId}`;
  const shortlistedBy = sql<string[]>`coalesce((
    select array_agg(${st.firstName} || ' ' || ${st.lastName} order by ${st.firstName})
    from ${sl} join ${st} on ${st.id} = ${sl.studentId}
    where ${sl.programId} = ${p.id} and ${st.archived} = false and ${scope}
  ), '{}')`;

  const conds: (SQL | undefined)[] = [eq(p.status, "LIVE"), gte(d.deadline, sql`current_date`), lte(d.deadline, sql`current_date + ${days}::int`)];
  if (f.q) conds.push(or(ilike(p.name, `%${f.q}%`), ilike(u.name, `%${f.q}%`)));
  if (f.country) conds.push(eq(c.code, f.country));
  if (f.level) conds.push(sql`${p.level} = ${f.level}::study_level`);
  if (f.mine) conds.push(sql`cardinality(${shortlistedBy}) > 0`);
  const where = and(...conds);

  const rows = await db
    .select({ id: d.id, deadline: d.deadline, note: d.note, month: d.intakeMonth, year: d.intakeYear, programId: p.id, program: p.name, level: p.level, university: u.name, universityId: u.id, country: c.name, shortlistedBy })
    .from(d)
    .innerJoin(p, eq(d.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where)
    .orderBy(asc(d.deadline), asc(p.name))
    .limit(PAGE)
    .offset((page - 1) * PAGE);
  const [{ total }] = await db
    .select({ total: count() })
    .from(d)
    .innerJoin(p, eq(d.programId, p.id))
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where);
  const countries = await db.select({ code: c.code, name: c.name }).from(c).orderBy(asc(c.name));
  const qs = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) sp.set(k, v);
    return `/deadlines?${sp}`;
  };

  return (
    <>
      <PageHeader title="Deadlines" subtitle={`${total.toLocaleString("en-IN")} institution deadline${total === 1 ? "" : "s"} in the next ${days} days`} />
      <DeadlineTabs on="programs" />
      <Toolbar>
        <form className="grid w-full gap-2.5 sm:grid-cols-2 xl:grid-cols-6 [&>*]:min-w-0">
          <Input name="q" defaultValue={f.q} placeholder="Program or university" aria-label="Search" className="sm:col-span-2" />
          <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
            <option value="">All destinations</option>
            {countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </Select>
          <Select name="level" aria-label="Level" defaultValue={f.level ?? ""}>
            <option value="">Any level</option>
            {Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select name="days" aria-label="Window" defaultValue={String(days)}>
            {WINDOWS.map((w) => <option key={w} value={w}>Next {w} days</option>)}
          </Select>
          <label className="flex items-center gap-2 text-[13px] text-ink-soft">
            <input type="checkbox" name="mine" value="1" defaultChecked={!!f.mine} className="size-4 accent-brand-600" />
            {isStaff(user) ? "Shortlisted by any student" : "On my students' shortlists"}
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-6">
            <LinkButton href="/deadlines" variant="quiet" size="sm">Clear all</LinkButton>
            <Button type="submit" size="sm">Show</Button>
          </div>
        </form>
      </Toolbar>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<IconClock />} title="No deadlines in this window">
            Only deadlines the Overseas team has recorded from the institutions show here. Widen the window or clear a filter.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[860px]">
            <thead><tr><Th>Apply by</Th><Th>Program</Th><Th>Intake</Th><Th>Shortlisted for</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const left = daysUntil(r.deadline);
                return (
                  <tr key={r.id} className="hover:bg-surface-2/60">
                    <Td className="whitespace-nowrap">
                      <p className="font-medium tabular">{dayText(r.deadline)}</p>
                      <p className={cn("text-xs", left <= 7 ? "font-medium text-red-700" : left <= 21 ? "font-medium text-amber-700" : "text-muted")}>
                        {left === 0 ? "Closes today" : left === 1 ? "1 day left" : `${left} days left`}
                      </p>
                    </Td>
                    <Td>
                      <Link prefetch={false} href={`/programs/${r.programId}`} className="font-medium text-ink hover:text-brand-700 hover:underline">{r.program}</Link>
                      <p className="text-xs text-muted">
                        <Link prefetch={false} href={`/universities/${r.universityId}`} className="hover:underline">{r.university}</Link>, {r.country} · {LEVEL_LABEL[r.level] ?? r.level}
                        {r.note ? ` · ${r.note}` : ""}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap text-[13px]">{MONTHS[r.month - 1]} {r.year}</Td>
                    <Td className="text-[13px]">
                      {r.shortlistedBy.length ? (
                        <div className="flex flex-wrap gap-1">
                          {r.shortlistedBy.slice(0, 3).map((n) => <Chip key={n} tone="info">{n}</Chip>)}
                          {r.shortlistedBy.length > 3 && <Chip>+{r.shortlistedBy.length - 3} more</Chip>}
                        </div>
                      ) : <span className="text-muted">None</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {(page > 1 || page * PAGE < total) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px]">
            <span className="text-muted">Page {page} of {Math.ceil(total / PAGE)}</span>
            <div className="flex gap-2">
              {page > 1 && <LinkButton prefetch={false} variant="secondary" size="sm" href={qs({ page: String(page - 1) })}>Previous</LinkButton>}
              {page * PAGE < total && <LinkButton prefetch={false} variant="secondary" size="sm" href={qs({ page: String(page + 1) })}>Next</LinkButton>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function DeadlineTabs({ on }: { on: "programs" | "applications" }) {
  const pill = (href: string, label: string, active: boolean) => (
    <Link href={href} className={cn("rounded-full border px-3 py-1 text-[13px] font-medium", active ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft hover:border-brand-300")}>{label}</Link>
  );
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {pill("/deadlines", "Institution deadlines", on === "programs")}
      {pill("/deadlines?tab=applications", "Your applications", on === "applications")}
    </div>
  );
}

/** Open milestones on applications (pay by, CAS by, accept by...), soonest first, overdue ones on top. */
async function ApplicationDeadlines({ user, f }: { user: SessionUser; f: Record<string, string> }) {
  const d = schema.applicationDeadlines;
  const a = schema.applications;
  const days = (WINDOWS as readonly number[]).includes(Number(f.days)) ? Number(f.days) : 60;
  const conds: (SQL | undefined)[] = [isNull(d.doneAt), sql`${d.dueOn} <= current_date + ${days}::int`, orgScope(user, a.orgId)];
  if ((DEADLINE_TYPES as readonly string[]).includes(f.type)) conds.push(sql`${d.type} = ${f.type}::deadline_type`);
  if (f.country) conds.push(eq(schema.countries.code, f.country));
  const rows = await db
    .select({ id: d.id, type: d.type, dueOn: d.dueOn, note: d.note, appId: a.id, ackNo: a.ackNo, studentId: schema.students.id, firstName: schema.students.firstName, lastName: schema.students.lastName, program: schema.programs.name, university: schema.universities.name })
    .from(d)
    .innerJoin(a, eq(d.applicationId, a.id))
    .innerJoin(schema.students, eq(a.studentId, schema.students.id))
    .innerJoin(schema.programs, eq(a.programId, schema.programs.id))
    .innerJoin(schema.universities, eq(schema.programs.universityId, schema.universities.id))
    .innerJoin(schema.countries, eq(schema.universities.countryId, schema.countries.id))
    .where(and(...conds))
    .orderBy(asc(d.dueOn))
    .limit(300);
  const countries = await db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name));
  return (
    <>
      <PageHeader title="Deadlines" subtitle={`${rows.length} open application deadline${rows.length === 1 ? "" : "s"} in the next ${days} days, overdue first`} />
      <DeadlineTabs on="applications" />
      <Toolbar>
        <form className="grid w-full gap-2.5 sm:grid-cols-4 [&>*]:min-w-0">
          <input type="hidden" name="tab" value="applications" />
          <Select name="type" aria-label="Deadline type" defaultValue={f.type ?? ""}>
            <option value="">Any deadline</option>
            {DEADLINE_TYPES.map((t) => <option key={t} value={t}>{DEADLINE_LABEL[t]}</option>)}
          </Select>
          <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
            <option value="">All destinations</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <Select name="days" aria-label="Window" defaultValue={String(days)}>
            {WINDOWS.map((w) => <option key={w} value={w}>Next {w} days</option>)}
          </Select>
          <Button type="submit" size="sm">Show</Button>
        </form>
      </Toolbar>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<IconClock />} title="Nothing due">No open application deadlines in this window.</EmptyState>
        ) : (
          <Table tableClassName="min-w-[760px]">
            <thead><tr><Th>Due</Th><Th>What</Th><Th>Student and program</Th><Th>Ack. no</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const left = daysUntil(r.dueOn);
                return (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap"><p className="font-medium">{dayText(r.dueOn)}</p><p className={cn("text-xs", left < 0 ? "font-medium text-red-700" : left <= 3 ? "font-medium text-amber-700" : "text-muted")}>{left < 0 ? `${-left} days overdue` : left === 0 ? "Today" : `${left} days`}</p></Td>
                    <Td>{DEADLINE_LABEL[r.type]}{r.note ? <p className="text-xs text-muted">{r.note}</p> : null}</Td>
                    <Td><Link prefetch={false} href={`/students/${r.studentId}/applications?app=${r.appId}`} className="font-medium hover:underline">{r.firstName} {r.lastName}</Link><p className="text-xs text-muted">{r.program} · {r.university}</p></Td>
                    <Td className="tabular text-[13px]">{r.ackNo}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
