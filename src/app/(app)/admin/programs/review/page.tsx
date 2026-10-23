import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_ROLES } from "@/lib/permissions";
import { groupInr } from "@/lib/format";
import { readReviewFilters, REVIEW_SOURCES, reviewQuery, share } from "@/lib/draft-review";
import { LIST_PAGE, reviewList } from "@/server/draft-review";
import { Button, Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Review drafts" };

/** A count beside its share of the university's drafts, dimmed when nothing is recorded. */
function Recorded({ col, n, of }: { col: string; n: number; of: number }) {
  return (
    <Td className="whitespace-nowrap tabular">
      <span data-col={col} data-count={n} className={n === 0 ? "text-muted" : undefined}>
        {groupInr(n)}
      </span>
      <span className="ml-1 text-xs text-muted">{share(n, of)}%</span>
    </Td>
  );
}

/**
 * Universities with draft courses, so the desk can check drafts one
 * university at a time rather than publish everything a filter matches.
 */
export default async function DraftReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser([...ADMIN_ROLES]);
  const f = readReviewFilters(await searchParams);
  const [list, countries] = await Promise.all([
    reviewList(f),
    db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.name)),
  ]);
  const { rows, universities, drafts } = list;
  const lastPage = Math.max(1, Math.ceil(universities / LIST_PAGE));
  const narrowed = !!(f.q || f.country || f.source);
  const from = f.source ? ` from ${REVIEW_SOURCES[f.source]}` : "";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/admin/programs" className="text-sm font-medium text-brand-600 hover:underline">
            ← Programs
          </Link>
        }
        title="Review drafts"
        subtitle={`${groupInr(drafts)} draft${drafts === 1 ? "" : "s"}${from} at ${groupInr(universities)} universit${universities === 1 ? "y" : "ies"}. Open one to check its courses and publish the ones that are ready.`}
      />
      <div className="space-y-4" data-review-list>
        <Card className="p-4">
          <form className="grid gap-2.5 sm:grid-cols-5 [&>*]:min-w-0">
            <Input name="q" placeholder="University name" aria-label="University name" defaultValue={f.q} className="sm:col-span-2" />
            <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
              <option value="">Any country</option>
              {countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
            </Select>
            <Select name="source" aria-label="Source" defaultValue={f.source ?? ""}>
              <option value="">Any source</option>
              <option value="MIOC">MIOC app</option>
              <option value="CRICOS">CRICOS register</option>
            </Select>
            <div className="flex gap-2">
              <Select name="sort" aria-label="Order" defaultValue={f.sort}>
                <option value="drafts">Most drafts first</option>
                <option value="name">By name</option>
              </Select>
              <Button type="submit">Filter</Button>
            </div>
          </form>
        </Card>
        <Card>
          {rows.length === 0 ? (
            narrowed || f.page > 1 ? (
              <EmptyState title="No universities with drafts match these filters" action={<LinkButton href="/admin/programs/review" variant="secondary" size="sm">Clear the filters</LinkButton>}>
                Clear a filter to see more.
              </EmptyState>
            ) : (
              <EmptyState title="No drafts to review">Every course in the catalogue is live or archived.</EmptyState>
            )
          ) : (
            <Table tableClassName="min-w-[900px]">
              <thead>
                <tr>
                  <Th>University</Th>
                  <Th>Country</Th>
                  <Th className="text-right">Drafts</Th>
                  <Th>With yearly fee</Th>
                  <Th>With IELTS</Th>
                  <Th>With intakes</Th>
                  <Th className="text-right">Live already</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-review-university={r.id}>
                    <Td>
                      <Link prefetch={false} href={`/admin/programs/review/${r.id}${reviewQuery(f)}`} className="font-medium hover:text-brand-700 hover:underline">
                        {r.name}
                      </Link>
                    </Td>
                    <Td>{r.country}</Td>
                    <Td className="text-right tabular font-medium">
                      <span data-col="drafts" data-count={r.drafts}>{groupInr(r.drafts)}</span>
                    </Td>
                    <Recorded col="fee" n={r.withFee} of={r.drafts} />
                    <Recorded col="ielts" n={r.withIelts} of={r.drafts} />
                    <Recorded col="intakes" n={r.withIntakes} of={r.drafts} />
                    <Td className="text-right tabular">
                      <span data-col="live" data-count={r.live}>{groupInr(r.live)}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {(f.page > 1 || f.page < lastPage) && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <span className="text-sm text-muted">
                {rows.length ? `Universities ${groupInr((f.page - 1) * LIST_PAGE + 1)} to ${groupInr((f.page - 1) * LIST_PAGE + rows.length)} of ${groupInr(universities)}` : `Page ${f.page} is past the end`}
              </span>
              <div className="flex gap-2">
                {f.page > 1 && (
                  <LinkButton variant="secondary" size="sm" href={`/admin/programs/review${reviewQuery(f, { page: Math.min(f.page - 1, lastPage) })}`}>
                    Previous
                  </LinkButton>
                )}
                {f.page < lastPage && (
                  <LinkButton variant="secondary" size="sm" href={`/admin/programs/review${reviewQuery(f, { page: f.page + 1 })}`}>
                    Next
                  </LinkButton>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
