import Link from "next/link";
import { PRIORITY_LABEL } from "@/lib/priority";
import { DEADLINE_LABEL, DEADLINE_TYPES } from "@/lib/deadline-types";
import { daysUntil } from "@/lib/catalogue";
import { asc, desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { ViewTabs } from "@/components/view-tabs";
import { viewsWithPins } from "@/server/views";
import { fmtDate, fullName, intakeLabel, MONTHS } from "@/lib/format";
import { APP_ROLES, canAssignDesk, isStaff } from "@/lib/permissions";
import { applicationScope, applicationsBase, applicationWhere, orgUsers, readFilters } from "@/server/queries";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge, Table, Td, Th, cn } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { OwnFilesNote } from "@/components/own-files-note";
import { IconApplications, IconExport } from "@/components/icons";
import { InlineSelect } from "@/components/inline-select";
import { UNASSIGNED, unassignedText } from "@/lib/unassigned-files";
import { deskOfficers } from "@/server/documentation";
import { unassignedFileCount } from "@/server/unassigned-files";
import { assignOfficerAction } from "../admin/queue/actions";

export const metadata = { title: "Applications" };

const KPI_LABEL: Record<string, string> = {
  offers: "Offers", payments: "Payments", visa_received: "Visa received", visa_rejected: "Visa rejected",
  non_enrolment: "Non-enrolment", deferrals: "Deferrals", pending_partner: "Pending from partner",
};
const PAGE = 50;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  // The saved ways of looking at this list, each with what it holds now.
  const savedViews = await viewsWithPins(user, "APPLICATIONS");
  const f = readFilters(await searchParams);
  // A filtered search that finds nothing needs a different answer from an empty list.
  const filtered = Object.values(f as Record<string, string>).some(Boolean);
  const page = Math.max(1, Number((f as Record<string, string>).page ?? 1));
  const where = applicationWhere(user, f, await applicationScope(user, f));
  const staff = isStaff(user);

  const rows = await applicationsBase().where(where).orderBy(...(f.sort === "priority" ? [asc(schema.applications.priority), desc(schema.applications.createdAt)] : [desc(schema.applications.createdAt)])).limit(PAGE + 1).offset((page - 1) * PAGE);
  const hasNext = rows.length > PAGE;
  const list = rows.slice(0, PAGE);

  // The files handed to the desk with nobody on them, for whoever hands them
  // out: a tab with the count, and on it the officer is chosen in the row.
  const unassigned = await unassignedFileCount(user);
  const waitingView = unassigned !== null && f.desk === UNASSIGNED;
  const assignHere = waitingView && canAssignDesk(user);
  const [countries, statuses, counsellors, orgs, officers] = await Promise.all([
    db.select().from(schema.countries).orderBy(asc(schema.countries.name)),
    db.selectDistinctOn([schema.statusDefinitions.code], { code: schema.statusDefinitions.code, label: schema.statusDefinitions.label }).from(schema.statusDefinitions).orderBy(schema.statusDefinitions.code),
    staff ? Promise.resolve([]) : orgUsers(user.orgId),
    staff ? db.select().from(schema.organizations).where(sql`type <> 'HQ'`).orderBy(asc(schema.organizations.name)) : Promise.resolve([]),
    assignHere ? deskOfficers() : Promise.resolve([]),
  ]);
  const now = new Date();
  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];
  const exportQs = new URLSearchParams(f as Record<string, string>).toString();
  const pageQs = (p: number) => new URLSearchParams({ ...(f as Record<string, string>), page: String(p) }).toString();

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle={
          waitingView
            ? `${unassignedText(unassigned ?? 0)}. Handed to the desk by a branch and not given to anybody yet; choose the officer in the row and the file is theirs.`
            : f.kpi
              ? `Filtered: ${KPI_LABEL[f.kpi] ?? f.kpi}`
              : "Manage your students' applications"
        }
        actions={<LinkButton variant="secondary" href={`/api/applications/export?${exportQs}`} prefetch={false}><IconExport className="size-4" /> Export CSV</LinkButton>}
      />

      <OwnFilesNote of={f.of} viewer={user} />

      <ViewTabs scope="APPLICATIONS" views={savedViews} canShareWithEverybody={staff} />
      {unassigned !== null && (
        <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Whose files">
          <Link href="/applications" role="tab" aria-selected={!waitingView} className={waitingView ? "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink" : "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"}>
            Every application
          </Link>
          <Link
            href={`/applications?desk=${UNASSIGNED}`}
            role="tab"
            aria-selected={waitingView}
            data-unassigned={unassigned}
            className={waitingView ? "rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white" : "rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-ink"}
          >
            Unassigned ({unassigned})
          </Link>
        </div>
      )}
      <FilterBar
        primary={4}
        // One person's own files is where you are, not what you asked, so
        // "Clear all" keeps it: a dashboard's figure linked here with it.
        keep={["of", "desk"]}
        fields={[
          { kind: "search", name: "student", label: "Student", placeholder: "Student name" },
          staff
            ? { kind: "select", name: "org", label: "Partner", options: orgs.map((o) => ({ value: o.id, label: o.name })) }
            : {
                kind: "select",
                name: "assignedTo",
                label: "Assigned to",
                options: counsellors.map((c) => ({ value: c.id, label: c.deskLabel ?? c.name })),
              },
          { kind: "select", name: "status", label: "Status", options: statuses.map((x) => ({ value: x.code, label: x.label })) },
          { kind: "select", name: "country", label: "Country", options: countries.map((c) => ({ value: c.code, label: c.name })) },
          {
            kind: "select",
            name: "pathway",
            label: "Pathway",
            options: [
              { value: "DEGREE", label: "Study abroad" },
              { value: "AUSBILDUNG", label: "Ausbildung" },
              { value: "NURSING", label: "Nurse registration" },
              { value: "FSJ", label: "FSJ (Germany)" },
              { value: "BFD", label: "BFD (Germany)" },
              { value: "NCLEX", label: "NCLEX-RN" },
              { value: "WEITERBILDUNG", label: "Weiterbildung" },
              { value: "CCM", label: "CCM" },
              { value: "AU_PAIR", label: "Au pair" },
            ],
          },
          { kind: "select", name: "priority", label: "Priority", options: Object.entries(PRIORITY_LABEL).map(([k, v]) => ({ value: k, label: v })) },
          { kind: "select", name: "intakeMonth", label: "Intake month", options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
          { kind: "select", name: "intakeYear", label: "Intake year", options: years.map((y) => ({ value: String(y), label: String(y) })) },
          { kind: "search", name: "university", label: "University", placeholder: "University" },
          { kind: "search", name: "program", label: "Program", placeholder: "Program name" },
          { kind: "search", name: "ack", label: "Acknowledgement", placeholder: "Acknowledgement no." },
          { kind: "date", name: "from", label: "Created from" },
          { kind: "date", name: "to", label: "Created to" },
          { kind: "select", name: "dlType", label: "Deadline type", options: DEADLINE_TYPES.map((t) => ({ value: t, label: DEADLINE_LABEL[t] })) },
          { kind: "date", name: "dlFrom", label: "Due from" },
          { kind: "date", name: "dlTo", label: "Due to" },
          {
            kind: "select",
            name: "sort",
            label: "Order",
            options: [{ value: "priority", label: "High priority first" }],
          },
        ]}
      />

      <Card>
        {list.length === 0 ? (
          <EmptyState
            title={filtered ? "No applications match these filters" : "No applications yet"}
            icon={<IconApplications />}
            action={filtered ? <LinkButton variant="secondary" href="/applications">Clear the filters</LinkButton> : undefined}
          >
            {filtered
              ? "Try clearing a filter, or widen the date range."
              : "An application appears here as soon as a student is matched to a program."}
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[1140px]">
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
                    <Td><Link href={`/students/${r.studentId}/applications?app=${r.id}`} className="ack font-medium text-brand-700 hover:underline">{r.ackNo}</Link>{r.priority === "HIGH" && <span className="block text-xs font-medium text-stop-700">High priority</span>}{r.priority === "LOW" && <span className="block text-xs text-muted">Low priority</span>}</Td>
                    <Td className="whitespace-nowrap tabular">{fmtDate(r.createdAt)}</Td>
                    <Td>{fullName(r)}</Td>
                    <Td>{r.universityName}<p className="text-xs text-muted">{r.countryName}</p></Td>
                    <Td className="max-w-64">{r.programName}</Td>
                    <Td className="whitespace-nowrap">
                      {intakeLabel(r.intakeMonth, r.intakeYear)}
                      {r.nextDue && <span className={cn("block text-xs", daysUntil(r.nextDue) <= 3 ? "font-medium text-stop-700" : "text-muted")}>{daysUntil(r.nextDue) === 0 ? "Due today" : `Due in ${daysUntil(r.nextDue)}d`}</span>}
                      {r.deadline && <p className={overdue ? "text-xs text-muted line-through" : "text-xs text-stop-500"}>⏱ {fmtDate(r.deadline)}</p>}
                    </Td>
                    <Td>{r.createdByName ?? r.createdByFallback}</Td>
                    <Td><StatusBadge group={r.statusGroup} label={r.statusLabel} /></Td>
                    {assignHere ? (
                      <Td className="whitespace-nowrap">
                        <InlineSelect action={assignOfficerAction} idName="applicationId" id={r.id} name="officerId" value={r.officerId ?? ""} label={`Officer for ${r.ackNo}`} className="w-44 py-1 text-xs">
                          <option value="">Nobody yet</option>
                          {officers.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.id === user.id ? "Me" : (o.deskLabel ?? o.name)}
                            </option>
                          ))}
                        </InlineSelect>
                      </Td>
                    ) : (
                      <Td className="whitespace-nowrap">{r.officerName ?? <span className="text-muted">Unassigned</span>}{r.officerPhone && <p className="text-xs text-muted tabular">{r.officerPhone}</p>}</Td>
                    )}
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
