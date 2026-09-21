import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DOCUMENT_TYPES } from "@/db/statuses";
import { requireUser } from "@/lib/auth";
import { LEVEL_LABEL, PATHWAY_LABEL, SHORTLIST_LIMIT, durationText, feeText, inrApprox, intakesText, tuitionText } from "@/lib/catalogue";
import { checkEligibility } from "@/lib/eligibility";
import { fullName } from "@/lib/format";
import { ADMIN_ROLES, APP_ROLES, isAdmin, isStaff } from "@/lib/permissions";
import { openScholarships } from "@/server/scholarships";
import { fxRates, getSettings } from "@/server/settings";
import { ScholarshipList } from "@/components/scholarship-list";
import { ShortlistButton } from "@/components/shortlist-button";
import { Alert, Button, Card, CardHeader, Chip, DataList, LinkButton, PageHeader, Select } from "@/components/ui";
import { IconAlert, IconCheck, IconClock, IconGlobe } from "@/components/icons";

export const metadata = { title: "Program" };

const DOC_LABEL = new Map(DOCUMENT_TYPES.map((d) => [d.code, d.label]));

export default async function ProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser([...APP_ROLES]);
  const { id } = await params;
  const sp = await searchParams;
  const studentId = typeof sp.student === "string" ? sp.student : undefined;

  const program = await db.query.programs.findFirst({
    where: eq(schema.programs.id, id),
    with: { university: { with: { country: true } } },
  });
  // Partners only ever see what is open for applications.
  if (!program || (program.status !== "LIVE" && !isStaff(user))) notFound();
  const { university } = program;
  const { country } = university;
  const cur = country.currency;

  const s = schema.students;
  const scope = isStaff(user) ? undefined : eq(s.orgId, user.orgId);
  const [students, student, siblings, [{ siblingTotal }]] = await Promise.all([
    db.select({ id: s.id, firstName: s.firstName, lastName: s.lastName }).from(s).where(and(eq(s.archived, false), scope)).orderBy(asc(s.firstName)).limit(300),
    studentId ? db.query.students.findFirst({ where: and(eq(s.id, studentId), scope), with: { tests: true } }) : Promise.resolve(undefined),
    db.query.programs.findMany({
      where: and(eq(schema.programs.universityId, university.id), eq(schema.programs.status, "LIVE"), ne(schema.programs.id, program.id)),
      orderBy: asc(schema.programs.name),
      limit: 8,
    }),
    db
      .select({ siblingTotal: count() })
      .from(schema.programs)
      .where(and(eq(schema.programs.universityId, university.id), eq(schema.programs.status, "LIVE"), ne(schema.programs.id, program.id))),
  ]);

  // The Mohawk trap: the same program taught at two campuses, one with post-study
  // work and one without. Anyone selling from the name alone sells the wrong one.
  const base = (n: string) => n.replace(/\s*\(.*\)\s*$/, "").trim().toLowerCase();
  const twins = (
    await db.query.programs.findMany({
      where: and(eq(schema.programs.universityId, university.id), eq(schema.programs.status, "LIVE"), ne(schema.programs.id, program.id)),
      columns: { id: true, name: true, campus: true, workRights: true },
    })
  ).filter((x) => base(x.name) === base(program.name) && x.workRights !== program.workRights && x.campus !== program.campus);

  const canShortlist = (["PARTNER", "COUNSELLOR", ...ADMIN_ROLES] as readonly string[]).includes(user.role);
  const picks = student
    ? await db.select({ programId: schema.shortlists.programId }).from(schema.shortlists).where(eq(schema.shortlists.studentId, student.id))
    : [];
  const shortlisted = picks.some((x) => x.programId === program.id);
  const shortlistCount = picks.length;

  // The same field and level elsewhere in the same country: what a student
  // who likes this one would also look at.
  const P = schema.programs;
  const similar = program.studyArea
    ? await db
        .select({ id: P.id, name: P.name, university: schema.universities.name, perYear: P.tuitionPerYear, total: P.tuitionTotal, workRights: P.workRights })
        .from(P)
        .innerJoin(schema.universities, eq(P.universityId, schema.universities.id))
        .where(and(eq(P.status, "LIVE"), eq(P.level, program.level), eq(P.studyArea, program.studyArea), eq(schema.universities.countryId, country.id), ne(P.universityId, university.id)))
        .orderBy(sql`${P.workRights} = 'ELIGIBLE' desc`, sql`${P.tuitionPerYear} is null`, asc(P.tuitionPerYear), asc(P.name))
        .limit(6)
    : [];
  const scholarships = await openScholarships(university.id, program.level);
  const rates = fxRates(await getSettings());
  // The rupee figure sits under the real one, smaller, and says it is rough.
  const withInr = (amount: number | null, text: string) => {
    const inr = inrApprox(amount, cur, rates);
    return inr ? <span>{text}<span className="block text-xs font-normal text-muted">{inr} at the team&apos;s indicative rate</span></span> : text;
  };

  const fit = student ? checkEligibility({ backlogs: student.backlogs, gapYears: student.gapYears, tests: student.tests }, program) : null;
  const hasEnglish = program.minIelts != null || program.minPte != null || program.minOetGrade != null;

  const requirements = [
    program.minIelts != null && { label: "IELTS overall", value: program.minIelts.toFixed(1) },
    program.minPte != null && { label: "PTE Academic", value: String(program.minPte) },
    program.minOetGrade && { label: "OET grade", value: program.minOetGrade },
    program.minGermanLevel && { label: "German (CEFR)", value: program.minGermanLevel },
    program.maxBacklogs != null && { label: "Backlogs allowed", value: `Up to ${program.maxBacklogs}` },
    program.maxGapYears != null && { label: "Study gap allowed", value: `Up to ${program.maxGapYears} year${program.maxGapYears === 1 ? "" : "s"}` },
    // The flag is only ever set when someone confirmed it, so "false" means
    // nobody recorded it, not that the institution refuses the letter.
    { label: "Medium of instruction letter", value: program.moiAccepted ? "Accepted instead of a test" : "Not recorded", tone: program.moiAccepted ? ("ok" as const) : undefined },
  ].filter(Boolean) as { label: string; value: string; tone?: "ok" }[];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/search" className="text-[13px] font-medium text-brand-600 hover:underline">
            ← Search programs
          </Link>
        }
        title={program.name}
        subtitle={`${LEVEL_LABEL[program.level] ?? program.level}${program.studyArea ? ` · ${program.studyArea}` : ""} · ${university.name}, ${country.name}`}
        actions={isAdmin(user) ? <LinkButton variant="secondary" href={`/admin/programs/${program.id}`}>Edit program</LinkButton> : undefined}
      />

      {program.status !== "LIVE" && (
        <Alert tone="warn" title={program.status === "DRAFT" ? "Draft: partners cannot see this yet" : "Archived: closed to new applications"}>
          Only the Overseas team can open this page until it is published.
        </Alert>
      )}

      {twins.map((t) => (
        <Alert key={t.id} tone="warn" title="Same program, different campus, different work rights">
          <Link href={`/programs/${t.id}`} className="font-medium underline">{t.name}</Link>
          {t.campus ? ` at ${t.campus}` : ""} is{" "}
          {t.workRights === "ELIGIBLE" ? "eligible for" : t.workRights === "INELIGIBLE" ? "not eligible for" : "not confirmed for"} post-study work, while this one
          {program.campus ? ` at ${program.campus}` : ""} is{" "}
          {program.workRights === "ELIGIBLE" ? "eligible" : program.workRights === "INELIGIBLE" ? "not eligible" : "not confirmed"}. Check which campus the student is applying to.
        </Alert>
      ))}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="At a glance" subtitle="Blank figures have not been verified with the institution yet" />
            <DataList
              rows={[
                { label: "University", value: university.name, href: `/universities/${university.id}` },
                { label: program.campus ? "Campus" : "Location", value: `${program.campus ?? university.city ? `${program.campus ?? university.city}, ` : ""}${country.name}` },
                { label: "Pathway", value: PATHWAY_LABEL[program.pathway] ?? program.pathway },
                { label: "Duration", value: durationText(program.durationMonths) },
                { label: "Intakes", value: intakesText(program.intakeMonths) },
                { label: "Tuition per year", value: withInr(program.tuitionPerYear, feeText(program.tuitionPerYear, cur, { zero: "No tuition fee" })) },
                ...(program.tuitionTotal != null ? [{ label: "Tuition, whole course", value: withInr(program.tuitionTotal, feeText(program.tuitionTotal, cur, { zero: "No tuition fee" })) }] : []),
                { label: "Application fee", value: feeText(program.applicationFee, cur, { zero: "No application fee" }) },
                { label: "Deposit to confirm a place", value: feeText(program.initialDeposit, cur, { zero: "No deposit" }) },
                ...(program.externalCode ? [{ label: program.source === "CRICOS" ? "Source" : "CRICOS code", value: program.source === "CRICOS" ? `CRICOS register, course ${program.externalCode}` : program.externalCode }] : []),
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Post-study work" subtitle="Only marked eligible where the institution or an official register says so" />
            <div className="p-4 text-[13px]">
              {program.workRights === "ELIGIBLE" && (
                <p className="flex items-start gap-2"><Chip tone="ok"><IconCheck className="size-3.5" /> Eligible</Chip></p>
              )}
              {program.workRights === "INELIGIBLE" && (
                <p className="flex items-start gap-2"><Chip tone="bad"><IconAlert className="size-3.5" /> Not eligible</Chip></p>
              )}
              {program.workRights === "UNKNOWN" && <p><Chip>Not confirmed</Chip></p>}
              <p className="mt-2 leading-relaxed text-ink-soft">
                {program.workRightsNote ??
                  (program.workRights === "UNKNOWN"
                    ? "Nobody has confirmed this yet. Check with the Overseas team before telling a student they can stay and work."
                    : "No evidence note recorded.")}
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Entry requirements" subtitle={hasEnglish ? undefined : "No English test requirement recorded"} />
            <DataList rows={requirements} />
            {program.requiredDocs.length > 0 && (
              <div className="border-t border-line p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Documents for the application</p>
                <ul className="grid gap-1 text-[13px] sm:grid-cols-2">
                  {program.requiredDocs.map((d) => (
                    <li key={d} className="flex items-center gap-1.5"><IconCheck className="size-3.5 text-good-700" /> {DOC_LABEL.get(d) ?? d}</li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Check a student" subtitle="See the fit, then apply in one step" />
            <form className="flex gap-2 p-4 pb-3">
              <Select name="student" aria-label="Student" defaultValue={student?.id ?? ""} className="min-w-0 flex-1">
                <option value="">Choose a student…</option>
                {students.map((x) => (
                  <option key={x.id} value={x.id}>{fullName(x)}</option>
                ))}
              </Select>
              <Button type="submit" variant="secondary" size="sm">Check</Button>
            </form>
            {student && fit && (
              <div className="border-t border-line p-4 text-[13px]">
                <p className="mb-2">
                  {fit.verdict === "eligible" && <Chip tone="ok"><IconCheck className="size-3.5" /> Eligible</Chip>}
                  {fit.verdict === "on-track" && <Chip tone="warn"><IconClock className="size-3.5" /> On track</Chip>}
                  {fit.verdict === "blocked" && <Chip tone="bad"><IconAlert className="size-3.5" /> Not yet</Chip>}
                  {fit.verdict === "unknown" && <Chip>No rules recorded</Chip>}
                  <span className="ml-2 font-medium">{fullName(student)}</span>
                </p>
                <ul className="space-y-0.5 text-muted">
                  {fit.met.map((m) => <li key={m}>✓ {m}</li>)}
                  {fit.missing.map((m) => <li key={m} className="text-stop-600">{m}</li>)}
                  {fit.onTrack.map((m) => <li key={m}>{m}</li>)}
                </ul>
                {program.status === "LIVE" && program.intakeMonths.length === 0 && (
                  <p className="mt-3 text-xs text-muted">No intakes are recorded for this program. You can still apply for the intake the student is aiming for; the Overseas team confirms it with the institution.</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {program.status === "LIVE" && (
                    <LinkButton
                      size="sm"
                      variant={fit.verdict === "blocked" ? "secondary" : "primary"}
                      href={`/students/${student.id}/applications?tab=apply&program=${program.id}`}
                    >
                      Apply for {student.firstName}
                    </LinkButton>
                  )}
                  {canShortlist && program.status === "LIVE" && (shortlisted || shortlistCount < SHORTLIST_LIMIT) && (
                    <ShortlistButton studentId={student.id} programId={program.id} on={shortlisted} labels={{ on: "Shortlisted ✓", off: "Add to shortlist" }} />
                  )}
                  {shortlistCount > 0 && (
                    <Link href={`/students/${student.id}/shortlist`} className="text-xs font-medium text-brand-600 hover:underline">
                      Compare {shortlistCount}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </Card>

          <ScholarshipList rows={scholarships} subtitle={`At ${university.name}, for this level. Check the page before promising one.`} />

          <Card>
            <CardHeader
              title={`More at ${university.name}`}
              subtitle={siblingTotal ? `${siblingTotal} other live program${siblingTotal === 1 ? "" : "s"}` : "No other live programs yet"}
            />
            {siblings.length > 0 && (
              <ul className="divide-y divide-line">
                {siblings.map((x) => (
                  <li key={x.id}>
                    <Link prefetch={false} href={`/programs/${x.id}`} className="block px-4 py-2.5 text-[13px] hover:bg-surface-2/60">
                      <span className="font-medium text-ink">{x.name}</span>
                      <span className="block text-xs text-muted">{LEVEL_LABEL[x.level] ?? x.level}{x.studyArea ? ` · ${x.studyArea}` : ""}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-line px-4 py-3">
              <Link href={`/universities/${university.id}`} className="flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:underline">
                <IconGlobe className="size-4" /> University page
              </Link>
            </div>
          </Card>

          {similar.length > 0 && (
            <Card>
              <CardHeader title="Similar programs" subtitle={`${program.studyArea}, ${LEVEL_LABEL[program.level] ?? program.level}, elsewhere in ${country.name}`} />
              <ul className="divide-y divide-line">
                {similar.map((x) => (
                  <li key={x.id}>
                    <Link prefetch={false} href={`/programs/${x.id}${student ? `?student=${student.id}` : ""}`} className="block px-4 py-2.5 text-[13px] hover:bg-surface-2/60">
                      <span className="font-medium text-ink">{x.name}</span>
                      <span className="block text-xs text-muted">
                        {x.university} · {tuitionText(x.perYear, x.total, cur)}
                        {x.workRights === "ELIGIBLE" && " · Post-study work"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line px-4 py-3">
                <Link prefetch={false} href={`/search?${new URLSearchParams({ country: country.code, level: program.level, field: program.studyArea!, ...(student ? { student: student.id } : {}) })}`} className="text-[13px] font-medium text-brand-600 hover:underline">
                  See them all in search
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
