import Link from "next/link";
import { and, asc, count, eq, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { checkEligibility, type Eligibility } from "@/lib/eligibility";
import { fmtMoney, fullName, MONTHS } from "@/lib/format";
import { ADMIN_ROLES, APP_ROLES, isStaff } from "@/lib/permissions";
import { ShortlistButton } from "@/components/shortlist-button";
import { readFilters } from "@/server/queries";
import { fxRates, getSettings } from "@/server/settings";
import { notBlockedWhere } from "@/server/eligibility-sql";
import { hasOpenScholarship } from "@/server/scholarships";
import { closingWithin, nextDeadlines } from "@/server/deadlines";
import { LEVEL_LABEL, SHORTLIST_LIMIT, dayText, daysUntil, inrApprox, intakesText, tuitionText } from "@/lib/catalogue";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th, Toolbar, cn } from "@/components/ui";
import { IconCheck, IconAlert, IconClock, IconGlobe, IconSearch, IconSpark } from "@/components/icons";

export const metadata = { title: "Search programs" };

const PAGE = 25;

const QUICK = [
  { key: "noAppFee", label: "No application fee" },
  { key: "moi", label: "MOI accepted" },
  { key: "lowDeposit", label: "Deposit under 1,500" },
  { key: "noEnglish", label: "No English test needed" },
  { key: "ausbildung", label: "Ausbildung" },
  { key: "nursing", label: "Nurse registration" },
  { key: "workRights", label: "Post-study work" },
  { key: "scholarship", label: "Scholarship available" },
  { key: "closing", label: "Deadline in the next 30 days" },
  { key: "waiver", label: "Application fee waiver" },
] as const;

const BUDGETS = [5, 10, 15, 20, 25, 30, 40, 50];

/**
 * A yearly budget in rupees, against fees in each destination's currency at
 * the platform's indicative rates. A per-year fee is compared directly. A
 * whole-course fee is only used to rule a program out when its average year
 * is over budget, which is certain without inventing a yearly figure. Programs
 * with no fee on record, or in a currency with no rate, stay in the list.
 */
function budgetWhere(budgetInr: number, rates: Record<string, number>): SQL {
  const { programs: p, countries: c } = schema;
  const known = Object.entries(rates).filter(([k]) => /^[A-Z]{3}$/.test(k));
  const rate = sql`(case ${c.currency} ${sql.join(known.map(([k, v]) => sql`when ${k} then ${v}::numeric`), sql` `)} end)`;
  return sql`(case
    when ${rate} is null then true
    when ${p.tuitionPerYear} is not null then ${p.tuitionPerYear} * ${rate} <= ${budgetInr}::numeric
    when ${p.tuitionTotal} is not null and ${p.durationMonths} > 0 then ${p.tuitionTotal} * ${rate} * 12 <= ${budgetInr}::numeric * ${p.durationMonths}
    else true end)`;
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const f = readFilters(await searchParams) as Record<string, string>;
  const page = Math.max(1, Number(f.page ?? 1));
  const { programs: p, universities: u, countries: c, students: s } = schema;

  const conds: (SQL | undefined)[] = [eq(p.status, "LIVE")];
  if (f.q) conds.push(or(ilike(p.name, `%${f.q}%`), ilike(u.name, `%${f.q}%`), ilike(p.studyArea, `%${f.q}%`), ilike(p.campus, `%${f.q}%`)));
  if (f.country) conds.push(eq(c.code, f.country));
  if (f.field) conds.push(eq(p.studyArea, f.field));
  if (f.pathway) conds.push(eq(p.pathway, f.pathway as schema.Pathway));
  if (f.level) conds.push(eq(p.level, f.level as "PG"));
  if (f.intakeMonth) conds.push(sql`${Number(f.intakeMonth)} = any(${p.intakeMonths})`);
  // Older links carried a figure in the destination's own currency.
  if (f.maxTuition && f.country) conds.push(or(lte(p.tuitionPerYear, Number(f.maxTuition)), sql`${p.tuitionPerYear} is null`));
  const rates = fxRates(await getSettings());
  const budget = Number(f.budget) > 0 ? Number(f.budget) * 1e5 : null;
  if (budget) conds.push(budgetWhere(budget, rates));
  if (f.minIelts) conds.push(or(lte(p.minIelts, Number(f.minIelts)), sql`${p.minIelts} is null`));
  if (f.noAppFee) conds.push(eq(p.applicationFee, 0));
  if (f.moi) conds.push(eq(p.moiAccepted, true));
  if (f.lowDeposit) conds.push(or(lte(p.initialDeposit, 1500), sql`${p.initialDeposit} is null`));
  if (f.noEnglish) conds.push(and(sql`${p.minIelts} is null`, sql`${p.minPte} is null`, sql`${p.minToefl} is null`, sql`${p.minDuolingo} is null`, sql`${p.minOetGrade} is null`));
  if (f.ausbildung) conds.push(eq(p.pathway, "AUSBILDUNG"));
  if (f.nursing) conds.push(eq(p.pathway, "NURSING"));
  // Only programmes the institution itself confirms, never the unknowns. A
  // partner filtering on this is telling a student the work rights are there.
  if (f.workRights) conds.push(eq(p.workRights, "ELIGIBLE"));
  if (f.scholarship) conds.push(hasOpenScholarship);
  if (f.closing) conds.push(closingWithin(30));
  if (f.waiver) conds.push(sql`${p.feeWaiver} is not null`);
  const student = f.student
    ? await db.query.students.findFirst({ where: and(eq(s.id, f.student), isStaff(user) ? undefined : eq(s.orgId, user.orgId)), with: { tests: true, academics: true } })
    : null;
  // Hide what the student cannot meet yet; on-track programs stay.
  if (student && f.fit) conds.push(notBlockedWhere(student));
  const where = and(...conds);

  const rows = await db
    .select({
      id: p.id,
      name: p.name,
      pathway: p.pathway,
      level: p.level,
      studyArea: p.studyArea,
      durationMonths: p.durationMonths,
      tuition: p.tuitionPerYear,
      tuitionTotal: p.tuitionTotal,
      applicationFee: p.applicationFee,
      deposit: p.initialDeposit,
      intakeMonths: p.intakeMonths,
      minIelts: p.minIelts,
      minPte: p.minPte,
      minOetGrade: p.minOetGrade,
      minGermanLevel: p.minGermanLevel,
      minToefl: p.minToefl,
      minDuolingo: p.minDuolingo,
      minGre: p.minGre,
      minGmat: p.minGmat,
      minSat: p.minSat,
      minAcademicPercent: p.minAcademicPercent,
      feeWaiver: p.feeWaiver,
      maxBacklogs: p.maxBacklogs,
      maxGapYears: p.maxGapYears,
      moiAccepted: p.moiAccepted,
      workRights: p.workRights,
      workRightsNote: p.workRightsNote,
      universityId: u.id,
      university: u.name,
      city: sql<string | null>`coalesce(${p.campus}, ${u.city})`,
      isPublic: u.isPublic,
      country: c.name,
      countryCode: c.code,
      currency: c.currency,
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where)
    .orderBy(
      ...(f.sort === "fee"
        ? // Per-year figures first, then whole-course ones: the two are never
          // compared with each other, and currencies only line up within a country.
          [sql`${p.tuitionPerYear} is null`, asc(p.tuitionPerYear), sql`${p.tuitionTotal} is null`, asc(p.tuitionTotal), asc(p.name)]
        : f.sort === "name"
          ? [asc(p.name), asc(u.name)]
          : [asc(c.name), asc(u.name), asc(p.name)]),
    )
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE);

  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const next = await nextDeadlines(list.map((r) => r.id));
  const [{ total }] = await db
    .select({ total: count() })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where);

  const countries = await db.select().from(c).orderBy(asc(c.name));
  // Fields with a meaningful number of live programs, so the list stays usable.
  const fields = await db
    .select({ field: p.studyArea, n: count() })
    .from(p)
    .where(and(eq(p.status, "LIVE"), sql`${p.studyArea} is not null`))
    .groupBy(p.studyArea)
    .having(sql`count(*) >= 5`)
    .orderBy(asc(p.studyArea));
  const students = await db
    .select({ id: s.id, firstName: s.firstName, lastName: s.lastName })
    .from(s)
    .where(and(eq(s.archived, false), isStaff(user) ? undefined : eq(s.orgId, user.orgId)))
    .orderBy(asc(s.firstName))
    .limit(300);


  const canShortlist = (["PARTNER", "COUNSELLOR", ...ADMIN_ROLES] as readonly string[]).includes(user.role);
  const picked = student
    ? new Set((await db.select({ id: schema.shortlists.programId }).from(schema.shortlists).where(eq(schema.shortlists.studentId, student.id))).map((x) => x.id))
    : new Set<string>();
  const shortlistFull = picked.size >= SHORTLIST_LIMIT;

  const eligibility = new Map<string, Eligibility>();
  if (student) {
    for (const row of list) {
      eligibility.set(row.id, checkEligibility({ backlogs: student.backlogs, gapYears: student.gapYears, tests: student.tests, academics: student.academics }, row));
    }
  }

  const qs = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams(f);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) params.delete(k);
      else params.set(k, v);
    }
    params.delete("page");
    return params.toString();
  };
  const years = [new Date().getFullYear(), new Date().getFullYear() + 1, new Date().getFullYear() + 2];

  return (
    <>
      <PageHeader
        eyebrow="Phase 2"
        title="Search programs"
        subtitle={`${total.toLocaleString("en-IN")} live program${total === 1 ? "" : "s"} across ${countries.length} destinations${budget ? ". Fees are compared at the indicative rates in Settings; programs with no fee on record stay in the list" : ""}`}
        actions={
          student ? (
            <LinkButton href={`/students/${student.id}/profile`} variant="secondary">
              Open {fullName(student)}
            </LinkButton>
          ) : undefined
        }
      />

      <Toolbar className="mb-3">
        <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
          {Object.entries(f)
            .filter(([k]) => QUICK.some((q) => q.key === k))
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
          {f.fit && <input type="hidden" name="fit" value="1" />}
          <div className="relative sm:col-span-2">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <Input name="q" defaultValue={f.q} placeholder="Program, university or study area" aria-label="Search" className="pl-10" />
          </div>
          <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
            <option value="">All destinations</option>
            {countries.map((x) => (
              <option key={x.id} value={x.code}>{x.name}</option>
            ))}
          </Select>
          <Select name="level" aria-label="Level" defaultValue={f.level ?? ""}>
            <option value="">Any level</option>
            <option value="UG">Bachelor&apos;s</option>
            <option value="PG">Master&apos;s</option>
            <option value="PG_DIPLOMA">PG diploma</option>
            <option value="UG_DIPLOMA">Diploma</option>
            <option value="PHD">PhD</option>
            <option value="VOCATIONAL">Vocational (Ausbildung)</option>
            <option value="REGISTRATION">Registration route</option>
            <option value="CERTIFICATE">Certificate</option>
          </Select>
          <Select name="intakeMonth" aria-label="Intake month" defaultValue={f.intakeMonth ?? ""}>
            <option value="">Any intake</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m} intake</option>
            ))}
          </Select>
          <Select name="intakeYear" aria-label="Intake year" defaultValue={f.intakeYear ?? ""}>
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </Select>
          <Select name="minIelts" aria-label="Student's IELTS" defaultValue={f.minIelts ?? ""}>
            <option value="">Any English requirement</option>
            <option value="5.5">Needs IELTS 5.5 or less</option>
            <option value="6">Needs IELTS 6.0 or less</option>
            <option value="6.5">Needs IELTS 6.5 or less</option>
            <option value="7">Needs IELTS 7.0 or less</option>
          </Select>
          <Select name="budget" aria-label="Tuition budget per year" defaultValue={f.budget ?? ""}>
            <option value="">Any tuition budget</option>
            {BUDGETS.map((b) => <option key={b} value={b}>Tuition up to ₹{b} lakh a year</option>)}
          </Select>
          <Select name="field" aria-label="Field of study" defaultValue={f.field ?? ""}>
            <option value="">Any field of study</option>
            {fields.map((x) => <option key={x.field} value={x.field!}>{x.field} ({x.n.toLocaleString("en-IN")})</option>)}
          </Select>
          <Select name="sort" aria-label="Sort" defaultValue={f.sort ?? ""}>
            <option value="">Sort by country and university</option>
            <option value="name">Sort by program name</option>
            <option value="fee">Lowest fee first</option>
          </Select>
          <Select name="student" aria-label="Check against student" defaultValue={f.student ?? ""}>
            <option value="">Check eligibility for…</option>
            {students.map((x) => (
              <option key={x.id} value={x.id}>{fullName(x)}</option>
            ))}
          </Select>
          <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-4">
            <LinkButton href="/search" variant="quiet" size="sm">Clear all</LinkButton>
            <Button type="submit" size="sm">Search</Button>
          </div>
        </form>
      </Toolbar>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-muted">Quick filters</span>
        {QUICK.map((q) => {
          const on = !!f[q.key];
          return (
            <Link
              key={q.key}
              href={`/search?${qs({ [q.key]: on ? undefined : "1" })}`}
              className={cn(
                "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
                on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface text-ink-soft hover:border-brand-300 hover:text-brand-700",
              )}
            >
              {q.label}
            </Link>
          );
        })}
      </div>

      {student && (
        <Card className="mb-4 border-brand-200 bg-brand-50/50 p-3.5">
          <p className="text-sm">
            Checking against <span className="font-semibold">{fullName(student)}</span>
            {student.tests.length > 0 && (
              <>
                {" · "}
                {student.tests.map((t) => (
                  <Chip key={t.id} tone={t.isMock ? "info" : "ok"} className="mr-1">
                    {t.test === "GERMAN" ? "German" : t.test} {t.overall}
                    {t.isMock ? " (practice)" : ""}
                  </Chip>
                ))}
              </>
            )}
            {student.backlogs != null && <span className="text-muted"> · {student.backlogs} backlogs</span>}
            {student.gapYears != null && <span className="text-muted"> · {student.gapYears}-year gap</span>}
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Practice scores come from Medcity&apos;s own test platform, so a student still in class shows as on track rather than blocked.
          </p>
          <p className="mt-2 text-[13px]">
            <Link prefetch={false} href={`/search?${qs({ fit: f.fit ? undefined : "1" })}`} className="font-medium text-brand-600 hover:underline">
              {f.fit ? "Show every program again" : `Hide programs ${student.firstName} cannot meet yet`}
            </Link>
          </p>
        </Card>
      )}

      <Card>
        {list.length === 0 ? (
          <EmptyState icon={<IconSearch />} title="No programs match these filters">
            Try removing a quick filter, or widen the destination and level.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[1080px]">
            <thead>
              <tr>
                <Th>Program</Th>
                <Th>University</Th>
                <Th>Intakes</Th>
                <Th>Tuition</Th>
                <Th>Entry requirements</Th>
                {student && <Th>Fit</Th>}
                <Th><span className="sr-only">Apply</span></Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const fit = eligibility.get(r.id);
                return (
                  <tr key={r.id} className="hover:bg-surface-2/60">
                    <Td>
                      <Link prefetch={false} href={`/programs/${r.id}${student ? `?student=${student.id}` : ""}`} className="font-medium text-ink hover:text-brand-700 hover:underline">{r.name}</Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>{LEVEL_LABEL[r.level] ?? r.level}</span>
                        {r.studyArea && <span>· {r.studyArea}</span>}
                        {r.durationMonths && <span>· {r.durationMonths} months</span>}
                        {r.pathway !== "DEGREE" && <Chip tone="brand">{r.pathway === "AUSBILDUNG" ? "Ausbildung" : "Nursing"}</Chip>}
                      </p>
                      {/* A counsellor should not have to know which programmes lost
                          their work rights. Where the institution says so, the row
                          says so, and the note carries its wording on hover. */}
                      {r.workRights !== "UNKNOWN" && (
                        <p className="mt-1">
                          <Chip tone={r.workRights === "ELIGIBLE" ? "ok" : "bad"}>
                            {r.workRights === "ELIGIBLE" ? (
                              <><IconCheck className="size-3.5" /> Post-study work</>
                            ) : (
                              <><IconAlert className="size-3.5" /> No post-study work</>
                            )}
                          </Chip>
                          {r.workRightsNote && <span className="ml-1.5 text-xs text-muted">{r.workRightsNote}</span>}
                        </p>
                      )}
                    </Td>
                    <Td>
                      <Link prefetch={false} href={`/universities/${r.universityId}`} className="hover:text-brand-700 hover:underline">{r.university}</Link>
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <IconGlobe className="size-3.5" /> {r.city ? `${r.city}, ` : ""}{r.country}
                        {r.isPublic && <Chip className="ml-1">Public</Chip>}
                      </p>
                    </Td>
                    <Td className={cn("whitespace-nowrap text-[13px]", !r.intakeMonths.length && "text-muted")}>
                      {intakesText(r.intakeMonths)}
                      {next.get(r.id) && (() => {
                        const d = next.get(r.id)!;
                        const left = daysUntil(d.deadline);
                        return <p className={cn("text-xs", left <= 14 ? "font-medium text-amber-700" : "text-muted")}>{MONTHS[d.intakeMonth - 1]} {d.intakeYear}: apply by {dayText(d.deadline)}</p>;
                      })()}
                      {r.feeWaiver && <p className="text-xs font-medium text-emerald-700">Fee waiver</p>}
                    </Td>
                    <Td className="whitespace-nowrap tabular">
                      {r.tuition == null && r.tuitionTotal == null ? <span className="text-muted">Tuition not recorded</span> : tuitionText(r.tuition, r.tuitionTotal, r.currency)}
                      {inrApprox(r.tuition ?? r.tuitionTotal, r.currency, rates) && <span className="block text-xs text-muted">{inrApprox(r.tuition ?? r.tuitionTotal, r.currency, rates)}</span>}
                      <p className="text-xs text-muted">
                        {r.applicationFee == null ? "App. fee not recorded" : r.applicationFee > 0 ? `App. fee ${fmtMoney(r.applicationFee, r.currency)}` : "No application fee"}
                        {r.deposit ? ` · deposit ${fmtMoney(r.deposit, r.currency)}` : ""}
                      </p>
                    </Td>
                    <Td>
                      <div className="flex max-w-[15rem] flex-wrap gap-1">
                        {r.minIelts && <Chip>IELTS {r.minIelts}</Chip>}
                        {r.minPte && <Chip>PTE {r.minPte}</Chip>}
                        {r.minToefl != null && <Chip>TOEFL {r.minToefl}</Chip>}
                        {r.minDuolingo != null && <Chip>Duolingo {r.minDuolingo}</Chip>}
                        {r.minOetGrade && <Chip>OET {r.minOetGrade}</Chip>}
                        {r.minGre != null && <Chip>GRE {r.minGre}</Chip>}
                        {r.minGmat != null && <Chip>GMAT {r.minGmat}</Chip>}
                        {r.minSat != null && <Chip>SAT {r.minSat}</Chip>}
                        {r.minAcademicPercent != null && <Chip>Marks {r.minAcademicPercent}%+</Chip>}
                        {r.minGermanLevel && <Chip>German {r.minGermanLevel}</Chip>}
                        {r.maxBacklogs != null && <Chip>Backlogs ≤ {r.maxBacklogs}</Chip>}
                        {r.moiAccepted && <Chip tone="ok">MOI</Chip>}
                        {!r.minIelts && !r.minPte && r.minToefl == null && r.minDuolingo == null && !r.minOetGrade && !r.minGermanLevel && r.minGre == null && r.minGmat == null && r.minSat == null && r.minAcademicPercent == null && <span className="text-xs text-muted">No test requirement recorded</span>}
                      </div>
                    </Td>
                    {student && fit && (
                      <Td>
                        {fit.verdict === "eligible" && <Chip tone="ok"><IconCheck className="size-3.5" /> Eligible</Chip>}
                        {fit.verdict === "on-track" && <Chip tone="warn"><IconClock className="size-3.5" /> On track</Chip>}
                        {fit.verdict === "blocked" && <Chip tone="bad"><IconAlert className="size-3.5" /> Not yet</Chip>}
                        {fit.verdict === "unknown" && <Chip>No rules</Chip>}
                        <ul className="mt-1 space-y-0.5 text-xs text-muted">
                          {fit.missing.map((m) => <li key={m}>{m}</li>)}
                          {fit.onTrack.map((m) => <li key={m}>{m}</li>)}
                        </ul>
                      </Td>
                    )}
                    <Td>
                      <div className="flex flex-col items-start gap-1.5">
                        {student ? (
                          <LinkButton
                            size="sm"
                            variant={fit?.verdict === "blocked" ? "secondary" : "primary"}
                            href={`/students/${student.id}/applications?tab=apply&program=${r.id}`}
                          >
                            Apply
                          </LinkButton>
                        ) : (
                          <span className="text-xs text-muted">Pick a student to apply</span>
                        )}
                        {student && canShortlist && (picked.has(r.id) || !shortlistFull) && (
                          <ShortlistButton studentId={student.id} programId={r.id} on={picked.has(r.id)} />
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {(page > 1 || hasNext) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-[13px] text-muted">
              Showing {(page - 1) * PAGE + 1} to {(page - 1) * PAGE + list.length} of {total}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <LinkButton variant="secondary" size="sm" href={`/search?${new URLSearchParams({ ...f, page: String(page - 1) })}`}>
                  Previous
                </LinkButton>
              )}
              {hasNext && (
                <LinkButton variant="secondary" size="sm" href={`/search?${new URLSearchParams({ ...f, page: String(page + 1) })}`}>
                  Next
                </LinkButton>
              )}
            </div>
          </div>
        )}
      </Card>

      {!student && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
          <IconSpark className="size-4 text-brand-600" />
          Pick a student in &ldquo;Check eligibility for…&rdquo; to see which programs they already qualify for, and which ones they are on track for.
        </p>
      )}
    </>
  );
}
