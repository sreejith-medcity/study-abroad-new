import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { roleFitsOrg } from "@/lib/people";
import { ADMIN_ROLES, HQ_ROLES, PARTNER_ROLES, ROLE_BLURB, ROLE_LABEL, STUDENT_WORK_ROLES, canManageSuperAdmins, canManageUsers, canResetPasswords } from "@/lib/permissions";
import { Button, Card, Chip, Input, PageHeader, Select, Alert } from "@/components/ui";
import { IconPartners } from "@/components/icons";
import { deleteOrgAction, toggleOrgActiveAction, toggleUserAction, updateOrgAction } from "./actions";
import { untouchedOrgs } from "@/server/org-untouched";
import { departments as departmentList, getSettings } from "@/server/settings";
import { AddUserForm, EditPersonForm, InvitePartnerForm, MovePersonForm, ResetPasswordForm, RoleForm } from "./forms";
import { OrgFold, OrgList } from "./org-list";
import { PublicFormPanel } from "./public-form-panel";

export const metadata = { title: "Partners and people" };

const ROLE_TONE: Record<string, "brand" | "info" | "neutral" | "gold" | "warn" | "ok"> = {
  SUPER_ADMIN: "gold",
  OPS_MANAGER: "warn",
  ADMIN: "brand",
  DOCUMENTATION: "ok",
  MANAGEMENT: "info",
  PARTNER: "neutral",
  COUNSELLOR: "neutral",
  STUDENT: "neutral",
};

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ department?: string; move?: string; to?: string; role?: string }> }) {
  const me = await requireUser([...ADMIN_ROLES]);
  const manageUsers = canManageUsers(me);
  const superAdmin = canManageSuperAdmins(me);
  const departments = departmentList(await getSettings());
  // One department at a time, when asked. Only the people are filtered: an
  // organisation with nobody in that department is still listed, folded, so
  // the screen does not read as if the branch had gone.
  const sp = await searchParams;
  const department = (sp.department ?? "").trim() || null;
  // Opened on one person's move form, as the "email already in use" refusal
  // offers: their organisation unfolded, their form open and pre-filled.
  const moving = (sp.move ?? "").trim() || null;

  const everyOrg = await db.query.organizations.findMany({
    with: {
      users: {
        // Student portal logins belong to the student file, not to the staff list.
        where: ne(schema.users.role, "STUDENT"),
        columns: { id: true, name: true, email: true, role: true, deskLabel: true, department: true, active: true, lastSignInAt: true, mustChangePassword: true },
        orderBy: asc(schema.users.name),
      },
    },
    orderBy: [sql`case when ${schema.organizations.type} = 'HQ' then 0 else 1 end`, asc(schema.organizations.name)],
  });
  const orgs = department ? everyOrg.map((o) => ({ ...o, users: o.users.filter((u) => u.department === department) })) : everyOrg;
  // What a move needs to say before it is made: how many students each person
  // carries at their own branch, and who else there could take them.
  const carrying = await db
    .select({ userId: schema.students.assignedToId, n: sql<number>`count(*)::int` })
    .from(schema.students)
    .innerJoin(schema.users, eq(schema.users.id, schema.students.assignedToId))
    .where(eq(schema.students.orgId, schema.users.orgId))
    .groupBy(schema.students.assignedToId);
  const studentsOf = Object.fromEntries(carrying.map((r) => [r.userId ?? "", Number(r.n)])) as Record<string, number>;
  // Somebody at the head office works files at every branch, and what they
  // hand over on a move is everything on their name, wherever it is: their
  // students and their open tasks.
  const hqOrg = everyOrg.find((o) => o.type === "HQ");
  const deskCarrying = hqOrg
    ? await db
        .select({ userId: schema.students.assignedToId, n: sql<number>`count(*)::int` })
        .from(schema.students)
        .innerJoin(schema.users, eq(schema.users.id, schema.students.assignedToId))
        .where(eq(schema.users.orgId, hqOrg.id))
        .groupBy(schema.students.assignedToId)
    : [];
  const deskTasks = hqOrg
    ? await db
        .select({ userId: schema.tasks.assignedToId, n: sql<number>`count(*)::int` })
        .from(schema.tasks)
        .innerJoin(schema.users, eq(schema.users.id, schema.tasks.assignedToId))
        .where(and(eq(schema.users.orgId, hqOrg.id), isNull(schema.tasks.doneAt)))
        .groupBy(schema.tasks.assignedToId)
    : [];
  const deskStudentsOf = Object.fromEntries(deskCarrying.map((r) => [r.userId ?? "", Number(r.n)])) as Record<string, number>;
  const deskTasksOf = Object.fromEntries(deskTasks.map((r) => [r.userId, Number(r.n)])) as Record<string, number>;
  // Whether an organisation already has an active branch head other than
  // this person, so the move form can say so before the move is refused.
  const hasHeadBesides = (orgId: string, exceptId: string) =>
    everyOrg.find((o) => o.id === orgId)?.users.some((u) => u.id !== exceptId && u.active && u.role === "PARTNER") ?? false;
  const colleaguesAt = (orgId: string, exceptId: string) =>
    everyOrg
      .find((o) => o.id === orgId)
      ?.users.filter((u) => u.id !== exceptId && u.active && (STUDENT_WORK_ROLES as readonly string[]).includes(u.role))
      .map((u) => ({ id: u.id, name: u.name, deskLabel: u.deskLabel })) ?? [];
  // Where a person can be moved to. Those who manage user accounts can change
  // the role in the same step, so every other open organisation is offered,
  // the head office included, and the form lists the roles that fit each.
  // Anybody else moves people in the role they have, so only the
  // organisations that role fits, and never into the head office.
  const targetsFor = (role: string, orgId: string, userId: string) =>
    everyOrg
      .filter((o) => o.id !== orgId && o.active && (manageUsers || (o.type !== "HQ" && roleFitsOrg(role, o.type))))
      .map((o) => ({ id: o.id, name: o.name, type: o.type, hasHead: hasHeadBesides(o.id, userId) }));
  // Which of these have done nothing at all, and so can be deleted rather
  // than closed. One definition, shared with the action behind the button.
  const untouched = await untouchedOrgs(orgs.filter((o) => o.type !== "HQ").map((o) => o.id));
  const studentLoginRows = await db
    .select({ orgId: schema.users.orgId, n: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(eq(schema.users.role, "STUDENT"))
    .groupBy(schema.users.orgId);
  const studentLogins = Object.fromEntries(studentLoginRows.map((r) => [r.orgId, Number(r.n)])) as Record<string, number>;
  const admins = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(sql`${schema.users.role} in ('ADMIN','SUPER_ADMIN')`);
  const stats = await db.execute<{ org_id: string; students: number; apps: number; web_enquiries: number }>(sql`
    select o.id as org_id,
      (select count(*)::int from students s where s.org_id = o.id) as students,
      (select count(*)::int from applications a where a.org_id = o.id) as apps,
      (select count(*)::int from enquiries e where e.org_id = o.id and e.source = 'WEBSITE') as web_enquiries
    from organizations o`);
  const statFor = (id: string) => stats.find((s) => s.org_id === id);

  return (
    <>
      <PageHeader
        title="Partners and people"
        subtitle={manageUsers ? "Organisations, staff accounts, roles and password resets" : "Organisations and their users"}
      />

      {!manageUsers && (
        <Alert tone="info">
          Roles and password resets are handled by a super admin. You can invite partners, add partner staff and change tiers.
        </Alert>
      )}

      <form method="get" className="mt-4 flex flex-wrap items-center gap-2" data-department-filter>
        <label htmlFor="department-filter" className="text-sm text-muted">Department</label>
        <Select id="department-filter" name="department" defaultValue={department ?? ""} className="w-48 py-1.5 text-sm">
          <option value="">Everybody</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" size="sm">Show</Button>
        {department && (
          <span className="text-xs text-muted" data-department-shown={department}>
            Showing people in {department}. Organisations with nobody there are listed with no people.
          </span>
        )}
      </form>

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <OrgList count={orgs.length}>
          {orgs.map((o) => {
            const hq = o.type === "HQ";
            // The summary line counts the whole organisation even while the
            // people under it are filtered to one department.
            const everyone = everyOrg.find((x) => x.id === o.id)?.users ?? o.users;
            const seatsUsed = everyone.filter((u) => u.active && (PARTNER_ROLES as readonly string[]).includes(u.role)).length;
            const stat = statFor(o.id);
            const people = everyone.filter((u) => u.active).length;
            const waiting = everyone.filter((u) => u.active && u.mustChangePassword).length;

            // The summary line carries what the desk scans a branch for, so the
            // common question is answered without opening anything.
            const meta = (
              hq
                ? ["Medcity Overseas team", `${people} ${people === 1 ? "person" : "people"}`]
                : [
                    o.type === "BRANCH" ? "Branch" : "Sub-agent",
                    o.city ?? null,
                    o.tier,
                    `${people} ${people === 1 ? "person" : "people"}`,
                    // Seats are a sub-agent's tier arrangement; a branch is
                    // Medcity's own and has none.
                    o.type === "SUB_AGENT" ? `${seatsUsed} of ${o.counsellorSeats} seats` : null,
                    `${stat?.students ?? 0} students`,
                    `${stat?.apps ?? 0} applications`,
                  ]
            )
              .filter(Boolean)
              .join(" · ");

            // Only a password nobody has used yet opens an organisation by
            // itself: somebody cannot sign in until it is dealt with. The rest
            // is said on the summary line and opened when the desk wants it.
            const todo = [
              waiting ? `${waiting} temporary ${waiting === 1 ? "password" : "passwords"}` : null,
              o.type === "SUB_AGENT" && seatsUsed > o.counsellorSeats ? "Over its seats" : null,
              !hq && !o.idCode ? "No ID code" : null,
              !hq && !o.relationshipManagerId ? "No relationship manager" : null,
              !people ? "Nobody yet" : null,
            ].filter(Boolean) as string[];

            const haystack = [o.name, o.city, o.idCode, ...o.users.flatMap((u) => [u.name, u.email, u.deskLabel])]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();

            return (
              <OrgFold
                key={o.id}
                id={`org-${o.id}`}
                title={o.name}
                meta={meta}
                attention={todo.join(" · ") || null}
                defaultOpen={hq || waiting > 0 || (!!moving && o.users.some((u) => u.id === moving))}
                haystack={haystack}
              >
                {!hq && (
                  <form action={updateOrgAction} className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
                    <input type="hidden" name="orgId" value={o.id} />
                    <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
                      Tier
                      <Select name="tier" defaultValue={o.tier} className="mt-1 w-28 py-1.5 text-sm">
                        <option>SILVER</option>
                        <option>GOLD</option>
                        <option>ELITE</option>
                        <option>PLATINUM</option>
                      </Select>
                    </label>
                    {o.type === "SUB_AGENT" ? (
                      <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
                        Seats ({seatsUsed} used)
                        <Input name="counsellorSeats" type="number" min={1} defaultValue={o.counsellorSeats} className="mt-1 w-20 py-1.5 text-sm" />
                      </label>
                    ) : (
                      <input type="hidden" name="counsellorSeats" value={o.counsellorSeats} />
                    )}
                    <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
                      ID code
                      <Input name="idCode" defaultValue={o.idCode ?? ""} maxLength={4} placeholder="KTM" className="mt-1 w-20 py-1.5 font-mono text-sm uppercase" />
                    </label>
                    <label className="text-2xs font-semibold uppercase tracking-wider text-muted">
                      Relationship manager
                      <Select name="relationshipManagerId" defaultValue={o.relationshipManagerId ?? ""} className="mt-1 w-40 py-1.5 text-sm">
                        <option value="">None</option>
                        {admins.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">
                      <input
                        type="checkbox"
                        name="checksOwnDocuments"
                        value="1"
                        defaultChecked={o.checksOwnDocuments}
                        className="size-4 rounded border-line-strong accent-brand-600"
                      />
                      Checks its own documents
                    </label>
                    <Button variant="secondary" size="sm">Save</Button>
                    <p className="w-full text-2xs text-muted">
                      The ID code is the branch&rsquo;s letters in every Medcity ID it mints. It can be changed until the first student carries it. A branch
                      that checks its own documents does the first pass on its students; the desk reviews what it decided under &ldquo;Checked by a
                      branch&rdquo; rather than checking all of it again.
                    </p>
                  </form>
                )}
                <ul className="divide-y divide-line">
                  {o.users.map((u) => {
                    // The same line the actions draw: anybody but me, and
                    // Medcity Overseas staff only for those who manage users.
                    const editable = u.id !== me.id && (manageUsers || !(HQ_ROLES as readonly string[]).includes(u.role));
                    const targets = editable ? targetsFor(u.role, o.id, u.id) : [];
                    return (
                    <li key={u.id} id={`person-${u.id}`} className="px-4 py-3" data-testid={`person-${u.email}`} data-department={u.department ?? ""}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="min-w-48">
                          <p className={u.active ? "font-medium" : "text-muted line-through"}>{u.name}</p>
                          <p className="text-xs text-muted">{u.email}</p>
                        </div>
                        <Chip tone={ROLE_TONE[u.role] ?? "neutral"}>{ROLE_LABEL[u.role] ?? u.role}</Chip>
                        {u.deskLabel && <Chip>{u.deskLabel}</Chip>}
                        {u.department && <Chip tone="info">{u.department}</Chip>}
                        {u.mustChangePassword && <Chip tone="warn">Temporary password</Chip>}
                        <span className="text-xs text-muted">
                          {u.lastSignInAt ? `Last signed in ${fmtDate(u.lastSignInAt)}` : "Never signed in"}
                        </span>
                        <div className="ml-auto flex flex-wrap items-center gap-2">
                          {manageUsers && u.id !== me.id && (
                            <RoleForm userId={u.id} role={u.role} hq={hq} subAgent={o.type === "SUB_AGENT"} roleLabel={ROLE_LABEL} canSetSuperAdmin={superAdmin} />
                          )}
                          {canResetPasswords(me) && <ResetPasswordForm userId={u.id} email={u.email} />}
                          {editable && (
                            <form action={toggleUserAction}>
                              <input type="hidden" name="userId" value={u.id} />
                              <button className="text-xs text-muted hover:text-stop-500">{u.active ? "Deactivate" : "Reactivate"}</button>
                            </form>
                          )}
                        </div>
                      </div>
                      {editable && (
                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                          <details data-edit-person>
                            <summary className="cursor-pointer text-xs font-medium text-brand-600">Edit details</summary>
                            <div className="mt-2 max-w-xl">
                              <EditPersonForm userId={u.id} name={u.name} email={u.email} deskLabel={u.deskLabel} department={u.department} departments={departments} />
                            </div>
                          </details>
                          <details data-move-person open={moving === u.id || undefined}>
                            <summary className="cursor-pointer text-xs font-medium text-brand-600">{hq ? "Move to a branch" : "Move to another organisation"}</summary>
                            <div className="mt-2 max-w-xl">
                              <MovePersonForm
                                userId={u.id}
                                name={u.name}
                                orgName={o.name}
                                hq={hq}
                                role={u.role}
                                deskLabel={u.deskLabel}
                                students={hq ? (deskStudentsOf[u.id] ?? 0) : (studentsOf[u.id] ?? 0)}
                                tasks={hq ? (deskTasksOf[u.id] ?? 0) : 0}
                                targets={targets}
                                colleagues={colleaguesAt(o.id, u.id)}
                                canChangeRole={manageUsers}
                                canSetSuperAdmin={superAdmin}
                                roleLabel={ROLE_LABEL}
                                defaultTo={moving === u.id ? sp.to : undefined}
                                defaultRole={moving === u.id ? sp.role : undefined}
                              />
                            </div>
                          </details>
                        </div>
                      )}
                    </li>
                    );
                  })}
                </ul>
                {!hq && (
                  <PublicFormPanel
                    orgId={o.id}
                    orgName={o.name}
                    slug={o.publicSlug}
                    enabled={o.publicFormEnabled}
                    enquiries={stat?.web_enquiries ?? 0}
                  />
                )}
                {!hq && (studentLogins[o.id] ?? 0) > 0 && (
                  <p className="border-t border-line px-4 py-2 text-xs text-muted">
                    {studentLogins[o.id]} student portal {studentLogins[o.id] === 1 ? "login" : "logins"}, managed from each student&apos;s file.
                  </p>
                )}
                <details className="border-t border-line px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-600">Add user to {o.name}</summary>
                  <div className="mt-3">
                    <AddUserForm
                      orgId={o.id}
                      hq={hq}
                      subAgent={o.type === "SUB_AGENT"}
                      canCreateStaff={manageUsers}
                      canCreateSuperAdmin={superAdmin}
                      roleLabel={ROLE_LABEL}
                      roleBlurb={ROLE_BLURB}
                      departments={departments}
                    />
                  </div>
                </details>
                {/* A branch added by mistake goes; one that has done anything
                    at all is closed, which keeps every student, application
                    and rupee exactly where they are. */}
                {!hq &&
                  (untouched.has(o.id) ? (
                    <form action={deleteOrgAction} className="border-t border-line px-4 py-2">
                      <input type="hidden" name="orgId" value={o.id} />
                      <button className="text-xs text-muted hover:text-stop-500">Delete this branch</button>
                      <span className="ml-2 text-xs text-muted">
                        No students, no enquiries, and nobody has signed in, so there is nothing to keep. Its accounts go with it.
                      </span>
                    </form>
                  ) : (
                    <form action={toggleOrgActiveAction} className="border-t border-line px-4 py-2">
                      <input type="hidden" name="orgId" value={o.id} />
                      <button className="text-xs text-muted hover:text-stop-500">
                        {o.active ? "Close this branch" : "Open it again"}
                      </button>
                      <span className="ml-2 text-xs text-muted">
                        {o.active
                          ? "Everything it has done stays. It stops being offered on new students, and its enquiry form stops answering."
                          : "Closed, so it is not offered on new students."}
                      </span>
                    </form>
                  ))}
              </OrgFold>
            );
          })}
        </OrgList>

        <Card className="h-fit p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display text-base font-semibold">
            <IconPartners className="size-4 text-brand-600" /> Invite a partner
          </h2>
          <p className="mb-3 text-sm text-muted">Creates the organisation and its owner account with a one-time password.</p>
          <InvitePartnerForm />
        </Card>
      </div>
    </>
  );
}
