import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { can } from "@/server/capabilities";
import { requireUser } from "@/lib/auth";
import { ViewTabs } from "@/components/view-tabs";
import { viewsWithPins } from "@/server/views";
import { APP_ROLES, ROLE_LABEL, canAssignStudents, isAdmin, isStaff } from "@/lib/permissions";
import { fmtDate, fullName } from "@/lib/format";
import { assignableFor, orgUsers, readFilters, studentWhere } from "@/server/queries";
import { Card, Chip, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { IconMail, IconPhone, IconPlus, IconStudents } from "@/components/icons";
import { archiveStudentAction } from "./actions";
import { RowAssign } from "./row-assign";

export const metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  // The saved ways of looking at this list, each with what it holds now.
  const savedViews = await viewsWithPins(user, "STUDENTS");
  const f = readFilters(await searchParams) as Record<string, string>;
  const s = schema.students;
  const staff = isStaff(user);
  const archived = f.view === "archived";

  // The same rule a saved view counts with, so a tab and the list it opens
  // can never disagree.
  const where = await studentWhere(user, f);

  const rows = await db
    .select({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email,
      phone: s.phone,
      createdAt: s.createdAt,
      medcityId: s.medcityId,
      orgId: s.orgId,
      orgName: schema.organizations.name,
      assignedToId: s.assignedToId,
      createdByDesk: sql<string | null>`coalesce(creator.desk_label, creator.name)`,
      source: s.source,
      appCount: sql<number>`(select count(*)::int from applications ap where ap.student_id = ${s.id})`,
      submittedCount: sql<number>`(select count(*)::int from applications ap join status_definitions sd on sd.id = ap.status_id where ap.student_id = ${s.id} and sd.group not in ('NEW','PENDING_PARTNER','CLOSED'))`,
      pendingCount: sql<number>`(select count(*)::int from applications ap join status_definitions sd on sd.id = ap.status_id where ap.student_id = ${s.id} and sd.group = 'PENDING_PARTNER')`,
    })
    .from(s)
    .innerJoin(schema.organizations, eq(s.orgId, schema.organizations.id))
    .leftJoin(sql`users as creator`, sql`creator.id = ${s.createdById}`)
    .where(where)
    .orderBy(desc(s.createdAt))
    .limit(200);

  // Who each student can be handed to. A branch sees its own people, as before.
  // The head office sees the branch the student belongs to plus its own team,
  // because the documentation desk is where a file goes next and admins were
  // not shown this control at all until now.
  const canAssign = canAssignStudents(user);
  const assignable = canAssign
    ? staff
      ? await assignableFor([...new Set(rows.map((r) => r.orgId))], { includeHeadOffice: true })
      : (await orgUsers(user.orgId)).map((c) => ({ ...c, orgId: user.orgId, orgName: "", role: "", headOffice: false }))
    : [];
  const branchPeople = new Map<string, typeof assignable>();
  const headOfficePeople = assignable.filter((x) => x.headOffice);
  for (const person of assignable) {
    if (person.headOffice) continue;
    const got = branchPeople.get(person.orgId);
    if (got) got.push(person);
    else branchPeople.set(person.orgId, [person]);
  }
  const countries = await db.select().from(schema.countries).orderBy(asc(schema.countries.name));
  const orgs = staff ? await db.select().from(schema.organizations).where(sql`type <> 'HQ'`).orderBy(asc(schema.organizations.name)) : [];
  const canWrite = user.role !== "MANAGEMENT";
  // Shown only to somebody the screen will actually let through: being offered
  // a button and then refused by it is how this was reported in the first place.
  const canRegister = await can(user, "REGISTER_STUDENT");
  // A filtered search that finds nothing needs a different answer from an empty branch.
  const filtered = Object.keys(f).some((k) => k !== "view" && f[k]);

  // When a search finds nobody, the same search against the archive usually
  // explains why: the branch is told the email is taken and then cannot find
  // who has it, because an archived student is not in this list.
  const alsoArchived =
    !archived && (f.q || filtered)
      ? (await db
          .select({ n: sql<number>`count(*)::int` })
          .from(s)
          .where(await studentWhere(user, { ...f, view: "archived" })))[0]?.n ?? 0
      : 0;


  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Manage your students and their profiles"
        actions={
          <>
            <LinkButton variant="secondary" href={archived ? "/students" : "/students?view=archived"}>{archived ? "Active students" : "Archived students"}</LinkButton>
            {canRegister && <LinkButton href="/students/new"><IconPlus className="size-4" /> Register student</LinkButton>}
          </>
        }
      />

      <ViewTabs scope="STUDENTS" views={savedViews} canShareWithEverybody={staff} />

      <FilterBar
        primary={4}
        fields={[
          { kind: "search", name: "q", label: "Search", placeholder: "Name, Medcity ID, email or phone" },
          staff
            ? { kind: "select", name: "org", label: "Partner", options: orgs.map((o) => ({ value: o.id, label: o.name })) }
            : {
                kind: "select",
                name: "assignedTo",
                label: "Assigned to",
                options: assignable.map((c) => ({ value: c.id, label: c.deskLabel ?? c.name })),
              },
          {
            kind: "select",
            name: "pathway",
            label: "Pathway",
            options: [
              { value: "DEGREE", label: "Degree" },
              { value: "AUSBILDUNG", label: "Ausbildung" },
              { value: "NURSING", label: "Nurse registration" },
            ],
          },
          { kind: "select", name: "country", label: "Country", options: countries.map((c) => ({ value: c.name, label: c.name })) },
          { kind: "date", name: "from", label: "Created from" },
          { kind: "date", name: "to", label: "Created to" },
        ]}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconStudents />}
            title={archived ? "No archived students" : filtered ? "No students match these filters" : "No students registered yet"}
            action={
              filtered ? (
                alsoArchived > 0 ? (
                  <LinkButton variant="secondary" href={`/students?view=archived${f.q ? `&q=${encodeURIComponent(f.q)}` : ""}`}>
                    Look in the archived students
                  </LinkButton>
                ) : (
                  <LinkButton variant="secondary" href={archived ? "/students?view=archived" : "/students"}>
                    Clear the filters
                  </LinkButton>
                )
              ) : !archived && canRegister ? (
                <LinkButton href="/students/new">
                  <IconPlus className="size-4" /> Register {staff ? "a student" : "your first student"}
                </LinkButton>
              ) : undefined
            }
          >
            {archived
              ? "Students you archive are kept here, and can be brought back at any time."
              : filtered
                ? alsoArchived > 0
                  ? `Nobody here matches, but ${alsoArchived} archived student${alsoArchived === 1 ? "" : "s"} do${alsoArchived === 1 ? "es" : ""}. An archived file still holds its email and number, which is why registering them again is refused.`
                  : "Try a wider date range, or clear the filters and start again."
                : "Every student your branch registers appears here, with what each application is waiting on."}
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[920px]">
            <thead>
              <tr>
                <Th>Created by</Th>
                <Th>Created on</Th>
                <Th>Student name</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                {canAssign && <Th>Assigned to</Th>}
                <Th>Status</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-ground/40">
                  {/* The branch and the person in it who registered the
                      student, stacked in one column. They were two, and the
                      pair of them pushed the status pill off the right of the
                      screen on a laptop, which is the column somebody is
                      actually scanning for. */}
                  <Td className="whitespace-nowrap">
                    <span className="block">
                      {staff ? r.orgName : r.createdByDesk}
                      {r.source !== "partner" && <Chip className="ml-1">{r.source.toUpperCase()}</Chip>}
                    </span>
                    {staff && (
                      <span className="block text-2xs text-muted">{r.createdByDesk ?? "Not recorded"}</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap tabular">{fmtDate(r.createdAt)}</Td>
                  <Td>
                    <Link href={`/students/${r.id}/profile`} className="whitespace-nowrap font-medium text-ink hover:text-brand-600 hover:underline">{fullName(r)}</Link>
                    {r.medcityId && <span className="block font-mono text-2xs text-muted">{r.medcityId}</span>}
                  </Td>
                  {/* A counsellor works this list with the phone in the other
                      hand. The address and the number were text to read out;
                      they are the thing you press now. */}
                  <Td className="max-w-[10rem] text-muted">
                    {r.email ? (
                      <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 hover:text-brand-600" title={r.email}>
                        <IconMail className="size-3.5 shrink-0 text-muted/70" />
                        <span className="truncate">{r.email}</span>
                      </a>
                    ) : (
                      <span className="text-muted">No email</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    <a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-1.5 tabular text-muted hover:text-brand-600">
                      <IconPhone className="size-3.5 shrink-0 text-muted/70" />
                      {r.phone}
                    </a>
                  </Td>
                  {canAssign && (
                    <Td>
                      <RowAssign studentId={r.id} current={r.assignedToId ?? ""} label={`Assign ${fullName(r)}`}>
                        <option value="">Unassigned</option>
                        {staff ? (
                          <>
                            {(branchPeople.get(r.orgId) ?? []).length > 0 && (
                              <optgroup label={r.orgName}>
                                {(branchPeople.get(r.orgId) ?? []).map((c) => (
                                  <option key={c.id} value={c.id}>{c.deskLabel ?? c.name}</option>
                                ))}
                              </optgroup>
                            )}
                            {headOfficePeople.length > 0 && (
                              <optgroup label="Head office">
                                {headOfficePeople.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.deskLabel ?? c.name} ({ROLE_LABEL[c.role as keyof typeof ROLE_LABEL] ?? c.role})
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </>
                        ) : (
                          assignable.map((c) => <option key={c.id} value={c.id}>{c.deskLabel ?? c.name}</option>)
                        )}
                      </RowAssign>
                    </Td>
                  )}
                  <Td>
                    {/* Nothing in flight is the quiet answer, so it is set
                        quiet. A blue pill on every row of a new branch's list
                        reads as eight things to look at. */}
                    {r.appCount === 0 ? (
                      <span className="whitespace-nowrap text-xs text-muted/70">No applications</span>
                    ) : r.pendingCount > 0 ? (
                      <Chip tone="warn">{r.pendingCount} need action</Chip>
                    ) : r.submittedCount > 0 ? (
                      <Chip tone="ok">{r.submittedCount} app. submitted</Chip>
                    ) : (
                      <Chip>{r.appCount} app.</Chip>
                    )}
                  </Td>
                  <Td>
                    {canWrite && (user.role === "PARTNER" || isAdmin(user)) && (
                      <form action={archiveStudentAction}>
                        <input type="hidden" name="studentId" value={r.id} />
                        <button className="text-xs text-muted hover:text-stop-500" title={r.appCount === 0 ? "Delete student with no applications" : archived ? "Restore" : "Archive"}>
                          {r.appCount === 0 ? "Delete" : archived ? "Restore" : "Archive"}
                        </button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
