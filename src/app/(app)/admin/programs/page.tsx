import { and, asc, count, eq, ilike, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtMoney, MONTHS } from "@/lib/format";
import { readFilters } from "@/server/queries";
import { Button, Card, Chip, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { bulkStatusAction, setProgramStatusAction } from "./actions";
import { ImportForm } from "./import-form";
import { ADMIN_ROLES } from "@/lib/permissions";

export const metadata = { title: "Programs" };

const PAGE = 50;

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser([...ADMIN_ROLES]);
  const f = readFilters(await searchParams) as Record<string, string>;
  const page = Math.max(1, Number(f.page ?? 1));
  const { programs: p, universities: u, countries: c } = schema;
  const where = and(
    f.q ? or(ilike(p.name, `%${f.q}%`), ilike(u.name, `%${f.q}%`)) : undefined,
    f.country ? eq(c.code, f.country) : undefined,
    f.pathway ? eq(p.pathway, f.pathway as schema.Pathway) : undefined,
    f.status ? eq(p.status, f.status as "LIVE") : undefined,
  );
  const rows = await db
    .select({ id: p.id, name: p.name, level: p.level, pathway: p.pathway, intakeMonths: p.intakeMonths, tuition: p.tuitionPerYear, currency: c.currency, university: u.name, country: c.name, status: p.status, minIelts: p.minIelts, minPte: p.minPte, minOet: p.minOetGrade, minGerman: p.minGermanLevel, maxBacklogs: p.maxBacklogs, moi: p.moiAccepted, workRights: p.workRights, workRightsNote: p.workRightsNote, docs: p.requiredDocs })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where)
    .orderBy(asc(c.name), asc(u.name), asc(p.name))
    .limit(PAGE)
    .offset((page - 1) * PAGE);
  // The count is its own query rather than rows.length, because the list is a
  // page and the bulk control below acts on every match, not just this page.
  const [{ total }] = await db
    .select({ total: count() })
    .from(p)
    .innerJoin(u, eq(p.universityId, u.id))
    .innerJoin(c, eq(u.countryId, c.id))
    .where(where);
  const lastPage = Math.max(1, Math.ceil(total / PAGE));
  const countries = await db.select().from(c).orderBy(asc(c.name));
  const qs = (extra: Record<string, string>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) sp.set(k, v);
    return `/admin/programs?${sp}`;
  };

  return (
    <>
      <PageHeader
        title="Programs"
        subtitle={`${total} match${total === 1 ? "" : "es"}. Structured requirements drive the pre-submission check.`}
        actions={
          total > 0 ? (
            // Acts on exactly what the filters above have selected, so a country
            // or a pathway can be reviewed and published as one batch.
            <form action={bulkStatusAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="q" value={f.q ?? ""} />
              <input type="hidden" name="country" value={f.country ?? ""} />
              <input type="hidden" name="pathway" value={f.pathway ?? ""} />
              <input type="hidden" name="from" value={f.status ?? ""} />
              <span className="text-[13px] text-muted">All {total} matching:</span>
              <Button name="to" value="LIVE" size="sm" variant="secondary">Publish</Button>
              <Button name="to" value="DRAFT" size="sm" variant="quiet">Back to draft</Button>
            </form>
          ) : undefined
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card className="p-4">
            <form className="grid gap-2.5 sm:grid-cols-5 [&>*]:min-w-0">
              <input type="hidden" name="page" value="1" />
              <Input name="q" placeholder="Program or university" aria-label="Search" defaultValue={f.q} className="sm:col-span-2" />
              <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
                <option value="">Country</option>
                {countries.map((x) => <option key={x.id} value={x.code}>{x.name}</option>)}
              </Select>
              <Select name="pathway" aria-label="Pathway" defaultValue={f.pathway ?? ""}>
                <option value="">Pathway</option><option value="DEGREE">Degree</option><option value="AUSBILDUNG">Ausbildung</option><option value="NURSING">Nurse registration</option>
              </Select>
              <div className="flex gap-2">
                <Select name="status" aria-label="Status" defaultValue={f.status ?? ""}>
                  <option value="">Any status</option><option>LIVE</option><option>DRAFT</option><option>ARCHIVED</option>
                </Select>
                <Button type="submit">Filter</Button>
              </div>
            </form>
          </Card>
          <Card>
            {rows.length === 0 ? (Object.entries(f).some(([k, v]) => k !== "page" && v)
              ? <EmptyState title="No programs match these filters">Clear a filter to see more.</EmptyState>
              : <EmptyState title="No programs yet">Import a CSV to get started.</EmptyState>) : (
              <Table tableClassName="min-w-[1100px]">
                <thead><tr><Th>Program</Th><Th>University</Th><Th>Level</Th><Th>Intakes</Th><Th>Tuition / yr</Th><Th>Requirements</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <Td><p className="font-medium">{r.name}</p>{r.pathway !== "DEGREE" && <Chip tone="info">{r.pathway === "AUSBILDUNG" ? "Ausbildung" : "Nursing"}</Chip>}</Td>
                      <Td>{r.university}<p className="text-xs text-muted">{r.country}</p></Td>
                      <Td>{r.level}</Td>
                      <Td className="whitespace-nowrap">{r.intakeMonths.map((m) => MONTHS[m - 1]).join(", ")}</Td>
                      <Td className="whitespace-nowrap tabular">{r.tuition ? fmtMoney(r.tuition, r.currency) : "None"}</Td>
                      <Td>
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {r.minIelts && <Chip>IELTS {r.minIelts}</Chip>}{r.minPte && <Chip>PTE {r.minPte}</Chip>}{r.minOet && <Chip>OET {r.minOet}</Chip>}
                          {r.minGerman && <Chip>German {r.minGerman}</Chip>}{r.maxBacklogs != null && <Chip>Backlogs ≤ {r.maxBacklogs}</Chip>}{r.moi && <Chip>MOI OK</Chip>}
                          {r.workRights === "ELIGIBLE" && <Chip tone="ok">Work rights</Chip>}
                          {r.workRights === "INELIGIBLE" && <Chip tone="bad">No work rights</Chip>}
                          <Chip tone="info">{r.docs.length} docs</Chip>
                        </div>
                      </Td>
                      <Td>
                        <form action={setProgramStatusAction} className="flex gap-1">
                          <input type="hidden" name="programId" value={r.id} />
                          <Select name="status" defaultValue={r.status} aria-label={`Status of ${r.name}`} className="w-28 py-1 text-xs">
                            <option>LIVE</option><option>DRAFT</option><option>ARCHIVED</option>
                          </Select>
                          <Button variant="quiet" className="px-2 py-1 text-xs">Set</Button>
                        </form>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {(page > 1 || page < lastPage) && (
              <div className="flex items-center justify-between border-t border-line px-4 py-3">
                <span className="text-[13px] text-muted">
                  Showing {(page - 1) * PAGE + 1} to {(page - 1) * PAGE + rows.length} of {total}
                </span>
                <div className="flex gap-2">
                  {page > 1 && <LinkButton variant="secondary" size="sm" href={qs({ page: String(page - 1) })}>Previous</LinkButton>}
                  {page < lastPage && <LinkButton variant="secondary" size="sm" href={qs({ page: String(page + 1) })}>Next</LinkButton>}
                </div>
              </div>
            )}
          </Card>
        </div>
        <Card className="h-fit p-4">
          <h2 className="mb-1 font-semibold">Import programs</h2>
          <p className="mb-3 text-muted">Preview first: nothing is saved until you confirm.</p>
          <ImportForm />
        </Card>
      </div>
    </>
  );
}
