import Link from "next/link";
import { and, asc, count, desc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { LEVEL_LABEL } from "@/lib/catalogue";
import { rankLabels } from "@/lib/rankings";
import { readFilters } from "@/server/queries";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th, Toolbar } from "@/components/ui";
import { IconBuilding, IconSearch } from "@/components/icons";

export const metadata = { title: "Universities" };

const PAGE = 50;
const LEVELS = ["UG", "PG", "PG_DIPLOMA", "UG_DIPLOMA", "PHD", "CERTIFICATE", "VOCATIONAL", "REGISTRATION"] as const;

/**
 * Every institution with at least one live program, so a partner can start
 * from a university a student has already named. Counts are of live programs
 * only; drafts never show here.
 */
export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser([...APP_ROLES]);
  const f = readFilters(await searchParams) as Record<string, string>;
  const page = Math.max(1, Number(f.page ?? 1) || 1);
  const { programs: p, universities: u, countries: c } = schema;

  const programConds: SQL[] = [eq(p.status, "LIVE")];
  if (f.level && (LEVELS as readonly string[]).includes(f.level)) programConds.push(sql`${p.level} = ${f.level}::study_level`);
  const conds: (SQL | undefined)[] = [];
  if (f.q) conds.push(ilike(u.name, `%${f.q}%`));
  if (f.country) conds.push(eq(c.code, f.country));
  if (f.type === "public") conds.push(eq(u.isPublic, true));
  if (f.type === "private") conds.push(eq(u.isPublic, false));
  if (["200", "500", "1000"].includes(f.top)) conds.push(sql`${u.rankSort} <= ${Number(f.top)}`);
  if (f.scholarship) conds.push(sql`exists (select 1 from scholarships sc where sc.university_id = ${u.id} and sc.active and (sc.deadline is null or sc.deadline >= current_date))`);

  const live = count(p.id);
  const rows = await db
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
      programs: live,
      eligible: sql<number>`count(*) filter (where ${p.workRights} = 'ELIGIBLE')`.mapWith(Number),
      levels: sql<string[]>`array_agg(distinct ${p.level}::text)`,
      scholarships: sql<number>`(select count(*) from scholarships sc where sc.university_id = ${u.id} and sc.active and (sc.deadline is null or sc.deadline >= current_date))`.mapWith(Number),
    })
    .from(u)
    .innerJoin(c, eq(u.countryId, c.id))
    .innerJoin(p, and(eq(p.universityId, u.id), ...programConds))
    .where(and(...conds))
    .groupBy(u.id, c.name)
    .orderBy(...(f.sort === "programs" ? [desc(live), asc(u.name)] : f.sort === "rank" ? [sql`${u.rankSort} asc nulls last`, asc(u.name)] : [asc(c.name), asc(u.name)]))
    .limit(PAGE + 1)
    .offset((page - 1) * PAGE);
  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);

  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${u.id})`.mapWith(Number) })
    .from(u)
    .innerJoin(c, eq(u.countryId, c.id))
    .innerJoin(p, and(eq(p.universityId, u.id), ...programConds))
    .where(and(...conds));
  const countries = await db
    .select({ code: c.code, name: c.name })
    .from(c)
    .where(sql`exists (select 1 from ${u} join ${p} on ${p.universityId} = ${u.id} and ${p.status} = 'LIVE' where ${u.countryId} = ${c.id})`)
    .orderBy(asc(c.name));

  const qs = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) sp.set(k, v);
    return `/universities?${sp}`;
  };

  return (
    <>
      <PageHeader title="Universities" subtitle={`${total.toLocaleString("en-IN")} institution${total === 1 ? "" : "s"} with live programs${f.level ? ` at ${LEVEL_LABEL[f.level] ?? f.level} level` : ""}`} />
      <Toolbar>
        <form className="grid w-full gap-2.5 sm:grid-cols-2 xl:grid-cols-6 [&>*]:min-w-0">
          <div className="relative sm:col-span-2">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
            <Input name="q" defaultValue={f.q} placeholder="University name" aria-label="University name" className="pl-10" />
          </div>
          <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
            <option value="">All destinations</option>
            {countries.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}
          </Select>
          <Select name="level" aria-label="Level" defaultValue={f.level ?? ""}>
            <option value="">Any level</option>
            {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l] ?? l}</option>)}
          </Select>
          <Select name="type" aria-label="Type" defaultValue={f.type ?? ""}>
            <option value="">Public and private</option>
            <option value="public">Public only</option>
            <option value="private">Private only</option>
          </Select>
          <Select name="sort" aria-label="Sort" defaultValue={f.sort ?? ""}>
            <option value="">Sort by country and name</option>
            <option value="programs">Most programs first</option>
            <option value="rank">Best ranking first</option>
          </Select>
          <Select name="top" aria-label="Ranking" defaultValue={f.top ?? ""}>
            <option value="">Any ranking</option>
            <option value="200">Top 200 (QS or THE)</option>
            <option value="500">Top 500</option>
            <option value="1000">Top 1,000</option>
          </Select>
          <label className="flex items-center gap-2 text-[13px] text-ink-soft sm:col-span-2">
            <input type="checkbox" name="scholarship" value="1" defaultChecked={!!f.scholarship} className="size-4 accent-brand-600" />
            Has an open scholarship
          </label>
          <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-4">
            <LinkButton href="/universities" variant="quiet" size="sm">Clear all</LinkButton>
            <Button type="submit" size="sm">Search</Button>
          </div>
        </form>
      </Toolbar>

      <Card>
        {list.length === 0 ? (
          <EmptyState icon={<IconBuilding />} title="No universities match these filters">Try another destination or level.</EmptyState>
        ) : (
          <Table tableClassName="min-w-[860px]">
            <thead>
              <tr><Th>University</Th><Th>Destination</Th><Th>Live programs</Th><Th>Levels</Th><Th>Post-study work confirmed</Th><Th><span className="sr-only">Programs</span></Th></tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/60">
                  <Td>
                    <Link prefetch={false} href={`/universities/${r.id}${f.level ? `?level=${f.level}` : ""}`} className="font-medium text-ink hover:text-brand-700 hover:underline">{r.name}</Link>
                    <p className="text-xs text-muted">
                      {r.isPublic ? "Public" : "Private"}
                      {rankLabels(r).length > 0 && <span className="font-medium text-ink-soft"> · {rankLabels(r).join(" · ")}</span>}
                      {r.scholarships > 0 && <Chip tone="ok" className="ml-1.5">Scholarship</Chip>}
                    </p>
                  </Td>
                  <Td className="text-[13px]">{r.city ? `${r.city}, ` : ""}{r.country}</Td>
                  <Td className="tabular">{r.programs.toLocaleString("en-IN")}</Td>
                  <Td className="text-[13px] text-ink-soft">{LEVELS.filter((l) => r.levels.includes(l)).map((l) => LEVEL_LABEL[l] ?? l).join(", ")}</Td>
                  <Td className="tabular">{r.eligible ? r.eligible.toLocaleString("en-IN") : <span className="text-muted">None confirmed</span>}</Td>
                  <Td className="text-right">
                    <Link prefetch={false} href={`/search?${new URLSearchParams({ q: r.name, ...(f.level ? { level: f.level } : {}) })}`} className="whitespace-nowrap text-[13px] font-medium text-brand-600 hover:underline">
                      Search its programs
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {(page > 1 || hasNext) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px]">
            <span className="text-muted">Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span>
            <div className="flex gap-2">
              {page > 1 && <LinkButton prefetch={false} variant="secondary" size="sm" href={qs({ page: String(page - 1) })}>Previous</LinkButton>}
              {hasNext && <LinkButton prefetch={false} variant="secondary" size="sm" href={qs({ page: String(page + 1) })}>Next</LinkButton>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
