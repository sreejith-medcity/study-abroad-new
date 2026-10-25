import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { groupInr, fmtMoney } from "@/lib/format";
import { durationText, feeText, intakesText, LEVEL_LABEL, tuitionText } from "@/lib/catalogue";
import { firstLines, PROBLEM_LABEL, publishProblems, readReviewFilters, REVIEW_SOURCES, reviewQuery } from "@/lib/draft-review";
import { flagText, readShow, SHOW_LABEL, type CourseIdentity, type ReviewFlag, type ShowFilter } from "@/lib/review-flags";
import { DRAFTS_PAGE, nextUniversity, reviewUniversity, universityDrafts, type DraftRow } from "@/server/draft-review";
import { Chip, cn, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { ReviewForm, SelectAll } from "./review-form";

export const metadata = { title: "Review drafts" };
// Publish all at one of the largest universities runs a few batches.
export const maxDuration = 300;

const SOURCE_NAME: Record<string, string> = { MIOC: "MIOC app", CRICOS: "CRICOS register", REGISTER: "Public register" };

/**
 * What hovering a flag's chip says: the figure behind it, so the desk can
 * judge the flag without opening the course. Nothing here is a verdict.
 */
function flagTitle(flag: ReviewFlag, r: DraftRow, currency: string): string | undefined {
  if (flag === "FEE_OUTLIER" && r.feeMedian != null) {
    return `The median yearly fee for a ${(LEVEL_LABEL[r.level] ?? r.level).toLowerCase()} in this country is ${fmtMoney(Math.round(r.feeMedian), currency)}, over ${groupInr(r.feeCourses)} courses.`;
  }
  if (flag === "DUPLICATE" && r.duplicateOf) {
    const d = r.duplicateOf;
    return `${d.name} (${LEVEL_LABEL[d.level] ?? d.level}, ${durationText(d.durationMonths).toLowerCase()}) is ${d.status === "LIVE" ? "live" : d.status === "DRAFT" ? "a draft" : "archived"} at this university.`;
  }
  if (flag === "FEE_IN_WORDS") return "The MIOC app's fee could not be read as a yearly figure, so it was kept in words in the entry notes.";
  if (flag === "ODD_DURATION") return r.durationMonths == null ? "The MIOC app's duration could not be read as months, so it was kept in words in the entry notes." : `${r.durationMonths} months is an unusual length for this level.`;
  if (flag === "SCORE_ODD") return "An English score outside what the test gives or a university asks for.";
  return undefined;
}

/** One university's drafts, to be checked and published or archived. */
export default async function UniversityDraftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ universityId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser([...ADMIN_ROLES]);
  const { universityId } = await params;
  const sp = await searchParams;
  // The list's filters ride along so "Next university" follows the same list.
  // The page number and the show filter here are this university's own.
  const f = readReviewFilters({ ...sp, page: undefined });
  const draftPage = readReviewFilters({ page: sp.page }).page;
  const show = readShow(sp.show);
  const uni = await reviewUniversity(universityId, f.source);
  if (!uni) notFound();
  const [drafts, next] = await Promise.all([universityDrafts(universityId, f.source, draftPage, show), nextUniversity(uni, f)]);
  const { rows, shown, flagged } = drafts;
  const clean = Math.max(0, uni.drafts - flagged);
  const lastPage = Math.max(1, Math.ceil(shown / DRAFTS_PAGE));
  const from = f.source ? ` from ${REVIEW_SOURCES[f.source]}` : "";
  const here = (extra: Record<string, string | number | undefined>) => `/admin/programs/review/${universityId}${reviewQuery(f, { show: show === "all" ? undefined : show, ...extra })}`;
  const nextLink = next ? { href: `/admin/programs/review/${next.id}${reviewQuery(f)}`, name: next.name, drafts: next.drafts } : null;
  const allLabel = f.source
    ? `Publish all ${groupInr(uni.drafts)} draft${uni.drafts === 1 ? "" : "s"}${from}`
    : `Publish all ${groupInr(uni.drafts)} draft${uni.drafts === 1 ? "" : "s"} at this university`;
  const showCount: Record<ShowFilter, number> = { all: uni.drafts, flagged, clean };

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/admin/programs/review${reviewQuery(f)}`} className="text-sm font-medium text-brand-600 hover:underline">
            ← Review drafts
          </Link>
        }
        title={uni.name}
        subtitle={`${uni.country} · ${groupInr(uni.drafts)} draft${uni.drafts === 1 ? "" : "s"}${from} · ${groupInr(flagged)} worth a look · ${groupInr(uni.live)} live already`}
        actions={
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/admin/universities/${uni.id}`} variant="secondary" size="sm">
              Edit the university
            </LinkButton>
            {nextLink && (
              <LinkButton href={nextLink.href} variant="quiet" size="sm" data-skip-university>
                Skip to {nextLink.name}
              </LinkButton>
            )}
          </div>
        }
      />
      <div className="rounded-xl border border-line bg-surface shadow-card" data-review-drafts={uni.id} data-draft-total={uni.drafts} data-flagged-total={flagged}>
        <ReviewForm universityId={uni.id} source={f.source ?? ""} total={uni.drafts} clean={clean} allLabel={allLabel} next={nextLink}>
          {uni.drafts > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
              <span className="text-sm text-muted">Show:</span>
              <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-sm font-medium" role="group" aria-label="Show" data-show-filter>
                {(["all", "flagged", "clean"] as const).map((s) => (
                  <Link
                    key={s}
                    href={here({ show: s === "all" ? undefined : s, page: undefined })}
                    aria-current={show === s ? "page" : undefined}
                    data-show={s}
                    className={cn("rounded-md px-3 py-1", show === s ? "bg-brand-600 text-white" : "text-ink-soft hover:text-brand-700")}
                  >
                    {SHOW_LABEL[s]} ({groupInr(showCount[s])})
                  </Link>
                ))}
              </div>
              <span className="text-sm text-muted">Flags are advice: nothing is changed by them, and an unknown figure stays Not recorded.</span>
            </div>
          )}
          {rows.length === 0 && uni.drafts > 0 && show !== "all" && draftPage === 1 ? (
            <EmptyState
              title={show === "flagged" ? `Nothing worth a look${from} at ${uni.name}` : `No clean drafts${from} at ${uni.name}`}
              action={<LinkButton href={here({ show: undefined })} variant="secondary" size="sm">Show all drafts</LinkButton>}
            >
              {show === "flagged" ? "Every draft here is clean." : "Every draft here has something worth a look."}
            </EmptyState>
          ) : rows.length === 0 && uni.drafts > 0 ? (
            <EmptyState title="No more drafts on this page" action={<LinkButton href={here({})} variant="secondary" size="sm">Back to the first page</LinkButton>}>
              The courses that were here have been published or archived.
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState
              title={`No drafts${from} left at ${uni.name}`}
              action={nextLink ? <LinkButton href={nextLink.href} size="sm">Next university: {nextLink.name}</LinkButton> : <LinkButton href={`/admin/programs/review${reviewQuery(f)}`} variant="secondary" size="sm">Back to the list</LinkButton>}
            >
              Everything here is live or archived.
            </EmptyState>
          ) : (
            <Table tableClassName="min-w-[1400px]">
              <thead>
                <tr>
                  <Th className="w-8"><SelectAll /></Th>
                  <Th>Course</Th>
                  <Th>Level</Th>
                  <Th>Duration</Th>
                  <Th>Tuition</Th>
                  <Th>Application fee</Th>
                  <Th>Intakes</Th>
                  <Th>English</Th>
                  <Th>Entry notes</Th>
                  <Th>Worth a look</Th>
                  <Th>Can go live</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const problems = publishProblems(r);
                  const notes = firstLines(r.entryRequirements);
                  const english = [r.minIelts != null && `IELTS ${r.minIelts}`, r.minPte != null && `PTE ${r.minPte}`, r.minToefl != null && `TOEFL ${r.minToefl}`].filter(Boolean) as string[];
                  const self: CourseIdentity = { name: r.name, level: r.level, durationMonths: r.durationMonths };
                  return (
                    <tr key={r.id} data-draft-row={r.id} data-problems={problems.join(" ")} data-flags={r.flags.join(" ")}>
                      <Td>
                        <input type="checkbox" name="id" value={r.id} aria-label={`Select ${r.name}`} className="mt-1 size-4 accent-brand-600" />
                      </Td>
                      <Td>
                        <Link prefetch={false} href={`/admin/programs/${r.id}`} className="font-medium hover:text-brand-700 hover:underline">
                          {r.name}
                        </Link>
                        <p className="text-xs text-muted">{r.source ? SOURCE_NAME[r.source] ?? r.source : "Researched catalogue"}</p>
                      </Td>
                      <Td className="whitespace-nowrap">{LEVEL_LABEL[r.level] ?? r.level}</Td>
                      <Td className="whitespace-nowrap">{durationText(r.durationMonths)}</Td>
                      <Td className="whitespace-nowrap tabular">
                        {/* A whole-course fee is shown as the register states it, never divided into a year. */}
                        <span className={r.tuitionPerYear == null && r.tuitionTotal == null ? "text-muted" : undefined}>{tuitionText(r.tuitionPerYear, r.tuitionTotal, uni.currency)}</span>
                      </Td>
                      <Td className="whitespace-nowrap tabular">
                        <span className={r.applicationFee == null ? "text-muted" : undefined}>{feeText(r.applicationFee, uni.currency, { zero: "No application fee" })}</span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        <span className={r.intakeMonths.length ? undefined : "text-muted"}>{intakesText(r.intakeMonths)}</span>
                      </Td>
                      <Td>
                        {english.length ? (
                          <div className="flex max-w-48 flex-wrap gap-1">{english.map((e) => <Chip key={e}>{e}</Chip>)}</div>
                        ) : (
                          <span className="text-muted">Not recorded</span>
                        )}
                      </Td>
                      <Td className="max-w-72 text-sm" title={r.entryRequirements ? r.entryRequirements.slice(0, 600) : undefined}>
                        {notes || <span className="text-muted">Not recorded</span>}
                      </Td>
                      <Td>
                        {r.flags.length ? (
                          <div className="flex max-w-64 flex-col items-start gap-1">
                            {r.flags.map((flag) => (
                              <span key={flag} title={flagTitle(flag, r, uni.currency)} data-flag={flag}>
                                {flag === "DUPLICATE" && r.duplicateOf ? (
                                  <Link prefetch={false} href={`/admin/programs/${r.duplicateOf.id}`} className="hover:underline">
                                    <Chip tone="info" className="whitespace-normal text-left">{flagText(flag, self, r.duplicateOf)}</Chip>
                                  </Link>
                                ) : (
                                  <Chip tone="info">{flagText(flag, self, null)}</Chip>
                                )}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted" data-flag="none">Nothing odd</span>
                        )}
                      </Td>
                      <Td>
                        {problems.length ? (
                          <div className="flex flex-col items-start gap-1">
                            {problems.map((x) => <Chip key={x} tone="warn">{PROBLEM_LABEL[x]}</Chip>)}
                          </div>
                        ) : (
                          <Chip tone="ok">Ready</Chip>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          {(draftPage > 1 || draftPage < lastPage) && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <span className="text-sm text-muted">
                {rows.length ? `Drafts ${groupInr((draftPage - 1) * DRAFTS_PAGE + 1)} to ${groupInr((draftPage - 1) * DRAFTS_PAGE + rows.length)} of ${groupInr(shown)}` : `Page ${draftPage} is past the end`}
              </span>
              <div className="flex gap-2">
                {draftPage > 1 && <LinkButton variant="secondary" size="sm" href={here({ page: Math.min(draftPage - 1, lastPage) })}>Previous</LinkButton>}
                {draftPage < lastPage && <LinkButton variant="secondary" size="sm" href={here({ page: draftPage + 1 })}>Next</LinkButton>}
              </div>
            </div>
          )}
        </ReviewForm>
      </div>
    </>
  );
}
