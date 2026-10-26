import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { setCounsellorActiveAction } from "@/server/team";
import { Alert, Button, Card, CardHeader, Chip, Select } from "@/components/ui";
import { AddCounsellorForm, EditMemberForm, ResetPasswordForm } from "./forms";
import { PARTNER_ROLES } from "@/lib/permissions";
import { seatLimit } from "@/lib/seats";
import { departments as departmentList, getSettings } from "@/server/settings";

export const metadata = { title: "Team" };

/** The branch owner's own team: counsellors (within the tier's seats, for a sub-agent), their desks, passwords and students. */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ department?: string }> }) {
  const owner = await requireUser(["PARTNER"]);
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, owner.orgId) });
  if (!org) return <Alert tone="bad">This branch could not be loaded.</Alert>;
  const departments = departmentList(await getSettings());
  const sp = await searchParams;
  const department = (sp.department ?? "").trim() || null;
  const u = schema.users;
  const everyone = await db
    .select({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      deskLabel: u.deskLabel,
      department: u.department,
      active: u.active,
      lastSignInAt: u.lastSignInAt,
      students: sql<number>`(select count(*)::int from students s where s.assigned_to_id = users.id and not s.archived)`,
      apps: sql<number>`(select count(*)::int from applications a join students s on s.id = a.student_id where s.assigned_to_id = users.id)`,
    })
    .from(u)
    .where(and(eq(u.orgId, org.id), inArray(u.role, [...PARTNER_ROLES])))
    .orderBy(sql`${u.role} = 'PARTNER' desc`, sql`${u.active} desc`, u.name);
  const people = department ? everyone.filter((p) => p.department === department) : everyone;
  const [{ used }] = await db.select({ used: count() }).from(u).where(and(eq(u.orgId, org.id), eq(u.active, true), inArray(u.role, [...PARTNER_ROLES])));
  // A branch has no seat limit; a sub-agent has its tier's. Infinity keeps
  // every "is there room" question below the same for both.
  const limit = seatLimit(org);
  const free = limit === null ? Infinity : Math.max(0, limit - used);
  const tierName = org.tier.charAt(0) + org.tier.slice(1).toLowerCase();

  return (
    <>
      <Card>
        <CardHeader title="Your team" subtitle={`${limit === null ? `${used} ${used === 1 ? "person" : "people"} active` : `${used} of ${limit} seats in use on the ${tierName} tier`}. Switching someone off moves their students to you and signs them out at once.`} />
        <form method="get" className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2" data-department-filter>
          <label htmlFor="department-filter" className="text-sm text-muted">Department</label>
          <Select id="department-filter" name="department" defaultValue={department ?? ""} className="w-48 py-1.5 text-sm">
            <option value="">Everybody</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" size="sm">Show</Button>
          {department && <span className="text-xs text-muted" data-department-shown={department}>Showing people in {department}.</span>}
        </form>
        <ul className="divide-y divide-line">
          {people.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nobody in your team is in {department}.</li>}
          {people.map((p) => (
            <li key={p.id} className="px-4 py-3 text-sm" data-testid={`member-${p.email}`} data-department={p.department ?? ""}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">
                    {p.name} {p.role === "PARTNER" ? <Chip tone="brand">Owner</Chip> : null} {p.department ? <Chip tone="info">{p.department}</Chip> : null} {!p.active && <Chip>Switched off</Chip>}
                  </p>
                  <p className="text-muted">{[p.email, p.phone, p.deskLabel].filter(Boolean).join(" · ")}</p>
                  <p className="text-xs text-muted">
                    {p.students} student{p.students === 1 ? "" : "s"}, {p.apps} application{p.apps === 1 ? "" : "s"} · {p.lastSignInAt ? `last signed in ${fmtDateTime(p.lastSignInAt)}` : "never signed in"}
                  </p>
                </div>
                {p.role === "COUNSELLOR" && (
                  <form action={setCounsellorActiveAction}>
                    <input type="hidden" name="userId" value={p.id} />
                    <Button size="sm" variant={p.active ? "quiet" : "secondary"} disabled={!p.active && free === 0} aria-label={`${p.active ? "Switch off" : "Switch on"} ${p.name}`}>
                      {p.active ? "Switch off" : free === 0 ? "No seat free" : "Switch back on"}
                    </Button>
                  </form>
                )}
              </div>
              {p.role === "COUNSELLOR" && p.active && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-brand-600">Details and password</summary>
                  <div className="mt-2 space-y-3">
                    <EditMemberForm userId={p.id} name={p.name} email={p.email} deskLabel={p.deskLabel} department={p.department} departments={departments} />
                    <ResetPasswordForm userId={p.id} name={p.name} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Add a counsellor" subtitle={
            limit === null
              ? "Add as many as the branch needs."
              : free > 0
                ? `${free} seat${free === 1 ? "" : "s"} free.`
                : "Every seat is in use. Switch someone off first, or ask the Overseas team about a higher tier."
          } />
        {free > 0 && <div className="p-4 pt-0"><AddCounsellorForm departments={departments} /></div>}
      </Card>
    </>
  );
}
