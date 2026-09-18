import { asc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { ADMIN_ROLES, canManageUsers, canResetPasswords, ROLE_LABEL } from "@/lib/permissions";
import { Button, Card, CardHeader, Chip, Input, PageHeader, Select, Alert } from "@/components/ui";
import { IconPartners } from "@/components/icons";
import { toggleUserAction, updateOrgAction } from "./actions";
import { AddUserForm, InvitePartnerForm, ResetPasswordForm, RoleForm } from "./forms";
import { PublicFormPanel } from "./public-form-panel";

export const metadata = { title: "Partners and people" };

const ROLE_TONE: Record<string, "brand" | "info" | "neutral" | "gold"> = {
  SUPER_ADMIN: "gold",
  ADMIN: "brand",
  MANAGEMENT: "info",
  PARTNER: "neutral",
  COUNSELLOR: "neutral",
};

export default async function PartnersPage() {
  const me = await requireUser([...ADMIN_ROLES]);
  const manageUsers = canManageUsers(me);

  const orgs = await db.query.organizations.findMany({
    with: {
      users: {
        columns: { id: true, name: true, email: true, role: true, deskLabel: true, active: true, lastSignInAt: true, mustChangePassword: true },
        orderBy: asc(schema.users.name),
      },
    },
    orderBy: [sql`case when ${schema.organizations.type} = 'HQ' then 0 else 1 end`, asc(schema.organizations.name)],
  });
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

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {orgs.map((o) => {
            const hq = o.type === "HQ";
            const seatsUsed = o.users.filter((u) => u.active && (u.role === "PARTNER" || u.role === "COUNSELLOR")).length;
            return (
              <Card key={o.id}>
                <CardHeader
                  title={o.name}
                  subtitle={
                    hq
                      ? "Medcity Overseas team"
                      : `${o.type === "BRANCH" ? "Branch" : "Sub-agent"}${o.city ? ` · ${o.city}` : ""} · ${statFor(o.id)?.students ?? 0} students · ${statFor(o.id)?.apps ?? 0} applications`
                  }
                  action={
                    !hq ? (
                      <form action={updateOrgAction} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="orgId" value={o.id} />
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Tier
                          <Select name="tier" defaultValue={o.tier} className="mt-1 w-28 py-1.5 text-[13px]">
                            <option>SILVER</option>
                            <option>GOLD</option>
                            <option>ELITE</option>
                            <option>PLATINUM</option>
                          </Select>
                        </label>
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Seats ({seatsUsed} used)
                          <Input name="counsellorSeats" type="number" min={1} defaultValue={o.counsellorSeats} className="mt-1 w-20 py-1.5 text-[13px]" />
                        </label>
                        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Relationship manager
                          <Select name="relationshipManagerId" defaultValue={o.relationshipManagerId ?? ""} className="mt-1 w-40 py-1.5 text-[13px]">
                            <option value="">None</option>
                            {admins.map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </Select>
                        </label>
                        <Button variant="secondary" size="sm">Save</Button>
                      </form>
                    ) : undefined
                  }
                />
                <ul className="divide-y divide-line">
                  {o.users.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                      <div className="min-w-48">
                        <p className={u.active ? "font-medium" : "text-muted line-through"}>{u.name}</p>
                        <p className="text-xs text-muted">{u.email}</p>
                      </div>
                      <Chip tone={ROLE_TONE[u.role] ?? "neutral"}>{ROLE_LABEL[u.role] ?? u.role}</Chip>
                      {u.deskLabel && <Chip>{u.deskLabel}</Chip>}
                      {u.mustChangePassword && <Chip tone="warn">Temporary password</Chip>}
                      <span className="text-xs text-muted">
                        {u.lastSignInAt ? `Last signed in ${fmtDate(u.lastSignInAt)}` : "Never signed in"}
                      </span>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        {manageUsers && u.id !== me.id && <RoleForm userId={u.id} role={u.role} hq={hq} />}
                        {canResetPasswords(me) && <ResetPasswordForm userId={u.id} email={u.email} />}
                        {u.id !== me.id && (manageUsers || !["SUPER_ADMIN", "ADMIN", "MANAGEMENT"].includes(u.role)) && (
                          <form action={toggleUserAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button className="text-xs text-muted hover:text-stop-500">{u.active ? "Deactivate" : "Reactivate"}</button>
                          </form>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {!hq && (
                  <PublicFormPanel
                    orgId={o.id}
                    orgName={o.name}
                    slug={o.publicSlug}
                    enabled={o.publicFormEnabled}
                    enquiries={statFor(o.id)?.web_enquiries ?? 0}
                  />
                )}
                <details className="border-t border-line px-4 py-3">
                  <summary className="cursor-pointer text-[13px] font-medium text-brand-600">Add user to {o.name}</summary>
                  <div className="mt-3">
                    <AddUserForm orgId={o.id} hq={hq} canCreateStaff={manageUsers} />
                  </div>
                </details>
              </Card>
            );
          })}
        </div>

        <Card className="h-fit p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display text-[15px] font-semibold">
            <IconPartners className="size-4 text-brand-600" /> Invite a partner
          </h2>
          <p className="mb-3 text-[13px] text-muted">Creates the organisation and its owner account with a one-time password.</p>
          <InvitePartnerForm />
        </Card>
      </div>
    </>
  );
}
