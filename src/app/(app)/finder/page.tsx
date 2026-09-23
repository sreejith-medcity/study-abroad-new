import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { checkEligibility } from "@/lib/eligibility";
import { fullName } from "@/lib/format";
import { ADMIN_ROLES, APP_ROLES, isStaff } from "@/lib/permissions";
import { commissionVisible } from "@/server/commission-visibility";
import { fxRates, getSettings } from "@/server/settings";
import { nextDeadlines } from "@/server/deadlines";
import { adhocStudent, LEVELS, listOf, QUICK, readSearch } from "@/server/program-search";
import { budgetInr, destinationCounts, finderCandidates, finderCounts, finderWhere, studyFields, wantedMonths, FINDER_KEYS } from "@/server/finder";
import { BAND_LABEL, BAND_NOTE, scoreMatch, tagLabels, type Match } from "@/lib/finder-score";
import { SEASON_LABEL } from "@/lib/program-tags";
import { LEVEL_LABEL, SHORTLIST_LIMIT, intakesText, tuitionText } from "@/lib/catalogue";
import { ShortlistButton } from "@/components/shortlist-button";
import { BriefBox } from "./brief-box";
import { Button, Card, CardHeader, Chip, EmptyState, Field, Input, LinkButton, PageHeader, Select, cn } from "@/components/ui";
import { IconAlert, IconCheck, IconGlobe, IconSearch, IconSpark } from "@/components/icons";

export const metadata = { title: "Course finder" };

const STEPS = [
  ["1", "The student"],
  ["2", "Where and what"],
  ["3", "What matters"],
  ["results", "Matches"],
] as const;

const BUDGETS = [5, 10, 15, 20, 25, 30, 40, 50];
/** Shown on the finder's third step. The rest stay on search, which is the place for fine filters. */
const PREF_KEYS = ["workRights", "scholarship", "noEnglish", "moi", "noAppFee", "waiver", "lowDeposit", "noGre", "noGmat"];
const SHOWN = 30;

const TESTS = [
  ["ae_ielts", "IELTS", "6.5"],
  ["ae_pte", "PTE", "58"],
  ["ae_toefl", "TOEFL iBT", "80"],
  ["ae_duolingo", "Duolingo", "110"],
  ["ae_gre", "GRE", "300"],
  ["ae_gmat", "GMAT", "600"],
] as const;

export default async function FinderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const raw = await searchParams;
  const f = readSearch(raw);
  delete f.step;
  delete f.page;
  const showCommission = await commissionVisible(user);
  if (!showCommission) delete f.commission;
  const asked = String(raw.step ?? "1");
  const step = (STEPS.some(([k]) => k === asked) ? asked : "1") as (typeof STEPS)[number][0];
  const { students: s } = schema;

  const students = await db
    .select({ id: s.id, firstName: s.firstName, lastName: s.lastName })
    .from(s)
    .where(and(eq(s.archived, false), isStaff(user) ? undefined : eq(s.orgId, user.orgId)))
    .orderBy(asc(s.firstName))
    .limit(300);

  const student = f.student
    ? await db.query.students.findFirst({ where: and(eq(s.id, f.student), isStaff(user) ? undefined : eq(s.orgId, user.orgId)), with: { tests: true, academics: true } })
    : null;
  const adhoc = student ? null : adhocStudent(f);
  const checker = student ? { backlogs: student.backlogs, gapYears: student.gapYears, tests: student.tests, academics: student.academics } : adhoc;

  const qs = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams(f);
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined) params.delete(k);
      else params.set(k, v);
    }
    return params.toString();
  };
  /** Keeps the answers from the other steps on every submission. */
  const carry = (except: string[]) =>
    Object.entries(f)
      .filter(([k]) => !except.includes(k))
      .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);

  const countries = step === "2" || step === "results" ? await destinationCounts() : [];
  const fields = step === "2" ? await studyFields() : [];
  const chosen = {
    countries: listOf(f.country),
    levels: listOf(f.level),
    seasons: listOf(f.season),
  };
  const summary = [
    checker ? (student ? fullName(student) : adhoc!.label) : null,
    chosen.countries.length ? chosen.countries.map((c) => countries.find((x) => x.code === c)?.name ?? c).join(" or ") : null,
    chosen.levels.length ? chosen.levels.map((l) => LEVELS.find(([k]) => k === l)?.[1] ?? l).join(", ") : null,
    chosen.seasons.length ? `${chosen.seasons.join(" or ")} intake` : null,
    f.field ?? null,
    f.budget ? `tuition up to ₹${f.budget} lakh a year` : null,
  ].filter(Boolean);

  return (
    <>
      <PageHeader
        eyebrow="Course finder"
        title="Find courses for a student"
        subtitle="Three questions, then the matches in order, each with the reason it is there. Every figure comes from the catalogue."
        actions={<LinkButton href="/search" variant="secondary">Full search</LinkButton>}
      />

      <nav aria-label="Steps" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px]">
        {STEPS.map(([key, label], i) => {
          const on = key === step;
          return (
            <Link
              key={key}
              href={`/finder?${qs({ step: key })}`}
              aria-current={on ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium",
                on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface text-ink-soft hover:border-brand-300 hover:text-brand-700",
              )}
            >
              <span className={cn("tabular", on ? "text-white/80" : "text-muted")}>{i + 1}</span> {label}
            </Link>
          );
        })}
      </nav>

      {summary.length > 0 && step !== "results" && (
        <p className="mb-3 text-[13px] text-muted" data-testid="finder-summary">So far: <span className="font-medium text-ink">{summary.join(" · ")}</span></p>
      )}

      {step === "1" && (
        <Card className="p-4 sm:p-5">
          <CardHeader title="Who is this for?" subtitle="Pick a student's file, or describe one. Scores are only used to work out what they can already meet." />
          <div className="mb-4">
            <BriefBox keys={FINDER_KEYS} />
          </div>
          <form method="get" action="/finder" className="space-y-4">
            {carry(["student", ...TESTS.map(([k]) => k as string), "ae_12", "ae_ug", "ae_backlogs", "ae_gap"])}
            <Field label="A student's file" htmlFor="student" hint="Their recorded marks and results are used, practice scores included.">
              <Select id="student" name="student" defaultValue={f.student ?? ""}>
                <option value="">Nobody yet, I will type the scores</option>
                {students.map((x) => (
                  <option key={x.id} value={x.id}>{fullName(x)}</option>
                ))}
              </Select>
            </Field>
            <fieldset className="grid gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-[13px] font-semibold text-ink">Or the scores as they stand</legend>
              {TESTS.map(([key, label, hint]) => (
                <Field key={key} label={label} htmlFor={key}>
                  <Input id={key} name={key} defaultValue={f[key] ?? ""} inputMode="decimal" placeholder={hint} />
                </Field>
              ))}
              <Field label="Std. 12th %" htmlFor="ae_12" hint="Percentage only.">
                <Input id="ae_12" name="ae_12" defaultValue={f.ae_12 ?? ""} inputMode="decimal" placeholder="78" />
              </Field>
              <Field label="Bachelor's %" htmlFor="ae_ug" hint="A CGPA is never converted.">
                <Input id="ae_ug" name="ae_ug" defaultValue={f.ae_ug ?? ""} inputMode="decimal" placeholder="62" />
              </Field>
              <Field label="Backlogs" htmlFor="ae_backlogs">
                <Input id="ae_backlogs" name="ae_backlogs" defaultValue={f.ae_backlogs ?? ""} inputMode="numeric" placeholder="0" />
              </Field>
              <Field label="Study gap in years" htmlFor="ae_gap">
                <Input id="ae_gap" name="ae_gap" defaultValue={f.ae_gap ?? ""} inputMode="numeric" placeholder="1" />
              </Field>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="step" value="2">Continue</Button>
              <Button type="submit" name="step" value="results" variant="secondary">Show matches now</Button>
            </div>
          </form>
        </Card>
      )}

      {step === "2" && (
        <Card className="p-4 sm:p-5">
          <CardHeader title="Where, and what kind of course?" subtitle="Leave anything blank to keep it open." />
          <form method="get" action="/finder" className="space-y-4">
            {carry(["country", "level", "season", "field", "budget"])}
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold text-ink">Destinations</legend>
              <div className="flex flex-wrap gap-2">
                {countries.map((c) => (
                  <label key={c.code} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-[13px] has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                    <input type="checkbox" name="country" value={c.code} defaultChecked={chosen.countries.includes(c.code)} className="size-3.5" />
                    {c.name} <span className="tabular text-xs text-muted">{c.n.toLocaleString("en-IN")}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold text-ink">Level</legend>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map(([key, label]) => (
                  <label key={key} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-[13px] has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                    <input type="checkbox" name="level" value={key} defaultChecked={chosen.levels.includes(key)} className="size-3.5" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold text-ink">Intake</legend>
              <div className="flex flex-wrap gap-2">
                {Object.entries(SEASON_LABEL).map(([key, label]) => (
                  <label key={key} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-[13px] has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                    <input type="checkbox" name="season" value={key} defaultChecked={chosen.seasons.includes(key)} className="size-3.5" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Field of study" htmlFor="field">
                <Select id="field" name="field" defaultValue={f.field ?? ""}>
                  <option value="">Any field</option>
                  {fields.map((x) => (
                    <option key={x.field} value={x.field}>{x.field} ({x.n.toLocaleString("en-IN")})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tuition the family can manage" htmlFor="budget" hint="A year, in rupees, at the platform's indicative rates.">
                <Select id="budget" name="budget" defaultValue={f.budget ?? ""}>
                  <option value="">No figure yet</option>
                  {BUDGETS.map((b) => (
                    <option key={b} value={b}>Up to ₹{b} lakh a year</option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="step" value="3">Continue</Button>
              <Button type="submit" name="step" value="results" variant="secondary">Show matches now</Button>
            </div>
          </form>
        </Card>
      )}

      {step === "3" && (
        <Card className="p-4 sm:p-5">
          <CardHeader title="What matters most to this family?" subtitle="Each one you tick has to be on record for a program to count it." />
          <form method="get" action="/finder" className="space-y-4">
            {carry([...PREF_KEYS, "fit"])}
            <div className="flex flex-wrap gap-2">
              {QUICK.filter((q) => PREF_KEYS.includes(q.key)).map((q) => (
                <label key={q.key} className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-[13px] has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700">
                  <input type="checkbox" name={q.key} value="1" defaultChecked={!!f[q.key]} className="size-3.5" />
                  {q.label}
                </label>
              ))}
            </div>
            {checker && (
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" name="fit" value="1" defaultChecked={!!f.fit} className="mt-0.5 size-4" />
                <span>Leave out anything {student ? student.firstName : "these scores"} cannot meet yet. Programs still within reach, such as one that takes an MOI letter, stay in.</span>
              </label>
            )}
            <div>
              <Button type="submit" name="step" value="results">Show matches</Button>
            </div>
          </form>
        </Card>
      )}

      {step === "results" && (
        <Results
          f={f}
          qs={qs}
          checker={checker}
          studentId={student?.id ?? null}
          studentName={student ? fullName(student) : null}
          canShortlist={(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES] as readonly string[]).includes(user.role)}
          summary={summary as string[]}
        />
      )}
    </>
  );
}

async function Results({
  f,
  qs,
  checker,
  studentId,
  studentName,
  canShortlist,
  summary,
}: {
  f: Record<string, string>;
  qs: (extra: Record<string, string | undefined>) => string;
  checker: Parameters<typeof checkEligibility>[0] | null;
  studentId: string | null;
  studentName: string | null;
  canShortlist: boolean;
  summary: string[];
}) {
  const rates = fxRates(await getSettings());
  const months = wantedMonths(f);
  const budget = budgetInr(f);
  const where = finderWhere(f, checker, rates);
  const [counts, rows] = await Promise.all([
    finderCounts(where, { checker, budget, rates }),
    finderCandidates(where, { checker, months, budget, rates }),
  ]);
  const deadlines = await nextDeadlines(rows.map((r) => r.id));
  const prefs = Object.keys(f).filter((k) => QUICK.some((q) => q.key === k));

  const scored = rows
    .map((r) => ({
      row: r,
      fit: checker ? checkEligibility(checker, r) : null,
      match: null as Match | null,
    }))
    .map((x) => ({
      ...x,
      match: scoreMatch(x.row, {
        fit: x.fit,
        wants: { months, field: f.field ?? null, budgetInr: budget, prefs },
        rates,
        deadline: deadlines.get(x.row.id) ?? null,
        hasScholarship: x.row.scholarship,
      }),
    }))
    .sort((a, b) => b.match!.score - a.match!.score)
    .slice(0, SHOWN);

  const picked = studentId
    ? new Set((await db.select({ id: schema.shortlists.programId }).from(schema.shortlists).where(eq(schema.shortlists.studentId, studentId))).map((x) => x.id))
    : new Set<string>();
  const shortlistFull = picked.size >= SHORTLIST_LIMIT;

  const bands = (["strong", "possible", "stretch"] as const).map((band) => ({ band, items: scored.filter((x) => x.match!.band === band) }));
  const loosen = [
    f.budget ? { label: "any budget", to: qs({ budget: undefined }) } : null,
    f.season ? { label: "any intake", to: qs({ season: undefined }) } : null,
    f.country ? { label: "any destination", to: qs({ country: undefined }) } : null,
    f.field ? { label: "any field", to: qs({ field: undefined }) } : null,
    f.fit ? { label: "include what they cannot meet yet", to: qs({ fit: undefined }) } : null,
  ].filter((x): x is { label: string; to: string } => !!x);

  return (
    <>
      <Card className="mb-3 p-4">
        <p className="text-[13px] text-muted">Looking for</p>
        <p className="text-[15px] font-semibold text-ink" data-testid="finder-summary">{summary.length ? summary.join(" · ") : "anything in the catalogue"}</p>
        <p className="mt-2 text-[13px] text-ink-soft" data-testid="finder-counts">
          <span className="font-semibold text-ink">{counts.total.toLocaleString("en-IN")}</span> program{counts.total === 1 ? "" : "s"} match at {counts.unis.toLocaleString("en-IN")} {counts.unis === 1 ? "university" : "universities"}
          {checker ? <>, of which <span className="font-semibold text-ink">{counts.meets.toLocaleString("en-IN")}</span> meet every requirement on record</> : null}
          {budget ? <>, and <span className="font-semibold text-ink">{counts.inBudget.toLocaleString("en-IN")}</span> sit inside the budget</> : null}.
          {counts.total > SHOWN && <> The best {SHOWN} are below.</>}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <LinkButton href={`/finder?${qs({ step: "1" })}`} size="sm" variant="secondary">Change the answers</LinkButton>
          <LinkButton href={`/search?${qs({ step: undefined })}`} size="sm" variant="secondary">Open all {counts.total.toLocaleString("en-IN")} in search</LinkButton>
          {studentId && <LinkButton href={`/program-options/new?student=${studentId}`} size="sm" variant="secondary">Ask the team for options</LinkButton>}
        </div>
        {budget && (
          <p className="mt-2 text-xs text-muted">
            Fees are compared at the indicative rates in Settings. A program up to a quarter over the budget is still shown, marked as over. A whole-course fee is never shown as a yearly one.
          </p>
        )}
      </Card>

      {scored.length === 0 ? (
        <Card>
          <EmptyState icon={<IconSearch />} title="Nothing matches all of that yet">
            {loosen.length ? (
              <>
                Try{" "}
                {loosen.map((l, i) => (
                  <span key={l.label}>
                    {i > 0 && (i === loosen.length - 1 ? " or " : ", ")}
                    <Link href={`/finder?${l.to}&step=results`} className="font-medium text-brand-600 hover:underline">{l.label}</Link>
                  </span>
                ))}
                .
              </>
            ) : (
              <>Nothing in the catalogue matches. Ask the Overseas team on the help desk.</>
            )}
          </EmptyState>
        </Card>
      ) : (
        <form id="pick" action="/compare" className="space-y-4">
          {bands.map(({ band, items }) =>
            items.length === 0 ? null : (
              <section key={band}>
                <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                  <h2 className="text-[15px] font-semibold text-ink">{BAND_LABEL[band]} <span className="tabular text-muted">({items.length})</span></h2>
                  <p className="text-[13px] text-muted">{BAND_NOTE[band]}</p>
                </div>
                <div className="space-y-2.5">
                  {items.map(({ row, match }) => (
                    <Card key={row.id} className="p-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-start gap-2">
                            <input type="checkbox" form="pick" name="id" value={row.id} aria-label={`Tick ${row.name}`} className="mt-1 size-4" />
                            <div>
                              <Link prefetch={false} href={`/programs/${row.id}${studentId ? `?student=${studentId}` : ""}`} className="font-semibold text-ink hover:text-brand-700 hover:underline">
                                {row.name}
                              </Link>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                                <span>{LEVEL_LABEL[row.level] ?? row.level}</span>
                                <Link prefetch={false} href={`/universities/${row.universityId}`} className="hover:text-brand-700 hover:underline">{row.university}</Link>
                                <span className="inline-flex items-center gap-1"><IconGlobe className="size-3.5" />{row.city ? `${row.city}, ` : ""}{row.country}</span>
                              </p>
                              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px]">
                                <span className="tabular">{tuitionText(row.tuitionPerYear, row.tuitionTotal, row.currency)}</span>
                                <span className="text-muted">· {intakesText(row.intakeMonths)}</span>
                                {tagLabels(row.tags).map((t) => <Chip key={t} tone="info">{t}</Chip>)}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {canShortlist && studentId && (
                            <ShortlistButton studentId={studentId} programId={row.id} on={picked.has(row.id)} labels={{ on: "Shortlisted ✓", off: shortlistFull ? "Shortlist (full)" : `Shortlist for ${studentName?.split(" ")[0]}` }} />
                          )}
                          <LinkButton href={`/programs/${row.id}${studentId ? `?student=${studentId}` : ""}`} size="sm" variant="quiet">Open</LinkButton>
                        </div>
                      </div>
                      <ul className="mt-2 space-y-1 text-[13px]">
                        {match!.reasons.map((r) => (
                          <li key={r} className="flex items-start gap-1.5 text-ink-soft">
                            <IconCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> {r}
                          </li>
                        ))}
                        {match!.cautions.map((r) => (
                          <li key={r} className="flex items-start gap-1.5 text-amber-700" data-testid="finder-caution">
                            <IconAlert className="mt-0.5 size-3.5 shrink-0" /> {r}
                          </li>
                        ))}
                      </ul>
                    </Card>
                  ))}
                </div>
              </section>
            ),
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted">Ticked programs:</span>
            <Button type="submit" size="sm" variant="secondary">Compare</Button>
            <Button type="submit" size="sm" variant="secondary" formAction="/api/programs/search-export">Download ticked</Button>
            {!studentId && (
              <span className="inline-flex items-center gap-1 text-xs text-muted"><IconSpark className="size-3.5" /> Pick a student on step one to shortlist from here.</span>
            )}
          </div>
        </form>
      )}
    </>
  );
}
