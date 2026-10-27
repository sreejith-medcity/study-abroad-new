import Link from "next/link";
import { asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { can } from "@/server/capabilities";
import { requireUser } from "@/lib/auth";
import { ViewTabs } from "@/components/view-tabs";
import { viewsWithPins } from "@/server/views";
import { APP_ROLES, ROLE_LABEL, canAssignStudents, isAdmin, isStaff } from "@/lib/permissions";
import { fmtDate, fullName } from "@/lib/format";
import { assignableFor, counsellorOptions, orgUsers, readFilters, studentListExtras, studentWhere } from "@/server/queries";
import { programmesSummary } from "@/lib/student-list";
import { CountryNames } from "./country-names";
import { livingTeams, peopleOnFiles, teamsOf } from "@/server/teams";
import { Card, Chip, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { OwnFilesNote } from "@/components/own-files-note";
import { IconMail, IconPhone, IconPlus, IconStudents } from "@/components/icons";
import { archiveStudentAction } from "./actions";
import { RowAssign } from "./row-assign";
import { RowPeople } from "./row-people";

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

  // Fifty at a time, newest first, with a link for the next fifty. The list
  // used to draw two hundred rows at once and stop there, which made a large
  // branch slow to open and hid everybody past the two hundredth.
  const PAGE = 50;
  const shown = Math.min(5000, Math.max(PAGE, Math.ceil((Number(f.show) || PAGE) / PAGE) * PAGE));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(s).where(where);

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
      teamName: sql<string | null>`(select t.name from teams t where t.id = ${s.teamId})`,
      assignedToId: s.assignedToId,
      createdByDesk: sql<string | null>`coalesce(creator.desk_label, creator.name)`,
      source: s.source,
      preferredCountry: s.preferredCountry,
      appCount: sql<number>`(select count(*)::int from applications ap where ap.student_id = ${s.id})`,
      submittedCount: sql<number>`(select count(*)::int from applications ap join status_definitions sd on sd.id = ap.status_id where ap.student_id = ${s.id} and sd.group not in ('NEW','PENDING_PARTNER','CLOSED'))`,
      pendingCount: sql<number>`(select count(*)::int from applications ap join status_definitions sd on sd.id = ap.status_id where ap.student_id = ${s.id} and sd.group = 'PENDING_PARTNER')`,
    })
    .from(s)
    .innerJoin(schema.organizations, eq(s.orgId, schema.organizations.id))
    .leftJoin(sql`users as creator`, sql`creator.id = ${s.createdById}`)
    .where(where)
    .orderBy(desc(s.createdAt), desc(s.id))
    .limit(shown);

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
  // Who shares each of these files, in one query rather than fifty.
  // Where each of these students is applying, and to what, in one more query
  // for the page rather than one for each row.
  const extras = await studentListExtras(rows.map((r) => r.id));
  // The counsellor filter is for somebody who sees more students than their
  // own. Anybody else's list already is their own files, so the filter would
  // offer them only themselves.
  const seesEvery = await can(user, "SEE_EVERY_STUDENT");
  const counsellors = seesEvery ? await counsellorOptions(user, f) : [];
  const sharedWith = canAssign ? await peopleOnFiles(rows.map((r) => r.id)) : new Map<string, { id: string; name: string; part: string }[]>();
  const countries = await db.select().from(schema.countries).orderBy(asc(schema.countries.name));
  const orgs = staff ? await db.select().from(schema.organizations).where(sql`type <> 'HQ'`).orderBy(asc(schema.organizations.name)) : [];
  const canWrite = user.role !== "MANAGEMENT";
  // The teams the Team filter offers: every live one for the head office, and
  // the ones a branch user is in, whose files from other branches appear here.
  const teamOptions = staff ? await livingTeams() : await teamsOf(user.id);
  // A file from another branch is on this list because this person is in the
  // team carrying it. They work it; its branch still runs who it belongs to.
  const elsewhere = (r: { orgId: string }) => !staff && r.orgId !== user.orgId;
  // Shown only to somebody the screen will actually let through: being offered
  // a button and then refused by it is how this was reported in the first place.
  const canRegister = await can(user, "REGISTER_STUDENT");
  // A filtered search that finds nothing needs a different answer from an empty branch.
  const filtered = Object.keys(f).some((k) => k !== "view" && k !== "show" && f[k]);
  const more = new URLSearchParams({ ...f, show: String(shown + PAGE) }).toString();

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

      <OwnFilesNote of={f.of} viewer={user} />

      <ViewTabs scope="STUDENTS" views={savedViews} canShareWithEverybody={staff} />

      <FilterBar
        primary={4}
        // One person's own files is where you are, not what you asked, so
        // "Clear all" keeps it: a dashboard's figure linked here with it.
        keep={["of"]}
        fields={[
          { kind: "search", name: "q", label: "Search", placeholder: "Name, Medcity ID, email or phone" },
          ...(staff ? [{ kind: "select" as const, name: "org", label: "Partner", options: orgs.map((o) => ({ value: o.id, label: o.name })) }] : []),
          // The counsellor a student is assigned to. The same "assignedTo"
          // the dashboard's figures link with, so a list opened from one of
          // them shows the filter that is on, and a saved view keeps it.
          ...(seesEvery
            ? [{ kind: "select" as const, name: "assignedTo", label: "Counsellor", options: [{ value: "none", label: "Unassigned" }, ...counsellors] }]
            : []),
          {
            kind: "select",
            name: "pathway",
            label: "Pathway",
            options: [
              { value: "DEGREE", label: "Degree" },
              { value: "AUSBILDUNG", label: "Ausbildung" },
              { value: "NURSING", label: "Nurse registration" },
              { value: "FSJ", label: "FSJ (Germany)" },
              { value: "BFD", label: "BFD (Germany)" },
            ],
          },
          ...(teamOptions.length
            ? [{ kind: "select" as const, name: "team", label: "Team", options: teamOptions.map((t) => ({ value: t.id, label: t.name })) }]
            : []),
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
                {/* The country has a column of its own on a wide screen; on a
                    laptop it is a line in the programmes cell instead, and on
                    a phone both fold away, where the status pill already says
                    how many applications there are. */}
                <Th className="hidden min-[1680px]:table-cell">Country</Th>
                <Th>Contact</Th>
                {canAssign && <Th>Assigned to</Th>}
                <Th className="hidden md:table-cell">Programs applied</Th>
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
                  <Td>
                    {/* Allowed to wrap at a width rather than run on: a
                        sub-agent's name like "Horizon Consultants, Thrissur"
                        was the widest thing in the row. */}
                    <span className="block max-w-[10rem]">
                      {staff || elsewhere(r) ? r.orgName : r.createdByDesk}
                      {r.source !== "partner" && <Chip className="ml-1">{r.source.toUpperCase()}</Chip>}
                    </span>
                    {(staff || elsewhere(r)) && (
                      <span className="block text-2xs text-muted">{r.createdByDesk ?? "Not recorded"}</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap tabular">{fmtDate(r.createdAt)}</Td>
                  <Td>
                    <Link href={`/students/${r.id}/profile`} className="whitespace-nowrap font-medium text-ink hover:text-brand-600 hover:underline">{fullName(r)}</Link>
                    {r.medcityId && <span className="block font-mono text-2xs text-muted">{r.medcityId}</span>}
                    {r.teamName && <span className="block text-2xs text-muted">{r.teamName} team</span>}
                  </Td>
                  <Td className="hidden min-[1680px]:table-cell">
                    <CountryNames applied={extras.get(r.id)?.countries ?? []} preferred={r.preferredCountry} className="w-[6.5rem]" />
                  </Td>
                  {/* A counsellor works this list with the phone in the other
                      hand. The address and the number were text to read out;
                      they are the thing you press now. The two are stacked in
                      one column, the way "Created by" is, so the country and
                      the programmes fit beside them on a laptop. */}
                  <Td className="text-muted">
                    <div className="w-[9.5rem] space-y-1">
                      <a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-1.5 whitespace-nowrap tabular hover:text-brand-600">
                        <IconPhone className="size-3.5 shrink-0 text-muted/70" />
                        {r.phone}
                      </a>
                      {r.email ? (
                        <a href={`mailto:${r.email}`} className="flex items-center gap-1.5 text-sm hover:text-brand-600" title={r.email}>
                          <IconMail className="size-3.5 shrink-0 text-muted/70" />
                          <span className="truncate">{r.email}</span>
                        </a>
                      ) : (
                        <span className="block text-sm text-muted/70">No email</span>
                      )}
                    </div>
                  </Td>
                  {canAssign && elsewhere(r) && (
                    <Td className="text-xs text-muted">Team file, run by {r.orgName}</Td>
                  )}
                  {canAssign && !elsewhere(r) && (
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
                      {/* A file belongs to one counsellor; this is everybody
                          else working on it. Item six of the branches' list:
                          "options to assign to more than 2". The head office
                          is offered this student's own branch and its own
                          people, the same as the assignment above: somebody
                          from another branch cannot open the file, so they
                          are not offered for it. */}
                      <RowPeople
                        studentId={r.id}
                        ownerId={r.assignedToId ?? ""}
                        people={sharedWith.get(r.id) ?? []}
                        canAdd={staff ? [...(branchPeople.get(r.orgId) ?? []), ...headOfficePeople] : (branchPeople.get(r.orgId) ?? assignable)}
                        label={`Share ${fullName(r)} with somebody else`}
                      />
                    </Td>
                  )}
                  <Td className="hidden md:table-cell">
                    {(() => {
                      const got = extras.get(r.id);
                      const where = <CountryNames inline applied={got?.countries ?? []} preferred={r.preferredCountry} className="w-[10rem] text-2xs min-[1680px]:hidden" />;
                      if (!got) {
                        return (
                          <>
                            <span className="block whitespace-nowrap text-xs text-muted/70">None yet</span>
                            {where}
                          </>
                        );
                      }
                      const sum = programmesSummary(got.first, got.programmes);
                      return (
                        <Link
                          href={`/students/${r.id}/applications`}
                          className="group block w-[10rem] text-sm hover:text-brand-600"
                          title={sum.shown.join("\n")}
                        >
                          <span className="block text-2xs font-medium text-muted group-hover:text-brand-600">
                            {got.total} application{got.total === 1 ? "" : "s"}
                          </span>
                          {sum.shown.map((line, i) => (
                            <span key={i} className="line-clamp-2 text-xs group-hover:underline">{line}</span>
                          ))}
                          {sum.moreLabel && <span className="block text-2xs text-muted">{sum.moreLabel}</span>}
                          {where}
                        </Link>
                      );
                    })()}
                  </Td>
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
                    {canWrite && !elsewhere(r) && (user.role === "PARTNER" || isAdmin(user)) && (
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
        {rows.length > 0 && (
          <div data-list-foot className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
            <span>
              Showing <span className="tabular font-medium text-ink">{rows.length.toLocaleString("en-IN")}</span> of{" "}
              <span className="tabular font-medium text-ink">{Number(total).toLocaleString("en-IN")}</span>, newest first
            </span>
            {rows.length < Number(total) && (
              <LinkButton variant="secondary" size="sm" href={`/students?${more}`} scroll={false}>
                Show {Math.min(PAGE, Number(total) - rows.length)} more
              </LinkButton>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
