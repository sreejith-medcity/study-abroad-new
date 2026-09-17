import Link from "next/link";
import { asc, desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fullName, intakeLabel, MONTHS } from "@/lib/format";
import { isStaff } from "@/lib/permissions";
import { applicationsBase, applicationWhere, orgUsers, readFilters } from "@/server/queries";
import { Button, Card, EmptyState, Input, LinkButton, PageHeader, Select, StatusBadge, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Applications" };

const KPI_LABEL: Record<string, string> = {
  offers: "Offers", payments: "Payments", visa_received: "Visa received", visa_rejected: "Visa rejected",
  non_enrolment: "Non-enrolment", deferrals: "Deferrals", pending_partner: "Pending from partner",
};
const PAGE = 50;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(["ADMIN", "MANAGEMENT", "PARTNER", "COUNSELLOR"]);
  const f = readFilters(await searchParams);
  const page = Math.max(1, Number((f as Record<string, string>).page ?? 1));
  const where = applicationWhere(user, f);
  const staff = isStaff(user);

  const rows = await applicationsBase().where(where).orderBy(desc(schema.applications.createdAt)).limit(PAGE + 1).offset((page - 1) * PAGE);
  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);

  const [countries, statuses, counsellors, orgs] = await Promise.all([
    db.select().from(schema.countries).orderBy(asc(schema.countries.name)),
    db.selectDistinctOn([schema.statusDefinitions.code], { code: schema.statusDefinitions.code, label: schema.statusDefinitions.label }).from(schema.statusDefinitions).orderBy(schema.statusDefinitions.code),
    staff ? Promise.resolve([]) : orgUsers(user.orgId),
    staff ? db.select().from(schema.organizations).where(sql`type <> 'HQ'`).orderBy(asc(schema.organizations.name)) : Promise.resolve([]),
  ]);
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  const exportQs = new URLSearchParams(f as Record<string, string>).toString();
  const pageQs = (p: number) => new URLSearchParams({ ...(f as Record<string, string>), page: String(p) }).toString();

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={f.kpi ? `Filtered: ${KPI_LABEL[f.kpi] ?? f.kpi}` : "Manage your students' applications"}
        actions={<LinkButton variant="secondary" href={`/api/applications/export?${exportQs}`} prefetch={false}>Export CSV</LinkButton>}
      />
      <Card className="mb-4 p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {f.kpi && <input type="hidden" name="kpi" value={f.kpi} />}
          {staff ? (
            <Select name="org" aria-label="Partner" defaultValue={f.org ?? ""}>
              <option value="">All partners</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          ) : (
            <Select name="assignedTo" aria-label="Assigned to" defaultValue={f.assignedTo ?? ""}>
              <option value="">Assigned to: anyone</option>
              {counsellors.map((c) => <option key={c.id} value={c.id}>{c.deskLabel ?? c.name}</option>)}
            </Select>
          )}
          <div className="flex gap-2">
            <Input type="date" name="from" aria-label="Created from" defaultValue={f.from} />
            <Input type="date" name="to" aria-label="Created to" defaultValue={f.to} />
          </div>
          <Select name="country" aria-label="Country" defaultValue={f.country ?? ""}>
            <option value="">Country</option>
            {countries.map((c) => <option key={c.id} value={c.code}>{c.name}</option>)}
          </Select>
          <Input name="university" placeholder="University" aria-label="University" defaultValue={f.university} />
          <div className="flex gap-2">
            <Select name="intakeMonth" aria-label="Intake month" defaultValue={f.intakeMonth ?? ""}>
              <option value="">Intake</option>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
            <Select name="intakeYear" aria-label="Intake year" defaultValue={f.intakeYear ?? ""}>
              <option value="">Year</option>
              {years.map((y) => <option key={y}>{y}</option>)}
            </Select>
          </div>
          <Select name="status" aria-label="Status" defaultValue={f.status ?? ""}>
            <option value="">Status</option>
            {statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
          </Select>
          <Select name="pathway" aria-label="Pathway" defaultValue={f.pathway ?? ""}>
            <option value="">Pathway</option>
            <option value="DEGREE">Degree</option>
            <option value="AUSBILDUNG">Ausbildung</option>
            <option value="NURSING">Nurse registration</option>
          </Select>
          <Input name="ack" placeholder="Acknowledgement no." aria-label="Acknowledgement number" defaultValue={f.ack} />
          <Input name="program" placeholder="Program name" aria-label="Program" defaultValue={f.program} />
          <Input name="student" placeholder="Student name" aria-label="Student" defaultValue={f.student} />
          <div className="flex gap-2 lg:col-span-5">
            <Button type="submit">Search</Button>
            <LinkButton variant="ghost" href="/applications">Clear all</LinkButton>
          </div>
        </form>
      </Card>

      <Card>
        {list.length === 0 ? (
          <EmptyState title="No applications match these filters" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ack. no.</Th><Th>Date created</Th><Th>Student</Th><Th>University</Th><Th>Program</Th><Th>Intake</Th>
                <Th>{staff ? "Partner" : "Created by"}</Th><Th>Status</Th><Th>Medcity officer</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const overdue = r.deadline && r.deadline < now;
                return (
                  <tr key={r.id} className="hover:bg-ground/40">
                    <Td><Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="font-medium underline decoration-line underline-offset-2 hover:text-brand-600 tabular whitespace-nowrap">{r.ackNo}</Link></Td>
                    <Td className="whitespace-nowrap tabular">{fmtDate(r.createdAt)}</Td>
                    <Td>{fullName(r)}</Td>
                    <Td>{r.universityName}<p className="text-xs text-muted">{r.countryName}</p></Td>
                    <Td className="max-w-64">{r.programName}</Td>
                    <Td className="whitespace-nowrap">
                      {intakeLabel(r.intakeMonth, r.intakeYear)}
                      {r.deadline && <p className={overdue ? "text-xs text-muted line-through" : "text-xs text-red-600"}>⏱ {fmtDate(r.deadline)}</p>}
                    </Td>
                    <Td>{r.createdByName ?? r.createdByFallback}</Td>
                    <Td><StatusBadge group={r.statusGroup} label={r.statusLabel} /></Td>
                    <Td className="whitespace-nowrap">{r.officerName ?? <span className="text-muted">Unassigned</span>}{r.officerPhone && <p className="text-xs text-muted tabular">{r.officerPhone}</p>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {(page > 1 || hasNext) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-muted">Page {page}</span>
            <div className="flex gap-2">
              {page > 1 && <LinkButton variant="secondary" href={`/applications?${pageQs(page - 1)}`}>Previous</LinkButton>}
              {hasNext && <LinkButton variant="secondary" href={`/applications?${pageQs(page + 1)}`}>Next</LinkButton>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
