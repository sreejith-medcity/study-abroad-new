import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { LEVEL_LABEL, durationText, feeText, intakesText, tuitionText } from "@/lib/catalogue";
import { APP_ROLES, isStaff } from "@/lib/permissions";
import { openScholarships } from "@/server/scholarships";
import { rankLabels } from "@/lib/rankings";
import { ScholarshipList } from "@/components/scholarship-list";
import { Card, CardHeader, Chip, DataList, EmptyState, PageHeader, Table, Td, Th, cn } from "@/components/ui";
import { IconAlert, IconCheck, IconPrograms } from "@/components/icons";

export const metadata = { title: "University" };

const LEVEL_ORDER = ["PG", "PG_DIPLOMA", "UG", "UG_DIPLOMA", "PHD", "VOCATIONAL", "REGISTRATION", "SCHOOL"];

export default async function UniversityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser([...APP_ROLES]);
  const { id } = await params;
  const sp = await searchParams;
  const levelFilter = typeof sp.level === "string" ? sp.level : undefined;
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);

  const university = await db.query.universities.findFirst({ where: eq(schema.universities.id, id), with: { country: true } });
  if (!university) notFound();

  const all = await db.query.programs.findMany({
    where: and(eq(schema.programs.universityId, university.id), isStaff(user) ? undefined : eq(schema.programs.status, "LIVE")),
    orderBy: asc(schema.programs.name),
  });
  // A university with nothing open is not somewhere a partner can send anyone.
  if (!all.length && !isStaff(user)) notFound();

  const live = all.filter((p) => p.status === "LIVE");
  const scholarships = await openScholarships(university.id);
  const levels = LEVEL_ORDER.filter((l) => all.some((p) => p.level === l));
  const matching = levelFilter ? all.filter((p) => p.level === levelFilter) : all;
  const PER_PAGE = 100;
  const pages = Math.max(1, Math.ceil(matching.length / PER_PAGE));
  const shown = matching.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const pageHref = (n: number) => `/universities/${university.id}?${new URLSearchParams({ ...(levelFilter ? { level: levelFilter } : {}), page: String(n) })}`;
  const cur = university.country.currency;
  const perYear = live.map((p) => p.tuitionPerYear).filter((t): t is number => t != null && t > 0);
  const wholeCourse = live.map((p) => p.tuitionTotal).filter((t): t is number => t != null && t > 0);
  // Per-year figures where the catalogue has them; otherwise the register's whole-course ones, labelled as such.
  const [tuitions, tuitionLabel] = perYear.length ? [perYear, "Tuition range per year"] : [wholeCourse, "Tuition range, whole course"];
  const eligible = live.filter((p) => p.workRights === "ELIGIBLE").length;
  const ineligible = live.filter((p) => p.workRights === "INELIGIBLE").length;
  const intakes = [...new Set(live.flatMap((p) => p.intakeMonths))].sort((a, b) => a - b);
  const campuses = [...new Set(all.flatMap((p) => (p.campus ?? "").replace(/ and \d+ more$/, "").split(", ")).filter(Boolean))].sort();
  const multiCampus = campuses.length > 1;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/search?country=${university.country.code}`} className="text-[13px] font-medium text-brand-600 hover:underline">
            ← {university.country.name} programs
          </Link>
        }
        title={university.name}
        actions={university.website ? (
          <a href={university.website.startsWith("http") ? university.website : `https://${university.website}`} target="_blank" rel="noopener noreferrer" className="text-[13px] font-medium text-brand-600 hover:underline">
            Official website ↗
          </a>
        ) : undefined}
        subtitle={`${multiCampus ? `Campuses in ${campuses.length > 5 ? `${campuses.slice(0, 5).join(", ")} and ${campuses.length - 5} more` : campuses.join(", ")} · ` : university.city ? `${university.city}, ` : ""}${university.country.name}${university.isPublic ? " · Public institution" : ""}`}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Programs"
            subtitle={`${matching.length} of ${all.length}${isStaff(user) && all.length !== live.length ? ` (${all.length - live.length} not live)` : ""}`}
            action={
              levels.length > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  <LevelLink href={`/universities/${university.id}`} on={!levelFilter}>All</LevelLink>
                  {levels.map((l) => (
                    <LevelLink key={l} href={`/universities/${university.id}?level=${l}`} on={levelFilter === l}>
                      {LEVEL_LABEL[l] ?? l}
                    </LevelLink>
                  ))}
                </div>
              ) : undefined
            }
          />
          {shown.length === 0 ? (
            <EmptyState icon={<IconPrograms />} title="No programs at this level">Pick another level above.</EmptyState>
          ) : (
            <Table tableClassName="min-w-[760px]">
              <thead>
                <tr><Th>Program</Th><Th>Duration</Th><Th>Intakes</Th><Th>Tuition</Th><Th>Post-study work</Th></tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="hover:bg-surface-2/60">
                    <Td>
                      <Link prefetch={false} href={`/programs/${p.id}`} className="font-medium text-ink hover:text-brand-700 hover:underline">{p.name}</Link>
                      <p className="text-xs text-muted">
                        {LEVEL_LABEL[p.level] ?? p.level}{p.studyArea ? ` · ${p.studyArea}` : ""}
                        {multiCampus && p.campus && <span className="font-medium text-ink-soft"> · {p.campus} campus</span>}
                        {p.status !== "LIVE" && <Chip tone="warn" className="ml-1.5">{p.status === "DRAFT" ? "Draft" : "Archived"}</Chip>}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap text-[13px]">{durationText(p.durationMonths)}</Td>
                    <Td className="whitespace-nowrap text-[13px]">{intakesText(p.intakeMonths)}</Td>
                    <Td className={cn("whitespace-nowrap tabular text-[13px]", p.tuitionPerYear == null && p.tuitionTotal == null && "text-muted")}>
                      {tuitionText(p.tuitionPerYear, p.tuitionTotal, cur)}
                    </Td>
                    <Td>
                      {p.workRights === "ELIGIBLE" && <Chip tone="ok"><IconCheck className="size-3.5" /> Eligible</Chip>}
                      {p.workRights === "INELIGIBLE" && <Chip tone="bad"><IconAlert className="size-3.5" /> Not eligible</Chip>}
                      {p.workRights === "UNKNOWN" && <span className="text-xs text-muted">Not confirmed</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px]">
              <span className="text-muted">Page {page} of {pages}</span>
              <div className="flex gap-2">
                {page > 1 && <Link prefetch={false} href={pageHref(page - 1)} className="font-medium text-brand-600 hover:underline">Previous</Link>}
                {page < pages && <Link prefetch={false} href={pageHref(page + 1)} className="font-medium text-brand-600 hover:underline">Next</Link>}
              </div>
            </div>
          )}
        </Card>

        <div className="space-y-5 self-start">
        <Card>
          <CardHeader title="Summary" subtitle="Live programs only" />
          <DataList
            rows={[
              { label: "Live programs", value: String(live.length) },
              {
                label: tuitionLabel,
                value: tuitions.length
                  ? tuitions.length === 1 || Math.min(...tuitions) === Math.max(...tuitions)
                    ? feeText(tuitions[0], cur, { zero: "" })
                    : `${feeText(Math.min(...tuitions), cur, { zero: "" })} to ${feeText(Math.max(...tuitions), cur, { zero: "" })}`
                  : "Not recorded",
              },
              { label: "Intakes offered", value: intakesText(intakes) },
              ...(rankLabels(university).length ? [{ label: "Rankings", value: rankLabels(university).join(" · ") }] : []),
              ...(university.country.visaLivingFunds != null
                ? [{ label: "Visa living funds, first year", value: `${feeText(university.country.visaLivingFunds, cur, { zero: "" })} (${university.country.name} government figure)` }]
                : []),
              ...(multiCampus ? [{ label: "Campuses", value: campuses.join(", ") }] : []),
              { label: "Post-study work confirmed", value: String(eligible), tone: eligible ? "ok" : undefined },
              { label: "Confirmed not eligible", value: String(ineligible), tone: ineligible ? "bad" : undefined },
            ]}
          />
          {ineligible > 0 && (
            <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-muted">
              Some programs here carry no post-study work rights. Check the program before promising a student they can stay on.
            </p>
          )}
        </Card>
        <ScholarshipList rows={scholarships} />
        </div>
      </div>
    </>
  );
}

function LevelLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs font-medium",
        on ? "border-brand-600 bg-brand-600 text-white" : "border-line-strong text-ink-soft hover:border-brand-300 hover:text-brand-700",
      )}
    >
      {children}
    </Link>
  );
}
