import Link from "next/link";
import { asc, desc, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { LEVEL_LABEL } from "@/lib/catalogue";
import { fmtDate } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/permissions";
import { Button, Card, CardHeader, Chip, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { deleteScholarshipAction, setScholarshipActiveAction } from "./actions";
import { ScholarshipForm } from "./form";

export const metadata = { title: "Scholarships" };

export default async function ScholarshipsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser([...ADMIN_ROLES]);
  const { q } = await searchParams;
  const s = schema.scholarships;
  const u = schema.universities;
  const [rows, universities] = await Promise.all([
    db
      .select({ id: s.id, name: s.name, amount: s.amount, levels: s.levels, deadline: s.deadline, url: s.url, active: s.active, eligibility: s.eligibility, university: u.name, universityId: u.id, country: schema.countries.name })
      .from(s)
      .innerJoin(u, eq(s.universityId, u.id))
      .innerJoin(schema.countries, eq(u.countryId, schema.countries.id))
      .where(q ? or(ilike(s.name, `%${q}%`), ilike(u.name, `%${q}%`)) : undefined)
      .orderBy(desc(s.active), asc(u.name), asc(s.name))
      .limit(500),
    db.select({ name: u.name }).from(u).orderBy(asc(u.name)),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Scholarships" subtitle="Verified on each institution's own page. They show on the university and program pages, and in search." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader
            title={`${rows.length} scholarship${rows.length === 1 ? "" : "s"}`}
            action={
              <form className="flex gap-2">
                <Input name="q" defaultValue={q} placeholder="Scholarship or university" aria-label="Search scholarships" />
                <Button type="submit" size="sm" variant="secondary">Search</Button>
              </form>
            }
          />
          {rows.length === 0 ? (
            <EmptyState title={q ? "Nothing matches" : "No scholarships yet"}>Add the first one with the form. Every entry needs the university&apos;s own page for it.</EmptyState>
          ) : (
            <Table tableClassName="min-w-[900px]">
              <thead><tr><Th>Scholarship</Th><Th>University</Th><Th>Amount</Th><Th>Levels</Th><Th>Deadline</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const expired = r.deadline != null && r.deadline < today;
                  return (
                    <tr key={r.id} className={r.active && !expired ? "" : "opacity-60"}>
                      <Td>
                        <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-brand-700 hover:underline">{r.name} ↗</a>
                        {r.eligibility && <p className="text-xs text-muted">{r.eligibility}</p>}
                      </Td>
                      <Td><Link prefetch={false} href={`/universities/${r.universityId}`} className="hover:underline">{r.university}</Link><p className="text-xs text-muted">{r.country}</p></Td>
                      <Td className="text-[13px]">{r.amount}</Td>
                      <Td className="text-xs">{r.levels.length ? r.levels.map((l) => LEVEL_LABEL[l] ?? l).join(", ") : "All levels"}</Td>
                      <Td className="whitespace-nowrap text-[13px]">
                        {r.deadline ? fmtDate(r.deadline) : "Open"}
                        {expired && <Chip tone="warn" className="ml-1">Passed</Chip>}
                        {!r.active && <Chip className="ml-1">Paused</Chip>}
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <form action={setScholarshipActiveAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="active" value={r.active ? "false" : "true"} />
                            <Button type="submit" size="sm" variant="quiet">{r.active ? "Pause" : "Resume"}</Button>
                          </form>
                          <form action={deleteScholarshipAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <Button type="submit" size="sm" variant="quiet">Delete</Button>
                          </form>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">Add a scholarship</h2>
          <ScholarshipForm universities={universities.map((x) => x.name)} />
        </Card>
      </div>
    </>
  );
}
