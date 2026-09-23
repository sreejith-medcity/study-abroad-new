import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { APP_ROLES, isAdmin, isStaff } from "@/lib/permissions";
import { fmtDate, fullName } from "@/lib/format";
import { orgUsers, readFilters } from "@/server/queries";
import { Button, Card, Chip, EmptyState, DateInput, Input, LinkButton, PageHeader, Select, Table, Td, Th, Toolbar } from "@/components/ui";
import { IconPlus, IconStudents } from "@/components/icons";
import { archiveStudentAction, reassignStudentAction } from "./actions";

export const metadata = { title: "Students" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...APP_ROLES]);
  const f = readFilters(await searchParams) as Record<string, string>;
  const s = schema.students;
  const staff = isStaff(user);
  const archived = f.view === "archived";

  const conds = [
    staff ? (f.org ? eq(s.orgId, f.org) : undefined) : eq(s.orgId, user.orgId),
    eq(s.archived, archived),
    f.assignedTo ? eq(s.assignedToId, f.assignedTo) : undefined,
    f.from ? gte(s.createdAt, new Date(f.from)) : undefined,
    f.to ? lte(s.createdAt, new Date(`${f.to}T23:59:59`)) : undefined,
    f.country ? eq(s.preferredCountry, f.country) : undefined,
    f.pathway ? eq(s.preferredPathway, f.pathway as schema.Pathway) : undefined,
    f.q
      ? or(ilike(sql`${s.firstName} || ' ' || ${s.lastName}`, `%${f.q}%`), ilike(s.email, `%${f.q}%`), ilike(s.phone, `%${f.q}%`))
      : undefined,
  ];

  const rows = await db
    .select({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email,
      phone: s.phone,
      createdAt: s.createdAt,
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
    .where(and(...conds))
    .orderBy(desc(s.createdAt))
    .limit(200);

  const counsellors = staff ? [] : await orgUsers(user.orgId);
  const countries = await db.select().from(schema.countries).orderBy(asc(schema.countries.name));
  const orgs = staff ? await db.select().from(schema.organizations).where(sql`type <> 'HQ'`).orderBy(asc(schema.organizations.name)) : [];
  const canWrite = user.role !== "MANAGEMENT";
  // A filtered search that finds nothing needs a different answer from an empty branch.
  const filtered = Object.keys(f).some((k) => k !== "view" && f[k]);

  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Manage your students and their profiles"
        actions={
          <>
            <LinkButton variant="secondary" href={archived ? "/students" : "/students?view=archived"}>{archived ? "Active students" : "Archived students"}</LinkButton>
            {canWrite && !staff && <LinkButton href="/students/new"><IconPlus className="size-4" /> Register student</LinkButton>}
          </>
        }
      />

      <Toolbar className="mb-4">
        <form className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6 [&>*]:min-w-0">
          {archived && <input type="hidden" name="view" value="archived" />}
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
          <DateInput label="Created from" name="from" defaultValue={f.from} />
          <DateInput label="Created to" name="to" defaultValue={f.to} />
          <Select name="country" aria-label="Preferred country" defaultValue={f.country ?? ""}>
            <option value="">Country</option>
            {countries.map((c) => <option key={c.id}>{c.name}</option>)}
          </Select>
          <Select name="pathway" aria-label="Pathway" defaultValue={f.pathway ?? ""}>
            <option value="">Pathway</option>
            <option value="DEGREE">Degree</option>
            <option value="AUSBILDUNG">Ausbildung</option>
            <option value="NURSING">Nurse registration</option>
          </Select>
          <div className="flex gap-2">
            <Input name="q" placeholder="Name, email or phone" aria-label="Search" defaultValue={f.q} />
            <Button type="submit">Search</Button>
          </div>
        </form>
      </Toolbar>

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconStudents />}
            title={archived ? "No archived students" : filtered ? "No students match these filters" : "No students registered yet"}
            action={
              filtered ? (
                <LinkButton variant="secondary" href={archived ? "/students?view=archived" : "/students"}>
                  Clear the filters
                </LinkButton>
              ) : !archived && canWrite && !staff ? (
                <LinkButton href="/students/new">
                  <IconPlus className="size-4" /> Register your first student
                </LinkButton>
              ) : undefined
            }
          >
            {archived
              ? "Students you archive are kept here, and can be brought back at any time."
              : filtered
                ? "Try a wider date range, or clear the filters and start again."
                : "Every student your branch registers appears here, with what each application is waiting on."}
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[980px]">
            <thead>
              <tr>
                <Th>{staff ? "Partner" : "Created by"}</Th>
                <Th>Created on</Th>
                <Th>Student name</Th>
                <Th>Email</Th>
                <Th>Phone</Th>
                {!staff && <Th>Assigned to</Th>}
                <Th>Status</Th>
                <Th><span className="sr-only">Actions</span></Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-ground/40">
                  <Td>{staff ? r.orgName : r.createdByDesk}{r.source !== "partner" && <Chip className="ml-1">{r.source.toUpperCase()}</Chip>}</Td>
                  <Td className="whitespace-nowrap tabular">{fmtDate(r.createdAt)}</Td>
                  <Td><Link href={`/students/${r.id}/profile`} className="font-medium text-ink hover:text-brand-600 hover:underline">{fullName(r)}</Link></Td>
                  <Td className="max-w-[16rem] truncate text-muted" title={r.email ?? undefined}>{r.email ?? <span className="text-muted">No email</span>}</Td>
                  <Td className="whitespace-nowrap tabular">{r.phone}</Td>
                  {!staff && (
                    <Td>
                      <form action={reassignStudentAction} className="flex gap-1">
                        <input type="hidden" name="studentId" value={r.id} />
                        <Select name="assignedToId" defaultValue={r.assignedToId ?? ""} aria-label={`Assign ${fullName(r)}`} className="min-w-36 py-1.5">
                          <option value="">Unassigned</option>
                          {counsellors.map((c) => <option key={c.id} value={c.id}>{c.deskLabel ?? c.name}</option>)}
                        </Select>
                        <Button variant="quiet" className="px-2 py-1" type="submit" aria-label="Save assignment">Save</Button>
                      </form>
                    </Td>
                  )}
                  <Td>
                    {r.appCount === 0 ? (
                      <Chip tone="info">No applications</Chip>
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
                        <button className="text-xs text-muted hover:text-red-600" title={r.appCount === 0 ? "Delete student with no applications" : archived ? "Restore" : "Archive"}>
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
