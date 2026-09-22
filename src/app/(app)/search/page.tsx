import Link from "next/link";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { checkEligibility, type Eligibility } from "@/lib/eligibility";
import { fmtMoney, fullName, MONTHS } from "@/lib/format";
import { ADMIN_ROLES, APP_ROLES, isStaff } from "@/lib/permissions";
import { ShortlistButton } from "@/components/shortlist-button";
import { CheckDropdown } from "@/components/check-dropdown";
import { fxRates, getSettings } from "@/server/settings";
import { nextDeadlines } from "@/server/deadlines";
import { activeRules, partnerShareJoins } from "@/server/commission-estimate";
import { AE_KEYS, LEVELS, QUICK, adhocStudent, listOf, readSearch, searchConds, tagCond } from "@/server/program-search";
import { PROGRAM_TAGS, SEASON_LABEL, TAG_KEYS } from "@/lib/program-tags";
import { partnerEstimate, pickRule } from "@/lib/money";
import { rankLabels } from "@/lib/rankings";
import { LEVEL_LABEL, SHORTLIST_LIMIT, dayText, daysUntil, inrApprox, intakesText, tuitionText } from "@/lib/catalogue";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th, Toolbar, cn } from "@/components/ui";
import { IconCheck, IconAlert, IconClock, IconGlobe, IconSearch, IconSpark } from "@/components/icons";

export const metadata = { title: "Search programs" };

const PAGE = 25;
const BUDGETS = [5, 10, 15, 20, 25, 30, 40, 50];
/** Kept across the filter form, which does not show them as fields. */
const CARRIED = [...QUICK.map((q) => q.key), "tags", "fit", "view", "apply", ...AE_KEYS];

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const f = readSearch(await searchParams);
  const page = Math.max(1, Number(f.page ?? 1));
  const view = f.view === "universities" ? "universities" : "programs";
  const { programs: p, universities: u, countries: c, students: s } = schema;

  const rates = fxRates(await getSettings());
  const budget = Number(f.budget) > 0;
  const student = f.student
    ? await db.query.students.findFirst({ where: and(eq(s.id, f.student), isStaff(user) ? undefined : eq(s.orgId, user.orgId)), with: { tests: true, academics: true } })
    : null;
  // Scores typed into search stand in for a student when none is picked.
  const adhoc = student ? null : adhocStudent(f);
  const checker = student ? { backlogs: student.backlogs, gapYears: student.gapYears, tests: student.tests, academics: student.academics } : adhoc;
  const where = and(...searchConds(f, checker, rates));
  const byShare = partnerShareJoins(rates);
  const levelsOn = listOf(f.level);
  const seasonsOn = listOf(f.season);
  const tagsOn = listOf(f.tags);

  // Totals and what each chip would leave, in one pass over the matches.
  const [counts] = await db
    .select({
      total: count(),
      unis: sql<number>`count(distinct ${u.id})`.mapWith(Number),
      ...Object.fromEntries(QUICK.map((q) => [q.key, sql<number>`count(*) filter (where ${q.cond()})`.mapWith(Number)])),
      ...Object.fromEntries(TAG_KEYS.map((t) => [`tag_${t}`, sql<number>`count(*) filter (where ${tagCond(t)})`.mapWith(Number)])),
    })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where);
  const total = counts.total;
  const chipCount = (k: string) => (counts as unknown as Record<string, number>)[k] ?? 0;

  const rows =
    view === "programs"
      ? await db
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
            balanceDeposit: p.balanceDeposit,
            typicalScholarship: p.typicalScholarship,
            tags: p.tags,
            intakeMonths: p.intakeMonths,
            minIelts: p.minIelts,
            minIeltsBand: p.minIeltsBand,
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
            countryId: c.id,
            university: u.name,
            city: sql<string | null>`coalesce(${p.campus}, ${u.city})`,
            isPublic: u.isPublic,
            qsRank: u.qsRank,
            qsYear: u.qsYear,
            theRank: u.theRank,
            theYear: u.theYear,
            country: c.name,
            countryCode: c.code,
            currency: c.currency,
          })
          .from(p)
          .innerJoin(u, eq(p.universityId, u.id))
          .innerJoin(c, eq(u.countryId, c.id))
          .leftJoin(byShare.rp, eq(byShare.rp.key, p.id))
          .leftJoin(byShare.ru, eq(byShare.ru.key, p.universityId))
          .leftJoin(byShare.rc, eq(byShare.rc.key, u.countryId))
          .where(where)
          .orderBy(
            ...(f.sort === "rank"
              ? [sql`${u.rankSort} asc nulls last`, asc(u.name), asc(p.name)]
              : f.sort === "commission"
              ? [sql`${byShare.expr} desc nulls last`, asc(p.name)]
              : f.sort === "fee"
              ? // Per-year figures first, then whole-course ones: the two are never
                // compared with each other, and currencies only line up within a country.
                [sql`${p.tuitionPerYear} is null`, asc(p.tuitionPerYear), sql`${p.tuitionTotal} is null`, asc(p.tuitionTotal), asc(p.name)]
              : f.sort === "name"
                ? [asc(p.name), asc(u.name)]
                : [asc(c.name), asc(u.name), asc(p.name)]),
          )
          .limit(PAGE + 1)
          .offset((page - 1) * PAGE)
      : [];

  // The same matches, one line per university.
  const uniRows =
    view === "universities"
      ? await db
          .select({
            id: u.id,
            name: u.name,
            city: u.city,
            isPublic: u.isPublic,
            qsRank: u.qsRank,
            qsYear: u.qsYear,
            theRank: u.theRank,
            theYear: u.theYear,
            country: c.name,
            programs: count(),
            levels: sql<string[]>`array_agg(distinct ${p.level})`,
            // One bit per intake month across the matches; empty arrays cannot be concatenated.
            intakeMask: sql<number>`bit_or((select coalesce(bit_or(1 << m), 0) from unnest(${p.intakeMonths}) m))`.mapWith(Number),
            noAppFee: sql<number>`count(*) filter (where ${p.applicationFee} = 0)`.mapWith(Number),
          })
          .from(p)
          .innerJoin(u, eq(p.universityId, u.id))
          .innerJoin(c, eq(u.countryId, c.id))
          .where(where)
          .groupBy(u.id, c.id)
          .orderBy(...(f.sort === "rank" ? [sql`${u.rankSort} asc nulls last`, asc(u.name)] : f.sort === "name" ? [asc(u.name)] : [asc(c.name), asc(u.name)]))
          .limit(PAGE + 1)
          .offset((page - 1) * PAGE)
      : [];

  const hasNext = view === "programs" ? rows.length > PAGE : uniRows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const unis = uniRows.slice(0, PAGE).map((r) => ({ ...r, intakes: Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => (r.intakeMask >> m) & 1) }));
  const next = await nextDeadlines(list.map((r) => r.id));
  const rules = await activeRules();

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
  if (checker) {
    for (const row of list) eligibility.set(row.id, checkEligibility(checker, row));
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
  const toggleIn = (key: string, value: string) => {
    const cur = listOf(f[key]);
    const nextList = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    return qs({ [key]: nextList.length ? nextList.join(",") : undefined });
  };
  const chipClass = (on: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
      on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface text-ink-soft hover:border-brand-300 hover:text-brand-700",
    );
  const countBadge = (n: number, on: boolean) => (
    <span className={cn("tabular text-xs", on ? "text-white/80" : "text-muted")}>{n.toLocaleString("en-IN")}</span>
  );
  const seasonText = seasonsOn.map((x) => SEASON_LABEL[x as keyof typeof SEASON_LABEL]?.split(" (")[0]).filter(Boolean).join(", ");
  const levelText = levelsOn.map((l) => LEVELS.find(([k]) => k === l)?.[1]).filter(Boolean).join(", ");
  const exportQs = qs({ view: undefined });

  return (
    <>
      <PageHeader
        eyebrow="Phase 2"
        title="Search programs"
        subtitle={`${total.toLocaleString("en-IN")} live program${total === 1 ? "" : "s"} at ${counts.unis.toLocaleString("en-IN")} ${counts.unis === 1 ? "university" : "universities"}${budget ? ". Fees are compared at the indicative rates in Settings; programs with no fee on record stay in the list" : ""}`}
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
            .filter(([k]) => CARRIED.includes(k))
            .map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
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
          <CheckDropdown testId="level-picker" label="Any level" summary={levelText || null} name="level" options={LEVELS} selected={levelsOn} />
          <CheckDropdown testId="season-picker" label="Any intake season" summary={seasonText ? `${seasonText} intake` : null} name="season" options={Object.entries(SEASON_LABEL)} selected={seasonsOn} />
          <Select name="intakeMonth" aria-label="Intake month" defaultValue={f.intakeMonth ?? ""}>
            <option value="">Any intake month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m} intake</option>
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
          <Select name="apply" aria-label="Applications open or closed" defaultValue={f.apply ?? ""}>
            <option value="">Open or closed</option>
            <option value="open">Applications open (a deadline ahead)</option>
            <option value="closed">Closed for now (recorded deadlines passed)</option>
          </Select>
          <Select name="sort" aria-label="Sort" defaultValue={f.sort ?? ""}>
            <option value="">Sort by country and university</option>
            <option value="name">Sort by name</option>
            {view === "programs" && <option value="fee">Lowest fee first</option>}
            {view === "programs" && <option value="commission">Highest commission first</option>}
            <option value="rank">Best university ranking first</option>
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

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-muted">Quick filters</span>
        {QUICK.map((q) => {
          const on = !!f[q.key];
          const n = chipCount(q.key);
          if (!on && n === 0) return null;
          return (
            <Link key={q.key} href={`/search?${qs({ [q.key]: on ? undefined : "1" })}`} className={chipClass(on)}>
              {q.label} {countBadge(n, on)}
            </Link>
          );
        })}
      </div>
      {TAG_KEYS.some((t) => tagsOn.includes(t) || chipCount(`tag_${t}`) > 0) && (
        <div className="mb-2 flex flex-wrap items-center gap-2" data-testid="label-chips">
          <span className="text-[13px] font-medium text-muted">Labels</span>
          {TAG_KEYS.map((t) => {
            const on = tagsOn.includes(t);
            const n = chipCount(`tag_${t}`);
            if (!on && n === 0) return null;
            return (
              <Link key={t} href={`/search?${toggleIn("tags", t)}`} className={chipClass(on)}>
                {PROGRAM_TAGS[t]} {countBadge(n, on)}
              </Link>
            );
          })}
        </div>
      )}

      {!student && (
        <details className="mb-4 rounded-xl border border-line bg-surface" open={!!adhoc}>
          <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-brand-700">
            {adhoc ? `Checking scores: ${adhoc.label}` : "Check eligibility from scores, without a student file"}
          </summary>
          <form className="grid gap-2.5 border-t border-line p-4 sm:grid-cols-3 xl:grid-cols-5">
            {Object.entries(f)
              .filter(([k]) => k !== "page" && !(AE_KEYS as readonly string[]).includes(k))
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            {(
              [
                ["ae_ielts", "IELTS overall", "0.5"],
                ["ae_pte", "PTE overall", "1"],
                ["ae_toefl", "TOEFL iBT", "1"],
                ["ae_duolingo", "Duolingo", "1"],
                ["ae_gre", "GRE total", "1"],
                ["ae_gmat", "GMAT total", "1"],
                ["ae_12", "Std. 12th %", "0.1"],
                ["ae_ug", "Bachelor's %", "0.1"],
                ["ae_backlogs", "Backlogs", "1"],
                ["ae_gap", "Gap years", "1"],
              ] as const
            ).map(([k, label, step]) => (
              <label key={k} className="text-[13px] font-medium text-ink-soft">
                {label}
                <Input name={k} type="number" min="0" step={step} defaultValue={f[k]} className="mt-1" />
              </label>
            ))}
            <p className="text-xs text-muted sm:col-span-3 xl:col-span-3">
              Official scores only. Marks are percentages: a CGPA is never converted, so check the institution&apos;s own conversion.
            </p>
            <div className="flex items-end justify-end gap-2 sm:col-span-3 xl:col-span-2">
              {adhoc && <LinkButton href={`/search?${qs(Object.fromEntries(AE_KEYS.map((k) => [k, undefined])))}`} variant="quiet" size="sm">Clear scores</LinkButton>}
              <Button type="submit" size="sm" variant="secondary">Check these scores</Button>
            </div>
          </form>
        </details>
      )}

      {(student || adhoc) && (
        <Card className="mb-4 border-brand-200 bg-brand-50/50 p-3.5">
          <p className="text-sm">
            {student ? (
              <>
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
              </>
            ) : (
              <>Checking against <span className="font-semibold">{adhoc!.label}</span></>
            )}
          </p>
          {student && (
            <p className="mt-1 text-[13px] text-muted">
              Practice scores come from Medcity&apos;s own test platform, so a student still in class shows as on track rather than blocked.
            </p>
          )}
          <p className="mt-2 text-[13px]">
            <Link prefetch={false} href={`/search?${qs({ fit: f.fit ? undefined : "1" })}`} className="font-medium text-brand-600 hover:underline">
              {f.fit ? "Show every program again" : student ? `Hide programs ${student.firstName} cannot meet yet` : "Hide programs these scores cannot meet"}
            </Link>
          </p>
        </Card>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-[13px] font-medium" role="group" aria-label="Show">
          <Link href={`/search?${qs({ view: undefined })}`} aria-current={view === "programs" ? "page" : undefined} className={cn("rounded-md px-3 py-1", view === "programs" ? "bg-brand-600 text-white" : "text-ink-soft hover:text-brand-700")}>
            Programs ({total.toLocaleString("en-IN")})
          </Link>
          <Link href={`/search?${qs({ view: "universities" })}`} aria-current={view === "universities" ? "page" : undefined} className={cn("rounded-md px-3 py-1", view === "universities" ? "bg-brand-600 text-white" : "text-ink-soft hover:text-brand-700")}>
            Universities ({counts.unis.toLocaleString("en-IN")})
          </Link>
        </div>
        {view === "programs" && list.length > 0 && (
          <form id="pick" className="flex flex-wrap items-center gap-2" action="/compare">
            <span className="text-xs text-muted">Ticked programs:</span>
            <Button type="submit" size="sm" variant="secondary">Compare</Button>
            <Button type="submit" size="sm" variant="secondary" formAction="/api/programs/search-export">Download ticked</Button>
            <a href={`/api/programs/search-export?${exportQs}`} className="text-[13px] font-medium text-brand-600 hover:underline">
              Download the top {Math.min(total, 500).toLocaleString("en-IN")}
            </a>
          </form>
        )}
      </div>

      {view === "universities" ? (
        <Card>
          {unis.length === 0 ? (
            <EmptyState icon={<IconSearch />} title="No universities match these filters">Try removing a quick filter, or widen the destination and level.</EmptyState>
          ) : (
            <Table tableClassName="min-w-[820px]">
              <thead>
                <tr>
                  <Th>University</Th>
                  <Th>Matching programs</Th>
                  <Th>Levels</Th>
                  <Th>Intakes</Th>
                </tr>
              </thead>
              <tbody>
                {unis.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2/60">
                    <Td>
                      <Link prefetch={false} href={`/universities/${r.id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">{r.name}</Link>
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <IconGlobe className="size-3.5" /> {r.city ? `${r.city}, ` : ""}{r.country}
                        {r.isPublic && <Chip className="ml-1">Public</Chip>}
                      </p>
                      {rankLabels(r).length > 0 && <p className="text-xs font-medium text-ink-soft">{rankLabels(r).join(" · ")}</p>}
                    </Td>
                    <Td>
                      <Link prefetch={false} href={`/search?${qs({ view: undefined, uni: r.id })}`} className="font-medium text-brand-600 hover:underline">
                        {r.programs.toLocaleString("en-IN")} program{r.programs === 1 ? "" : "s"}
                      </Link>
                      {r.noAppFee > 0 && <p className="text-xs text-muted">{r.noAppFee} with no application fee</p>}
                    </Td>
                    <Td className="text-[13px]">{r.levels.map((l) => LEVEL_LABEL[l] ?? l).join(", ")}</Td>
                    <Td className={cn("text-[13px]", !r.intakes.length && "text-muted")}>{intakesText(r.intakes)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {(page > 1 || hasNext) && pager(unis.length, counts.unis)}
        </Card>
      ) : (
      <Card>
        {f.uni && (
          <p className="border-b border-line px-4 py-2.5 text-[13px]">
            Showing one university&apos;s programs. <Link href={`/search?${qs({ uni: undefined })}`} className="font-medium text-brand-600 hover:underline">Show every university</Link>
          </p>
        )}
        {list.length === 0 ? (
          <EmptyState icon={<IconSearch />} title="No programs match these filters">
            Try removing a quick filter, or widen the destination and level.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[1120px]">
            <thead>
              <tr>
                <Th><span className="sr-only">Tick</span></Th>
                <Th>Program</Th>
                <Th>University</Th>
                <Th>Intakes</Th>
                <Th>Tuition</Th>
                <Th>Entry requirements</Th>
                {checker && <Th>Fit</Th>}
                <Th><span className="sr-only">Apply</span></Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const fit = eligibility.get(r.id);
                return (
                  <tr key={r.id} className="hover:bg-surface-2/60">
                    <Td className="w-8">
                      <input type="checkbox" form="pick" name="id" value={r.id} aria-label={`Tick ${r.name}`} className="size-4" />
                    </Td>
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
                      {r.tags.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {r.tags.filter((t) => t in PROGRAM_TAGS).map((t) => <Chip key={t} tone="info">{PROGRAM_TAGS[t as keyof typeof PROGRAM_TAGS]}</Chip>)}
                        </p>
                      )}
                    </Td>
                    <Td>
                      <Link prefetch={false} href={`/universities/${r.universityId}`} className="hover:text-brand-700 hover:underline">{r.university}</Link>
                      <p className="flex items-center gap-1 text-xs text-muted">
                        <IconGlobe className="size-3.5" /> {r.city ? `${r.city}, ` : ""}{r.country}
                        {r.isPublic && <Chip className="ml-1">Public</Chip>}
                      </p>
                      {rankLabels(r).length > 0 && <p className="text-xs font-medium text-ink-soft">{rankLabels(r).join(" · ")}</p>}
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
                      {(() => {
                        const rule = pickRule(rules, r.id, r.universityId, r.countryId);
                        if (!rule) return null;
                        const est = partnerEstimate(rule, r.tuition, r.currency);
                        return <span className="block text-xs font-medium text-emerald-700">{est.amount != null ? `Your share ≈ ${fmtMoney(est.amount, est.currency)}` : `Commission: ${est.terms}`}</span>;
                      })()}
                      <p className="text-xs text-muted">
                        {r.applicationFee == null ? "App. fee not recorded" : r.applicationFee > 0 ? `App. fee ${fmtMoney(r.applicationFee, r.currency)}` : "No application fee"}
                        {r.deposit ? ` · deposit ${fmtMoney(r.deposit, r.currency)}` : ""}
                        {r.balanceDeposit ? ` · balance ${fmtMoney(r.balanceDeposit, r.currency)}` : ""}
                      </p>
                      {r.typicalScholarship && <p className="max-w-[14rem] truncate text-xs font-medium text-emerald-700" title={r.typicalScholarship}>Scholarship: {r.typicalScholarship}</p>}
                    </Td>
                    <Td>
                      <div className="flex max-w-[15rem] flex-wrap gap-1">
                        {r.minIelts && <Chip>IELTS {r.minIelts}{r.minIeltsBand != null ? ` (no band < ${r.minIeltsBand})` : ""}</Chip>}
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
                    {checker && fit && (
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
        {(page > 1 || hasNext) && pager(list.length, total)}
      </Card>
      )}

      {!student && !adhoc && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
          <IconSpark className="size-4 text-brand-600" />
          Pick a student in &ldquo;Check eligibility for…&rdquo;, or type scores above, to see which programs they already qualify for.
        </p>
      )}
    </>
  );

  function pager(shown: number, of: number) {
    return (
      <div className="flex items-center justify-between border-t border-line px-4 py-3">
        <span className="text-[13px] text-muted">
          Showing {(page - 1) * PAGE + 1} to {(page - 1) * PAGE + shown} of {of.toLocaleString("en-IN")}
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
    );
  }
}
