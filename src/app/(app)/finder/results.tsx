import Link from "next/link";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { checkEligibility, type Eligibility } from "@/lib/eligibility";
import { LEVEL_LABEL, SHORTLIST_LIMIT, intakesText, tuitionText } from "@/lib/catalogue";
import { BAND_LABEL, scoreMatch, tagLabels, type Match } from "@/lib/finder-score";
import { rankLabels } from "@/lib/rankings";
import { nextDeadlines } from "@/server/deadlines";
import { LEVELS, QUICK, listOf } from "@/server/program-search";
import { CANDIDATES, PAGE, SORTS, budgetInr, finderCandidates, finderCounts, finderWhere, levelFacets, universityFacets, wantedMonths, type FinderRow } from "@/server/finder";
import { fxRates, getSettings } from "@/server/settings";
import { ShortlistButton } from "@/components/shortlist-button";
import { Button, Card, Chip, EmptyState, Input, LinkButton, Select, cn } from "@/components/ui";
import { IconAlert, IconCheck, IconClock, IconGlobe, IconSearch, IconSpark } from "@/components/icons";

const BUDGETS = [5, 10, 15, 20, 25, 30, 40, 50];
const TATS = [3, 5, 7, 14, 30];
const QUALS = [
  ["SCHOOL", "Std. 12th"],
  ["UG", "Bachelor's"],
  ["PG", "Master's"],
] as const;
const ENGLISH = [
  ["ae_ielts", "IELTS"],
  ["ae_pte", "PTE"],
  ["ae_toefl", "TOEFL"],
  ["ae_duolingo", "Duolingo"],
] as const;
const APTITUDE = [
  ["ae_gre", "GRE"],
  ["ae_gmat", "GMAT"],
] as const;
/** Everything the panel on the left owns, so the rest of the answers can be carried as they are. */
const RAIL_KEYS = ["q", "uni", "level", "budget", "durFrom", "durTo", "tat", "uniType", "apply", "qual", "gapMonths", "ae_backlogs", "fit", "page", ...QUICK.map((x) => x.key), ...ENGLISH.map(([k]) => k), ...APTITUDE.map(([k]) => k)];

type Scored = { row: FinderRow; fit: Eligibility | null; match: Match };

export async function FinderResults({
  f,
  qs,
  checker,
  studentId,
  studentName,
  canShortlist,
}: {
  f: Record<string, string>;
  qs: (extra: Record<string, string | undefined>) => string;
  checker: Parameters<typeof checkEligibility>[0] | null;
  studentId: string | null;
  studentName: string | null;
  canShortlist: boolean;
}) {
  const rates = fxRates(await getSettings());
  const months = wantedMonths(f);
  const budget = budgetInr(f);
  const where = finderWhere(f, checker, rates);
  const sort = SORTS.some(([k]) => k === f.sort && k !== "") ? f.sort : "";
  const page = Math.max(1, Number(f.page ?? 1));

  const [counts, unis, levels] = await Promise.all([
    finderCounts(where, { checker, budget, rates }),
    universityFacets(where),
    levelFacets(where),
  ]);
  // The finder's own order is worked out per program, so it covers the best
  // candidates rather than every match; every other order is SQL, page by page.
  const byFit = !sort;
  const pool = byFit ? Math.min(counts.total, CANDIDATES) : counts.total;
  const pages = Math.max(1, Math.ceil(pool / PAGE));
  const rows = await finderCandidates(where, {
    checker,
    months,
    budget,
    rates,
    sort,
    limit: byFit ? CANDIDATES : PAGE,
    offset: byFit ? 0 : (page - 1) * PAGE,
  });
  const deadlines = await nextDeadlines(rows.map((r) => r.id));
  const prefs = Object.keys(f).filter((k) => QUICK.some((q) => q.key === k));

  const scored: Scored[] = rows.map((row) => {
    const fit = checker ? checkEligibility(checker, row) : null;
    return {
      row,
      fit,
      match: scoreMatch(row, {
        fit,
        wants: { months, field: f.field ?? null, budgetInr: budget, prefs },
        rates,
        deadline: deadlines.get(row.id) ?? null,
        hasScholarship: row.scholarship,
      }),
    };
  });
  const ordered = byFit ? scored.sort((a, b) => b.match.score - a.match.score).slice((page - 1) * PAGE, page * PAGE) : scored;

  const picked = studentId
    ? new Set((await db.select({ id: schema.shortlists.programId }).from(schema.shortlists).where(eq(schema.shortlists.studentId, studentId))).map((x) => x.id))
    : new Set<string>();
  const shortlistFull = picked.size >= SHORTLIST_LIMIT;

  const loosen = [
    f.budget ? { label: "any budget", to: qs({ budget: undefined, page: undefined }) } : null,
    f.season ? { label: "any intake", to: qs({ season: undefined, page: undefined }) } : null,
    f.country ? { label: "any destination", to: qs({ country: undefined, page: undefined }) } : null,
    f.field || f.q ? { label: "any course", to: qs({ field: undefined, q: undefined, page: undefined }) } : null,
    f.tat ? { label: "any offer turnaround", to: qs({ tat: undefined, page: undefined }) } : null,
    f.fit ? { label: "include what they cannot meet yet", to: qs({ fit: undefined, page: undefined }) } : null,
  ].filter((x): x is { label: string; to: string } => !!x);

  /** The answers as chips, each one removable. */
  const chips = [
    studentName ? { label: studentName, to: qs({ student: undefined, page: undefined }) } : null,
    f.field ? { label: f.field, to: qs({ field: undefined, page: undefined }) } : null,
    f.q ? { label: `"${f.q}"`, to: qs({ q: undefined, page: undefined }) } : null,
    ...listOf(f.country).map((code) => ({ label: code, to: qs({ country: listOf(f.country).filter((x) => x !== code).join(",") || undefined, page: undefined }) })),
    ...listOf(f.level).map((l) => ({ label: LEVEL_LABEL[l] ?? l, to: qs({ level: listOf(f.level).filter((x) => x !== l).join(",") || undefined, page: undefined }) })),
    ...listOf(f.season).map((s) => ({ label: `${s} intake`, to: qs({ season: listOf(f.season).filter((x) => x !== s).join(",") || undefined, page: undefined }) })),
    f.budget ? { label: `up to ₹${f.budget} lakh a year`, to: qs({ budget: undefined, page: undefined }) } : null,
    f.tat ? { label: `offer within ${f.tat} days`, to: qs({ tat: undefined, page: undefined }) } : null,
  ].filter((x): x is { label: string; to: string } => !!x);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="h-fit p-3.5 lg:sticky lg:top-4">
        <form method="get" action="/finder" className="space-y-3.5">
          <input type="hidden" name="step" value="results" />
          {Object.entries(f)
            .filter(([k]) => !RAIL_KEYS.includes(k))
            .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="flex items-baseline justify-between">
            <h2 className="text-[13px] font-semibold text-ink">Narrow these</h2>
            <Link href={`/finder?${qs({ ...Object.fromEntries(RAIL_KEYS.map((k) => [k, undefined])) })}`} className="text-xs text-brand-600 hover:underline">Clear</Link>
          </div>

          <Field label="Words in the course or university">
            <Input name="q" defaultValue={f.q ?? ""} placeholder="Search these results" className="py-1.5 text-[13px]" aria-label="Words in the course or university" />
          </Field>

          {unis.length > 1 && (
            <Field label="University">
              <div className="max-h-56 space-y-1 overflow-auto pr-1">
                {unis.map((x) => (
                  <label key={x.id} className="flex cursor-pointer items-center gap-2 text-[13px] leading-snug">
                    <input type="checkbox" name="uni" value={x.id} defaultChecked={listOf(f.uni).includes(x.id)} className="size-3.5 shrink-0" />
                    <span className="flex-1 truncate" title={`${x.name}, ${x.country}`}>{x.name}</span>
                    <span className="tabular shrink-0 text-xs text-muted">{x.n.toLocaleString("en-IN")}</span>
                  </label>
                ))}
              </div>
            </Field>
          )}

          <Field label="Level">
            <div className="space-y-1">
              {LEVELS.filter(([k]) => levels.get(k)).map(([key, label]) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input type="checkbox" name="level" value={key} defaultChecked={listOf(f.level).includes(key)} className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  <span className="tabular shrink-0 text-xs text-muted">{(levels.get(key) ?? 0).toLocaleString("en-IN")}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="Tuition a year">
            <Select name="budget" defaultValue={f.budget ?? ""} aria-label="Tuition a year" className="py-1.5 text-[13px]">
              <option value="">Any</option>
              {BUDGETS.map((b) => <option key={b} value={b}>Up to ₹{b} lakh</option>)}
            </Select>
          </Field>

          <Field label="Course length in months">
            <div className="flex items-center gap-2">
              <Input name="durFrom" defaultValue={f.durFrom ?? ""} inputMode="numeric" placeholder="From" aria-label="Shortest course in months" className="py-1.5 text-[13px]" />
              <Input name="durTo" defaultValue={f.durTo ?? ""} inputMode="numeric" placeholder="To" aria-label="Longest course in months" className="py-1.5 text-[13px]" />
            </div>
          </Field>

          <Field label="Offer turnaround">
            <Select name="tat" defaultValue={f.tat ?? ""} aria-label="Offer turnaround" className="py-1.5 text-[13px]">
              <option value="">Any, recorded or not</option>
              {TATS.map((d) => <option key={d} value={d}>Within {d} days</option>)}
            </Select>
          </Field>

          <Field label="What matters">
            <div className="space-y-1">
              {QUICK.filter((q) => RAIL_QUICK.includes(q.key)).map((q) => (
                <label key={q.key} className="flex cursor-pointer items-center gap-2 text-[13px]">
                  <input type="checkbox" name={q.key} value="1" defaultChecked={!!f[q.key]} className="size-3.5 shrink-0" />
                  <span>{q.label}</span>
                </label>
              ))}
            </div>
          </Field>

          <Field label="The student">
            <div className="space-y-2">
              <Select name="qual" defaultValue={f.qual ?? ""} aria-label="Highest qualification finished" className="py-1.5 text-[13px]">
                <option value="">Highest qualification finished</option>
                {QUALS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <div className="grid grid-cols-2 gap-2">
                {[...ENGLISH, ...APTITUDE].map(([key, label]) => (
                  <Input key={key} name={key} defaultValue={f[key] ?? ""} inputMode="decimal" placeholder={label} aria-label={label} className="py-1.5 text-[13px]" />
                ))}
                <Input name="ae_backlogs" defaultValue={f.ae_backlogs ?? ""} inputMode="numeric" placeholder="Backlogs" aria-label="Backlogs" className="py-1.5 text-[13px]" />
                <Input name="gapMonths" defaultValue={f.gapMonths ?? ""} inputMode="numeric" placeholder="Gap, months" aria-label="Study gap in months" className="py-1.5 text-[13px]" />
              </div>
              {checker && (
                <label className="flex cursor-pointer items-start gap-2 text-[13px]">
                  <input type="checkbox" name="fit" value="1" defaultChecked={!!f.fit} className="mt-0.5 size-3.5 shrink-0" />
                  <span>Only what they can meet</span>
                </label>
              )}
            </div>
          </Field>

          <Field label="University and deadlines">
            <div className="space-y-2">
              <Select name="uniType" defaultValue={f.uniType ?? ""} aria-label="University type" className="py-1.5 text-[13px]">
                <option value="">Public or private</option>
                <option value="public">Public</option>
                <option value="private">Private</option>
              </Select>
              <Select name="apply" defaultValue={f.apply ?? ""} aria-label="Applications open or closed" className="py-1.5 text-[13px]">
                <option value="">Open or closed</option>
                <option value="open">Applications open</option>
                <option value="closed">Closed for now</option>
              </Select>
            </div>
          </Field>

          <Button type="submit" className="w-full">Apply</Button>
        </form>
      </Card>

      <div className="min-w-0 space-y-3">
        <Card className="p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[15px] font-semibold text-ink" data-testid="finder-counts">
              {counts.total.toLocaleString("en-IN")} course{counts.total === 1 ? "" : "s"} at {counts.unis.toLocaleString("en-IN")} {counts.unis === 1 ? "university" : "universities"}
            </p>
            <form method="get" action="/finder" className="flex items-center gap-2">
              <input type="hidden" name="step" value="results" />
              {Object.entries(f)
                .filter(([k]) => k !== "sort" && k !== "page")
                .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <label htmlFor="sort" className="text-[13px] text-muted">Sort by</label>
              <Select id="sort" name="sort" defaultValue={sort} className="w-52 py-1.5 text-[13px]">
                {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <Button type="submit" size="sm" variant="secondary">Sort</Button>
            </form>
          </div>
          <p className="mt-1 text-[13px] text-ink-soft">
            {checker ? <><span className="font-semibold text-ink">{counts.meets.toLocaleString("en-IN")}</span> meet every requirement on record. </> : null}
            {budget ? <><span className="font-semibold text-ink">{counts.inBudget.toLocaleString("en-IN")}</span> sit inside the budget, and anything up to a quarter over is shown and marked. </> : null}
            {byFit && counts.total > CANDIDATES ? `Best fit is worked out over the strongest ${CANDIDATES.toLocaleString("en-IN")} of these; sort by fee or ranking to page through all of them.` : null}
          </p>
          {chips.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <Link key={chip.label} href={`/finder?${chip.to}&step=results`} className="inline-flex items-center gap-1 rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-soft hover:border-brand-300 hover:text-brand-700">
                  {chip.label} <span aria-hidden="true">×</span>
                  <span className="sr-only">Remove</span>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <LinkButton href={`/finder?${qs({ step: undefined, page: undefined })}`} size="sm" variant="secondary">Change the answers</LinkButton>
            <LinkButton href={`/search?${qs({ step: undefined, page: undefined })}`} size="sm" variant="secondary">Open in full search</LinkButton>
            {studentId && <LinkButton href={`/program-options/new?student=${studentId}`} size="sm" variant="secondary">Ask the team for options</LinkButton>}
          </div>
        </Card>

        {ordered.length === 0 ? (
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
          <form id="pick" action="/compare" className="space-y-2.5">
            {ordered.map(({ row, match }) => (
              <Card key={row.id} className="p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <input type="checkbox" form="pick" name="id" value={row.id} aria-label={`Tick ${row.name}`} className="mt-1 size-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link prefetch={false} href={`/programs/${row.id}${studentId ? `?student=${studentId}` : ""}`} className="font-semibold text-ink hover:text-brand-700 hover:underline">
                          {row.name}
                        </Link>
                        <Chip tone={match.band === "strong" ? "ok" : match.band === "possible" ? "info" : "neutral"}>{BAND_LABEL[match.band]}</Chip>
                        {row.pathway !== "DEGREE" && <Chip tone="brand">{row.pathway === "AUSBILDUNG" ? "Ausbildung" : "Nursing"}</Chip>}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
                        <span>{LEVEL_LABEL[row.level] ?? row.level}</span>
                        <Link prefetch={false} href={`/universities/${row.universityId}`} className="hover:text-brand-700 hover:underline">{row.university}</Link>
                        <span className="inline-flex items-center gap-1"><IconGlobe className="size-3.5" />{row.city ? `${row.city}, ` : ""}{row.country}</span>
                        {row.isPublic && <Chip>Public</Chip>}
                        {rankLabels(row).length > 0 && <span className="font-medium text-ink-soft">{rankLabels(row)[0]}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {canShortlist && studentId && (
                      <ShortlistButton studentId={studentId} programId={row.id} on={picked.has(row.id)} labels={{ on: "Shortlisted ✓", off: shortlistFull ? "Shortlist (full)" : `Shortlist for ${studentName?.split(" ")[0]}` }} />
                    )}
                    <LinkButton href={`/programs/${row.id}${studentId ? `?student=${studentId}` : ""}`} size="sm" variant="quiet">Open</LinkButton>
                  </div>
                </div>

                <dl className="mt-2 grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label="Tuition" value={tuitionText(row.tuitionPerYear, row.tuitionTotal, row.currency)} />
                  <Fact label="Length" value={row.durationMonths ? `${row.durationMonths} months` : null} />
                  <Fact label="Intakes" value={row.intakeMonths.length ? intakesText(row.intakeMonths) : null} />
                  <Fact
                    label="Offer in"
                    value={row.offerTatDays == null ? null : row.offerTatDays === 1 ? "1 day" : `${row.offerTatDays} days`}
                    icon={row.offerTatDays == null ? undefined : <IconClock className="size-3.5 text-muted" />}
                  />
                </dl>

                {(match.reasons.length > 0 || match.cautions.length > 0) && (
                  <ul className="mt-2 space-y-1 text-[13px]">
                    {match.reasons.slice(0, 4).map((r) => (
                      <li key={r} className="flex items-start gap-1.5 text-ink-soft">
                        <IconCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> {r}
                      </li>
                    ))}
                    {match.cautions.map((r) => (
                      <li key={r} className="flex items-start gap-1.5 text-amber-700" data-testid="finder-caution">
                        <IconAlert className="mt-0.5 size-3.5 shrink-0" /> {r}
                      </li>
                    ))}
                  </ul>
                )}
                {tagLabels(row.tags).length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">{tagLabels(row.tags).map((t) => <Chip key={t} tone="info">{t}</Chip>)}</p>
                )}
              </Card>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Ticked courses:</span>
                <Button type="submit" size="sm" variant="secondary">Compare</Button>
                <Button type="submit" size="sm" variant="secondary" formAction="/api/programs/search-export">Download ticked</Button>
                {!studentId && <span className="inline-flex items-center gap-1 text-xs text-muted"><IconSpark className="size-3.5" /> Pick a student to shortlist from here.</span>}
              </div>
              {pages > 1 && (
                <nav className="flex items-center gap-2 text-[13px]" aria-label="Pages">
                  {page > 1 && <Link href={`/finder?${qs({ page: String(page - 1) })}&step=results`} className="font-medium text-brand-600 hover:underline">Previous</Link>}
                  <span className="text-muted">Page {page} of {pages.toLocaleString("en-IN")}</span>
                  {page < pages && <Link href={`/finder?${qs({ page: String(page + 1) })}&step=results`} className="font-medium text-brand-600 hover:underline">Next</Link>}
                </nav>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Quick filters the panel offers; the rest belong on full search. */
const RAIL_QUICK = ["workRights", "scholarship", "noEnglish", "moi", "noAppFee", "waiver", "lowDeposit", "noGre", "noGmat"];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      {children}
    </div>
  );
}

/** One figure on a row, which reads "Not recorded" when nobody has verified it. */
function Fact({ label, value, icon }: { label: string; value: string | null; icon?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted">{label}:</span>
      <span className={cn("truncate", value ? "font-medium text-ink" : "text-muted")}>
        {icon} {value ?? "Not recorded"}
      </span>
    </div>
  );
}
