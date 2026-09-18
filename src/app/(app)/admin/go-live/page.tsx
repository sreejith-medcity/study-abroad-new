import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { canManageSettings, ROLE_LABEL } from "@/lib/permissions";
import { demoInventory } from "@/server/go-live";
import { Alert, Card, CardHeader, Chip, DataList, PageHeader, Table, Td, Th } from "@/components/ui";
import { IconShield } from "@/components/icons";
import { fmtDateTime } from "@/lib/format";
import { ClearForm } from "./form";

export const metadata = { title: "Go live" };

const LABEL: Record<string, string> = {
  organisations: "Partner organisations",
  accounts: "Sign-in accounts",
  students: "Students",
  applications: "Applications",
  enquiries: "Enquiries",
  commissions: "Commission records",
  notifications: "Notifications",
  audit_entries: "Audit entries by those accounts",
};

const KEEPING: Record<string, string> = {
  organisations: "Organisations",
  accounts: "Accounts",
  programs: "Programs",
  universities: "Universities",
  statuses: "Status definitions",
  resources: "Learning resources",
  commission_rules: "Commission rules",
};

export default async function GoLivePage() {
  const user = await requireUser();
  if (!canManageSettings(user)) return <Alert tone="bad">Only a super admin can open this page.</Alert>;

  const [inventory, lastRun] = await Promise.all([
    demoInventory(),
    // A durable record of the run, so the page can still account for it later.
    db
      .select({ createdAt: schema.auditLogs.createdAt, meta: schema.auditLogs.meta, actor: schema.users.name })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.users.id, schema.auditLogs.actorId))
      .where(eq(schema.auditLogs.action, "platform.go_live"))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null)
      .catch(() => null),
  ]);
  const total = Object.entries(inventory.counts)
    .filter(([key]) => key !== "notifications")
    .reduce((sum, [, n]) => sum + Number(n), 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <IconShield className="size-4" /> Super admin
          </span>
        }
        title="Go live"
        subtitle="Remove the sample data the portal was built against, so it holds only real records."
      />

      {lastRun && (
        <Alert tone="ok" title="Already run">
          {lastRun.actor ?? "Somebody"} cleared the sample data on {fmtDateTime(lastRun.createdAt)}.
        </Alert>
      )}

      <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="What would be removed"
              subtitle="Accounts on a .test or example.com address, students and enquiries on example.com, and any partner organisation left with nothing real in it."
              action={<Chip tone={total > 0 ? "warn" : "ok"}>{total > 0 ? `${total} records` : "Nothing found"}</Chip>}
            />
            <DataList
              rows={Object.entries(inventory.counts)
                .filter(([, n]) => Number(n) > 0)
                .map(([key, n]) => ({ label: LABEL[key] ?? key, value: Number(n), tone: "warn" as const }))}
            />
            {total === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted">This portal already holds only real records.</p>}
          </Card>

          {inventory.organisations.length > 0 && (
            <Card>
              <CardHeader title="Organisations" subtitle="Every account and every student inside these is sample data." />
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>City</Th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.organisations.map((o) => (
                    <tr key={o.id}>
                      <Td className="font-medium">{o.name}</Td>
                      <Td className="text-muted">{o.city ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {inventory.accounts.length > 0 && (
            <Card>
              <CardHeader title="Accounts" subtitle="These sign-ins stop working the moment this runs." />
              <Table tableClassName="min-w-[560px]">
                <thead>
                  <tr>
                    <Th>Person</Th>
                    <Th>Email</Th>
                    <Th>Role</Th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.accounts.map((a) => (
                    <tr key={a.id}>
                      <Td className="font-medium">{a.name}</Td>
                      <Td className="break-all text-muted">{a.email}</Td>
                      <Td>
                        <Chip>{ROLE_LABEL[a.role] ?? a.role}</Chip>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="What stays" subtitle="Your own account, your settings, and everything you have set up." />
            <DataList rows={Object.entries(inventory.keeping).map(([key, n]) => ({ label: KEEPING[key] ?? key, value: Number(n) }))} />
          </Card>

          <Card>
            <CardHeader title="Run it" />
            <div className="space-y-3 p-4">
              <Alert tone="warn" title="This cannot be undone">
                It runs as one step: either all of it goes or none of it does. Take a Supabase backup first if you want a way back.
              </Alert>
              <p className="text-[13px] leading-relaxed text-muted">
                A real record that one of these accounts happened to touch keeps its own row and loses only the pointer. A learning
                resource cannot be left without an owner, so any of those pass to you. Notifications are cleared, because they all
                point at records that are about to go.
              </p>
              <ClearForm total={total} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
