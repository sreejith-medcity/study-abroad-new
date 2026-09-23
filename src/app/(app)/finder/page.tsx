import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fullName } from "@/lib/format";
import { ADMIN_ROLES, APP_ROLES, isStaff } from "@/lib/permissions";
import { commissionVisible } from "@/server/commission-visibility";
import { adhocStudent, LEVELS, listOf, QUICK, readSearch } from "@/server/program-search";
import { destinationCounts, studyFields, FINDER_KEYS } from "@/server/finder";
import { SEASON_LABEL } from "@/lib/program-tags";
import { BriefBox } from "./brief-box";
import { CourseBox } from "./course-box";
import { FinderResults } from "./results";
import { Button, Card, CardHeader, Field, Input, LinkButton, PageHeader, Select, cn } from "@/components/ui";

export const metadata = { title: "Course finder" };

const STEPS = [
  ["1", "The student"],
  ["2", "Where and what"],
  ["3", "What matters"],
  ["results", "Matches"],
] as const;

const BUDGETS = [5, 10, 15, 20, 25, 30, 40, 50];
/** Shown on the guided third step and on the one-screen form. The rest live in the panel beside the matches. */
const PREF_KEYS = ["workRights", "scholarship", "noEnglish", "moi", "noAppFee", "waiver", "lowDeposit", "noGre", "noGmat"];

const TESTS = [
  ["ae_ielts", "IELTS", "6.5"],
  ["ae_pte", "PTE", "58"],
  ["ae_toefl", "TOEFL iBT", "80"],
  ["ae_duolingo", "Duolingo", "110"],
  ["ae_gre", "GRE", "300"],
  ["ae_gmat", "GMAT", "600"],
] as const;
const SCORE_KEYS = [...TESTS.map(([k]) => k as string), "ae_12", "ae_ug", "ae_backlogs", "ae_gap"];

const pill = "inline-flex cursor-pointer items-center gap-2 rounded-full border border-line-strong px-3 py-1.5 text-[13px] has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700";

export default async function FinderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const raw = await searchParams;
  const f = readSearch(raw);
  delete f.step;
  const showCommission = await commissionVisible(user);
  if (!showCommission) delete f.commission;
  const asked = String(raw.step ?? "");
  // No step named: the whole form on one screen, which is where most searches start.
  const step = (STEPS.some(([k]) => k === asked) ? asked : "") as "" | (typeof STEPS)[number][0];
  const guided = step === "1" || step === "2" || step === "3";
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
  /** Keeps the answers from elsewhere on every submission. */
  const carry = (except: string[]) =>
    Object.entries(f)
      .filter(([k]) => !except.includes(k))
      .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);

  const countries = step === "" || step === "2" || step === "results" ? await destinationCounts() : [];
  const fields = step === "2" ? await studyFields() : [];
  const chosen = { countries: listOf(f.country), levels: listOf(f.level), seasons: listOf(f.season) };
  const summary = [
    checker ? (student ? fullName(student) : adhoc!.label) : null,
    chosen.countries.length ? chosen.countries.map((c) => countries.find((x) => x.code === c)?.name ?? c).join(" or ") : null,
    chosen.levels.length ? chosen.levels.map((l) => LEVELS.find(([k]) => k === l)?.[1] ?? l).join(", ") : null,
    chosen.seasons.length ? `${chosen.seasons.join(" or ")} intake` : null,
    f.field ?? null,
    f.budget ? `tuition up to ₹${f.budget} lakh a year` : null,
  ].filter(Boolean) as string[];

  const destinations = (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-semibold text-ink">Destinations</legend>
      <div className="flex flex-wrap gap-2">
        {countries.map((c) => (
          <label key={c.code} className={pill}>
            <input type="checkbox" name="country" value={c.code} defaultChecked={chosen.countries.includes(c.code)} className="size-3.5" />
            {c.name} <span className="tabular text-xs text-muted">{c.n.toLocaleString("en-IN")}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
  const levelPills = (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-semibold text-ink">Level</legend>
      <div className="flex flex-wrap gap-2">
        {LEVELS.map(([key, label]) => (
          <label key={key} className={pill}>
            <input type="checkbox" name="level" value={key} defaultChecked={chosen.levels.includes(key)} className="size-3.5" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const seasonPills = (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-semibold text-ink">Intake</legend>
      <div className="flex flex-wrap gap-2">
        {Object.entries(SEASON_LABEL).map(([key, label]) => (
          <label key={key} className={pill}>
            <input type="checkbox" name="season" value={key} defaultChecked={chosen.seasons.includes(key)} className="size-3.5" />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <>
      <PageHeader
        eyebrow="Course finder"
        title="Find courses for a student"
        subtitle="Describe the student, or fill what you know. Every match says why it is there, and every figure comes from the catalogue."
        actions={<LinkButton href="/search" variant="secondary">Full search</LinkButton>}
      />

      {guided || step === "results" ? (
        <nav aria-label="Steps" className="mb-4 flex flex-wrap items-center gap-1.5 text-[13px]">
          <Link href={`/finder?${qs({})}`} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3 py-1 font-medium text-ink-soft hover:border-brand-300 hover:text-brand-700">
            One screen
          </Link>
          {STEPS.map(([key, label], i) => {
            const on = key === step;
            return (
              <Link
                key={key}
                href={`/finder?${qs({ step: key })}`}
                aria-current={on ? "step" : undefined}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium", on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong bg-surface text-ink-soft hover:border-brand-300 hover:text-brand-700")}
              >
                <span className={cn("tabular", on ? "text-white/80" : "text-muted")}>{i + 1}</span> {label}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {summary.length > 0 && step !== "results" && (
        <p className="mb-3 text-[13px] text-muted" data-testid="finder-summary">So far: <span className="font-medium text-ink">{summary.join(" · ")}</span></p>
      )}

      {step === "" && (
        <Card className="p-4 sm:p-5">
          <CardHeader
            title="Everything on one screen"
            subtitle="Fill only what you know. Nothing here is required."
            action={<LinkButton href={`/finder?${qs({ step: "1" })}`} size="sm" variant="quiet">Walk me through it instead</LinkButton>}
          />
          <div className="mb-4">
            <BriefBox keys={FINDER_KEYS} />
          </div>
          <form method="get" action="/finder" className="space-y-4">
            <input type="hidden" name="step" value="results" />
            {carry(["q", "field", "student", "country", "level", "season", "budget", "durFrom", "durTo", ...PREF_KEYS, ...SCORE_KEYS])}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-ink">Course or field of study</p>
                <CourseBox q={f.q} field={f.field} />
              </div>
              <Field label="A student's file" htmlFor="student" hint="Their recorded marks and results are used, practice scores included.">
                <Select id="student" name="student" defaultValue={f.student ?? ""}>
                  <option value="">Nobody yet, I will type the scores</option>
                  {students.map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}
                </Select>
              </Field>
            </div>
            {destinations}
            {levelPills}
            {seasonPills}
            <fieldset className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <legend className="mb-1 text-[13px] font-semibold text-ink">Scores as they stand</legend>
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
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tuition the family can manage" htmlFor="budget" hint="A year, in rupees, at the platform's indicative rates.">
                <Select id="budget" name="budget" defaultValue={f.budget ?? ""}>
                  <option value="">No figure yet</option>
                  {BUDGETS.map((b) => <option key={b} value={b}>Up to ₹{b} lakh a year</option>)}
                </Select>
              </Field>
              <Field label="Shortest course" htmlFor="durFrom" hint="In months.">
                <Input id="durFrom" name="durFrom" defaultValue={f.durFrom ?? ""} inputMode="numeric" placeholder="12" />
              </Field>
              <Field label="Longest course" htmlFor="durTo" hint="In months.">
                <Input id="durTo" name="durTo" defaultValue={f.durTo ?? ""} inputMode="numeric" placeholder="24" />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-semibold text-ink">What matters most</legend>
              <div className="flex flex-wrap gap-2">
                {QUICK.filter((q) => PREF_KEYS.includes(q.key)).map((q) => (
                  <label key={q.key} className={pill}>
                    <input type="checkbox" name={q.key} value="1" defaultChecked={!!f[q.key]} className="size-3.5" />
                    {q.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <Button type="submit">Show matches</Button>
            </div>
          </form>
        </Card>
      )}

      {step === "1" && (
        <Card className="p-4 sm:p-5">
          <CardHeader title="Who is this for?" subtitle="Pick a student's file, or describe one. Scores are only used to work out what they can already meet." />
          <div className="mb-4">
            <BriefBox keys={FINDER_KEYS} step="1" />
          </div>
          <form method="get" action="/finder" className="space-y-4">
            {carry(["student", ...SCORE_KEYS])}
            <Field label="A student's file" htmlFor="student" hint="Their recorded marks and results are used, practice scores included.">
              <Select id="student" name="student" defaultValue={f.student ?? ""}>
                <option value="">Nobody yet, I will type the scores</option>
                {students.map((x) => <option key={x.id} value={x.id}>{fullName(x)}</option>)}
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
            {destinations}
            {levelPills}
            {seasonPills}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Field of study" htmlFor="field">
                <Select id="field" name="field" defaultValue={f.field ?? ""}>
                  <option value="">Any field</option>
                  {fields.map((x) => <option key={x.field} value={x.field}>{x.field} ({x.n.toLocaleString("en-IN")})</option>)}
                </Select>
              </Field>
              <Field label="Tuition the family can manage" htmlFor="budget" hint="A year, in rupees, at the platform's indicative rates.">
                <Select id="budget" name="budget" defaultValue={f.budget ?? ""}>
                  <option value="">No figure yet</option>
                  {BUDGETS.map((b) => <option key={b} value={b}>Up to ₹{b} lakh a year</option>)}
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
                <label key={q.key} className={pill}>
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
        <FinderResults
          f={f}
          qs={qs}
          checker={checker}
          studentId={student?.id ?? null}
          studentName={student ? fullName(student) : null}
          canShortlist={(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES] as readonly string[]).includes(user.role)}
        />
      )}
    </>
  );
}
