import Link from "next/link";
import { asc, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, intakeLabel } from "@/lib/format";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import { orgUsers } from "@/server/queries";
import {
  SOURCE_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  enquiryBase,
  enquiryCounts,
  enquiryTrend,
  enquiryWhere,
  readEnquiryFilters,
  sourceMix,
  stageCounts,
} from "@/server/enquiries";
import {
  BarList,
  Button,
  Card,
  CardHeader,
  Chip,
  DataList,
  EmptyState,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Stat,
  Table,
  Td,
  Th,
  Toolbar,
  TrendChart,
} from "@/components/ui";
import { IconAlert, IconCheck, IconEnquiry, IconPlus } from "@/components/icons";

export const metadata = { title: "Enquiries" };

const PAGE = 40;

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...ADMIN_ROLES]);
  const f = readEnquiryFilters(await searchParams);
  const page = Math.max(1, Number(f.page ?? 1));
  const staff = isStaff(user);

  const [rows, counts, stages, sources, trend, people, orgs] = await Promise.all([
    enquiryBase()
      .where(enquiryWhere(user, f))
      .orderBy(sql`case when ${schema.enquiries.stage} in ('CONVERTED','LOST') then 1 else 0 end`, sql`${schema.enquiries.nextFollowUpAt} asc nulls last`, sql`${schema.enquiries.createdAt} desc`)
      .limit(PAGE + 1)
      .offset((page - 1) * PAGE),
    enquiryCounts(user),
    stageCounts(user),
    sourceMix(user),
    enquiryTrend(user, 6),
    staff ? Promise.resolve([]) : orgUsers(user.orgId),
    staff ? db.select().from(schema.organizations).where(ne(schema.organizations.type, "HQ")).orderBy(asc(schema.organizations.name)) : Promise.resolve([]),
  ]);

  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ ...(f as Record<string, string>), ...extra }).toString();
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Enquiries"
        subtitle="Every walk-in, call and message before it becomes a student file. Log the follow-up, then convert when they are ready."
        actions={
          <LinkButton href="/enquiries/new">
            <IconPlus className="size-4" /> New enquiry
          </LinkButton>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Open" tone="brand" icon={<IconEnquiry className="size-4" />} value={counts.open} href="/enquiries?stage=OPEN" />
        <Stat label="Follow up overdue" tone="stop" icon={<IconAlert className="size-4" />} value={counts.overdue} href="/enquiries?due=overdue" />
        <Stat label="Due today" tone="warn" value={counts.dueToday} href="/enquiries?due=today" />
        <Stat label="No date set" tone="info" value={counts.unscheduled} href="/enquiries?due=none" />
        <Stat label="Converted" tone="good" icon={<IconCheck className="size-4" />} value={counts.converted} href="/enquiries?stage=CONVERTED" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Toolbar>
            <form className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
              <Input name="q" placeholder="Name, number, town" aria-label="Search" defaultValue={f.q} className="xl:col-span-2" />
              <Select name="stage" aria-label="Stage" defaultValue={f.stage ?? ""}>
                <option value="">Any stage</option>
                <option value="OPEN">Open only</option>
                {Object.entries(STAGE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
              <Select name="source" aria-label="Source" defaultValue={f.source ?? ""}>
                <option value="">Any source</option>
                {Object.entries(SOURCE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
              <Select name="due" aria-label="Follow up" defaultValue={f.due ?? ""}>
                <option value="">Any follow up</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due today</option>
                <option value="none">No date set</option>
              </Select>
              {staff ? (
                <Select name="org" aria-label="Partner" defaultValue={f.org ?? ""}>
                  <option value="">All partners</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </Select>
              ) : (
                <Select name="assignedTo" aria-label="Owner" defaultValue={f.assignedTo ?? ""}>
                  <option value="">Anyone</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.deskLabel ?? p.name}</option>
                  ))}
                </Select>
              )}
              <Select name="pathway" aria-label="Pathway" defaultValue={f.pathway ?? ""}>
                <option value="">Any pathway</option>
                <option value="DEGREE">Degree</option>
                <option value="AUSBILDUNG">Ausbildung</option>
                <option value="NURSING">Nurse registration</option>
              </Select>
              <div className="flex justify-end gap-2 sm:col-span-2 xl:col-span-4">
                <LinkButton href="/enquiries" variant="quiet" size="sm">Clear</LinkButton>
                <Button type="submit" variant="secondary" size="sm">Filter</Button>
              </div>
            </form>
          </Toolbar>

          <Card>
            {list.length === 0 ? (
              <EmptyState title="No enquiries here yet" icon={<IconEnquiry className="size-5" />}>
                Log the next walk-in or call and it will show up here with its follow-up date.
              </EmptyState>
            ) : (
              <Table tableClassName="min-w-[820px]">
                <thead>
                  <tr>
                    <Th>Person</Th>
                    <Th>Interested in</Th>
                    <Th>Source</Th>
                    <Th>Owner</Th>
                    <Th>Stage</Th>
                    <Th>Next follow up</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const overdue = r.nextFollowUpAt && r.nextFollowUpAt.getTime() < now && !["CONVERTED", "LOST"].includes(r.stage);
                    return (
                      <tr key={r.id}>
                        <Td>
                          <Link href={`/enquiries/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                          <p className="text-xs text-muted tabular">{r.phone}</p>
                          {staff && <p className="text-xs text-muted">{r.orgName}</p>}
                        </Td>
                        <Td>
                          <p className="text-[13px]">{r.interestCountry ?? "Not decided"}</p>
                          <p className="text-xs text-muted">
                            {r.interestPathway === "AUSBILDUNG" ? "Ausbildung" : r.interestPathway === "NURSING" ? "Nursing" : r.interestPathway === "DEGREE" ? "Degree" : "Pathway open"}
                            {r.intakeMonth && r.intakeYear ? ` · ${intakeLabel(r.intakeMonth, r.intakeYear)}` : ""}
                          </p>
                        </Td>
                        <Td className="text-[13px]">{SOURCE_LABEL[r.source]}</Td>
                        <Td className="text-[13px]">{r.assignedToName ?? <span className="text-muted">Unassigned</span>}</Td>
                        <Td>
                          <Chip tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Chip>
                          {r.studentId && (
                            <Link href={`/students/${r.studentId}/profile`} className="mt-1 block text-xs text-brand-600 hover:underline">
                              Open student
                            </Link>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap">
                          {r.nextFollowUpAt ? (
                            <Chip tone={overdue ? "bad" : "neutral"}>{fmtDate(r.nextFollowUpAt)}</Chip>
                          ) : ["CONVERTED", "LOST"].includes(r.stage) ? (
                            <span className="text-xs text-muted">Closed {fmtDate(r.createdAt)}</span>
                          ) : (
                            <Chip tone="warn">No date</Chip>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
            {(page > 1 || hasNext) && (
              <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
                <span className="text-muted">Page {page}</span>
                <div className="flex gap-2">
                  {page > 1 && <LinkButton variant="secondary" href={`/enquiries?${qs({ page: String(page - 1) })}`}>Previous</LinkButton>}
                  {hasNext && <LinkButton variant="secondary" href={`/enquiries?${qs({ page: String(page + 1) })}`}>Next</LinkButton>}
                </div>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="By stage" subtitle="Everything on the list" />
            <BarList
              items={Object.entries(stages).map(([stage, value]) => ({
                label: STAGE_LABEL[stage as keyof typeof STAGE_LABEL],
                value,
                href: `/enquiries?stage=${stage}`,
              }))}
            />
          </Card>

          <Card>
            <CardHeader title="Where they come from" subtitle="Enquiries by source" />
            <BarList items={sources} tone="gold" empty="No enquiries yet." />
          </Card>

          <Card>
            <CardHeader title="Last six months" subtitle="Enquiries against the ones that converted" />
            <TrendChart points={trend} aLabel="Enquiries" bLabel="Converted" />
          </Card>

          <Card>
            <CardHeader title="How it ends" subtitle="Everything logged so far" />
            <DataList
              rows={[
                { label: "Enquiries logged", value: counts.total },
                { label: "Became students", value: counts.converted, tone: "ok" },
                { label: "Conversion rate", value: counts.total ? `${Math.round((counts.converted / counts.total) * 100)}%` : "0%" },
                { label: "Closed as lost", value: counts.lost, tone: counts.lost ? "warn" : undefined },
                { label: "Still open", value: counts.open },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
