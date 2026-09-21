import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { durationText, feeText, intakesText, LEVEL_LABEL } from "@/lib/catalogue";
import { APP_ROLES, isStaff } from "@/lib/permissions";
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

  const university = await db.query.universities.findFirst({ where: eq(schema.universities.id, id), with: { country: true } });
  if (!university) notFound();

  const all = await db.query.programs.findMany({
    where: and(eq(schema.programs.universityId, university.id), isStaff(user) ? undefined : eq(schema.programs.status, "LIVE")),
    orderBy: asc(schema.programs.name),
  });
  // A university with nothing open is not somewhere a partner can send anyone.
  if (!all.length && !isStaff(user)) notFound();

  const live = all.filter((p) => p.status === "LIVE");
  const levels = LEVEL_ORDER.filter((l) => all.some((p) => p.level === l));
  const shown = levelFilter ? all.filter((p) => p.level === levelFilter) : all;
  const cur = university.country.currency;
  const tuitions = live.map((p) => p.tuitionPerYear).filter((t): t is number => t != null && t > 0);
  const eligible = live.filter((p) => p.workRights === "ELIGIBLE").length;
  const ineligible = live.filter((p) => p.workRights === "INELIGIBLE").length;
  const intakes = [...new Set(live.flatMap((p) => p.intakeMonths))].sort((a, b) => a - b);
  const campuses = [...new Set(all.map((p) => p.campus).filter((c): c is string => !!c))].sort();
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
        subtitle={`${multiCampus ? `Campuses in ${campuses.join(", ")} · ` : university.city ? `${university.city}, ` : ""}${university.country.name}${university.isPublic ? " · Public institution" : ""}`}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Programs"
            subtitle={`${shown.length} of ${all.length}${isStaff(user) && all.length !== live.length ? ` (${all.length - live.length} not live)` : ""}`}
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
                <tr><Th>Program</Th><Th>Duration</Th><Th>Intakes</Th><Th>Tuition / yr</Th><Th>Post-study work</Th></tr>
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
                    <Td className={cn("whitespace-nowrap tabular text-[13px]", p.tuitionPerYear == null && "text-muted")}>
                      {feeText(p.tuitionPerYear, cur, { zero: "No tuition fee" })}
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
        </Card>

        <Card className="self-start">
          <CardHeader title="Summary" subtitle="Live programs only" />
          <DataList
            rows={[
              { label: "Live programs", value: String(live.length) },
              {
                label: "Tuition range per year",
                value: tuitions.length
                  ? tuitions.length === 1 || Math.min(...tuitions) === Math.max(...tuitions)
                    ? feeText(tuitions[0], cur, { zero: "" })
                    : `${feeText(Math.min(...tuitions), cur, { zero: "" })} to ${feeText(Math.max(...tuitions), cur, { zero: "" })}`
                  : "Not recorded",
              },
              { label: "Intakes offered", value: intakesText(intakes) },
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
