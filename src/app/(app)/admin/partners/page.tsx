import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { Button, Card, Chip, PageHeader, Select, Input } from "@/components/ui";
import { toggleUserAction, updateOrgAction } from "./actions";
import { AddUserForm, InvitePartnerForm } from "./forms";

export const metadata = { title: "Partners" };

export default async function PartnersPage() {
  const me = await requireUser(["ADMIN"]);
  const orgs = await db.query.organizations.findMany({
    with: { users: { columns: { id: true, name: true, email: true, role: true, deskLabel: true, active: true }, orderBy: asc(schema.users.name) } },
    orderBy: [sql`case when ${schema.organizations.type} = 'HQ' then 0 else 1 end`, asc(schema.organizations.name)],
  });
  const admins = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.role, "ADMIN"));
  const stats = await db.execute<{ org_id: string; students: number; apps: number }>(sql`
    select o.id as org_id,
      (select count(*)::int from students s where s.org_id = o.id) as students,
      (select count(*)::int from applications a where a.org_id = o.id) as apps
    from organizations o`);
  const statFor = (id: string) => stats.find((s) => s.org_id === id);

  return (
    <>
      <PageHeader title="Partners" subtitle="Branches, sub-agents and the Medcity Overseas team" />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {orgs.map((o) => {
            const seatsUsed = o.users.filter((u) => u.active && (u.role === "PARTNER" || u.role === "COUNSELLOR")).length;
            return (
              <Card key={o.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{o.name}</h2>
                    <p className="text-muted">
                      {o.type === "HQ" ? "Medcity Overseas" : o.type === "BRANCH" ? "Branch" : "Sub-agent"}{o.city ? ` · ${o.city}` : ""}
                      {o.type !== "HQ" && ` · ${statFor(o.id)?.students ?? 0} students · ${statFor(o.id)?.apps ?? 0} applications`}
                    </p>
                  </div>
                  {o.type !== "HQ" && (
                    <form action={updateOrgAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="orgId" value={o.id} />
                      <label className="text-xs text-muted">Tier
                        <Select name="tier" defaultValue={o.tier} className="mt-1 w-28 py-1.5"><option>SILVER</option><option>GOLD</option><option>ELITE</option><option>PLATINUM</option></Select>
                      </label>
                      <label className="text-xs text-muted">Seats ({seatsUsed} used)
                        <Input name="counsellorSeats" type="number" min={1} defaultValue={o.counsellorSeats} className="mt-1 w-20 py-1.5" />
                      </label>
                      <label className="text-xs text-muted">Relationship manager
                        <Select name="relationshipManagerId" defaultValue={o.relationshipManagerId ?? ""} className="mt-1 w-40 py-1.5">
                          <option value="">None</option>
                          {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </Select>
                      </label>
                      <Button variant="secondary" className="py-1.5">Save</Button>
                    </form>
                  )}
                </div>
                <ul className="mt-3 divide-y divide-line rounded-md border border-line">
                  {o.users.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className={u.active ? "font-medium" : "text-muted line-through"}>{u.name}</span>
                      <span className="text-muted">{u.email}</span>
                      {u.deskLabel && <Chip>{u.deskLabel}</Chip>}
                      <Chip tone="info">{u.role.toLowerCase()}</Chip>
                      {u.id !== me.id && (
                        <form action={toggleUserAction} className="ml-auto">
                          <input type="hidden" name="userId" value={u.id} />
                          <button className="text-xs text-muted hover:text-ink">{u.active ? "Deactivate" : "Reactivate"}</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
                <details className="mt-3">
                  <summary className="cursor-pointer text-brand-600">Add user</summary>
                  <div className="mt-2"><AddUserForm orgId={o.id} hq={o.type === "HQ"} /></div>
                </details>
              </Card>
            );
          })}
        </div>
        <Card className="h-fit p-4">
          <h2 className="mb-3 font-semibold">Invite a partner</h2>
          <InvitePartnerForm />
        </Card>
      </div>
    </>
  );
}
