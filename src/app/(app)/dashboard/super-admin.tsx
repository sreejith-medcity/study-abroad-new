import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { storageBackend } from "@/server/storage";
import { actionLabel } from "@/server/audit-query";
import type { ApplicationFilters } from "@/server/queries";
import { funnel, groupCounts, lateWork, partnerLeaderboard, platformSnapshot, todayCounts } from "@/server/dashboard";
import { commissionTotals, inr } from "@/server/commission";
import { db, schema } from "@/db";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { ROLE_LABEL } from "@/lib/permissions";
import {
  Alert,
  BarList,
  Card,
  CardHeader,
  Chip,
  DashboardHero,
  DataList,
  EmptyState,
  FunnelSteps,
  LinkButton,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { IconAlert, IconCheck, IconPartners, IconShield, IconStudents, IconQueue } from "@/components/icons";
import { ActivityCard } from "./parts";

const WATCHED = ["passport.reveal", "student.delete", "applications.export", "audit.export", "document.delete", "user.role_change", "user.password_reset"];

/** The platform view: accounts, access, integrations and anything that needs an owner. */
export default async function SuperAdminDashboard({ user, f }: { user: SessionUser; f: ApplicationFilters }) {
  void f;
  const { users: us, organizations: og } = schema;

  const [snapshot, groups, late, steps, partners, today, commission, attention, sensitive] = await Promise.all([
    platformSnapshot(),
    groupCounts(user),
    lateWork(user),
    funnel(user),
    partnerLeaderboard(5),
    todayCounts(user),
    commissionTotals(user),
    db
      .select({ id: us.id, name: us.name, email: us.email, role: us.role, active: us.active, mustChangePassword: us.mustChangePassword, lastSignInAt: us.lastSignInAt, orgName: og.name })
      .from(us)
      .innerJoin(og, eq(us.orgId, og.id))
      .where(or(eq(us.mustChangePassword, true), and(isNull(us.lastSignInAt), eq(us.active, true)), eq(us.active, false)))
      .orderBy(desc(us.mustChangePassword), us.name)
      .limit(8),
    db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        entityType: schema.auditLogs.entityType,
        entityId: schema.auditLogs.entityId,
        createdAt: schema.auditLogs.createdAt,
        actorName: us.name,
      })
      .from(schema.auditLogs)
      .leftJoin(us, eq(schema.auditLogs.actorId, us.id))
      .where(inArray(schema.auditLogs.action, WATCHED))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(6),
  ]);

  const staff = (snapshot.roles.SUPER_ADMIN ?? 0) + (snapshot.roles.ADMIN ?? 0) + (snapshot.roles.MANAGEMENT ?? 0);
  const partnerUsers = (snapshot.roles.PARTNER ?? 0) + (snapshot.roles.COUNSELLOR ?? 0);
  const orgCount = (snapshot.orgs.BRANCH ?? 0) + (snapshot.orgs.SUB_AGENT ?? 0);
  const backend = storageBackend();

  return (
    <>
      <DashboardHero
        eyebrow="Platform owner"
        title="Medcity Overseas platform"
        subtitle="Accounts, access and the health of everything behind the portal. You also have every Overseas admin power."
        actions={
          <>
            <LinkButton href="/admin/partners" variant="secondary">
              <IconPartners className="size-4" /> Partners and people
            </LinkButton>
            <LinkButton href="/admin/audit">
              <IconShield className="size-4" /> Audit log
            </LinkButton>
          </>
        }
        meta={[
          { label: "Active accounts", value: snapshot.flags.total - snapshot.flags.inactive },
          { label: "Signed in this week", value: snapshot.flags.signedInWeek },
          { label: "Partner organisations", value: orgCount },
          { label: "Past SLA", value: late.total },
          { label: "Moves today", value: today.moves },
        ]}
      />

      {(snapshot.flags.temporary > 0 || snapshot.messages.failed > 0 || backend === "local-disk") && (
        <div className="mb-5 space-y-2">
          {snapshot.flags.temporary > 0 && (
            <Alert tone="warn" title={`${snapshot.flags.temporary} account${snapshot.flags.temporary > 1 ? "s" : ""} still on a temporary password`}>
              They cannot use the portal until they set their own password. <Link href="/admin/partners" className="font-medium underline">Review the list</Link>.
            </Alert>
          )}
          {snapshot.messages.failed > 0 && (
            <Alert tone="bad" title={`${snapshot.messages.failed} outbound message${snapshot.messages.failed > 1 ? "s" : ""} failed`}>
              WhatsApp or email delivery is rejecting messages. Check the provider credentials and templates.
            </Alert>
          )}
          {backend === "local-disk" && (
            <Alert tone="warn" title="Documents are on local disk">
              Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY with a private student-documents bucket so uploads survive a deploy.
            </Alert>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Overseas team" tone="brand" icon={<IconShield className="size-4" />} value={staff} href="/admin/partners" />
            <Stat label="Partner users" tone="info" icon={<IconStudents className="size-4" />} value={partnerUsers} href="/admin/partners" />
            <Stat label="Temporary passwords" tone="warn" icon={<IconAlert className="size-4" />} value={snapshot.flags.temporary} href="/admin/partners" />
            <Stat label="Never signed in" tone="stop" icon={<IconAlert className="size-4" />} value={snapshot.flags.neverSignedIn} href="/admin/partners" />
          </div>

          <Card>
            <CardHeader
              title="Accounts that need an owner"
              subtitle="Temporary passwords, accounts that have never signed in, and switched off accounts"
              action={<Link href="/admin/partners" className="text-[13px] font-medium text-brand-600 hover:underline">Manage people</Link>}
            />
            {attention.length === 0 ? (
              <EmptyState title="Every account is in good shape" icon={<IconCheck className="size-5" />}>
                Nobody is waiting on a password and nobody is switched off.
              </EmptyState>
            ) : (
              <Table tableClassName="min-w-[640px]">
                <thead>
                  <tr>
                    <Th>Person</Th>
                    <Th>Role</Th>
                    <Th>Organisation</Th>
                    <Th>State</Th>
                    <Th>Last signed in</Th>
                  </tr>
                </thead>
                <tbody>
                  {attention.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <p className={r.active ? "font-medium" : "text-muted line-through"}>{r.name}</p>
                        <p className="truncate text-xs text-muted">{r.email}</p>
                      </Td>
                      <Td><Chip tone={r.role === "SUPER_ADMIN" ? "gold" : r.role === "ADMIN" ? "brand" : "neutral"}>{ROLE_LABEL[r.role] ?? r.role}</Chip></Td>
                      <Td className="text-[13px]">{r.orgName}</Td>
                      <Td>
                        {!r.active ? (
                          <Chip tone="bad">Switched off</Chip>
                        ) : r.mustChangePassword ? (
                          <Chip tone="warn">Temporary password</Chip>
                        ) : (
                          <Chip>Never signed in</Chip>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-[13px] text-muted">{r.lastSignInAt ? fmtDate(r.lastSignInAt) : "Never"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Actions worth watching"
              subtitle="Passport reveals, deletes and exports, newest first"
              action={<Link href="/admin/audit" className="text-[13px] font-medium text-brand-600 hover:underline">Full audit log</Link>}
            />
            {sensitive.length === 0 ? (
              <EmptyState title="Nothing sensitive recorded yet" icon={<IconShield className="size-5" />}>
                Passport reveals, record deletions and data exports appear here as soon as they happen.
              </EmptyState>
            ) : (
              <ul>
                {sensitive.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line px-4 py-2.5 text-[13px] last:border-0">
                    <Chip tone={/delete|reveal/.test(r.action) ? "bad" : "warn"}>{actionLabel(r.action)}</Chip>
                    <span className="font-medium">{r.actorName ?? "System"}</span>
                    <span className="text-muted">· {r.entityType.replace(/_/g, " ")}</span>
                    <span className="ml-auto text-xs text-muted">{fmtDate(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Recorded activity" subtitle="Last seven days, by action" />
              <BarList
                items={snapshot.auditByAction.map((r) => ({ label: actionLabel(r.action), value: r.value }))}
                tone="brand"
                empty="Nothing recorded in the last week."
              />
            </Card>
            <Card>
              <CardHeader title="Business funnel" subtitle="The same numbers management sees" />
              <FunnelSteps steps={steps} />
            </Card>
          </div>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Accounts by role" subtitle="Active accounts only" />
            <DataList
              rows={[
                { label: "Super admin", value: snapshot.roles.SUPER_ADMIN ?? 0 },
                { label: "Overseas admin", value: snapshot.roles.ADMIN ?? 0 },
                { label: "Management", value: snapshot.roles.MANAGEMENT ?? 0 },
                { label: "Partner owner", value: snapshot.roles.PARTNER ?? 0 },
                { label: "Counsellor", value: snapshot.roles.COUNSELLOR ?? 0 },
                { label: "Switched off", value: snapshot.flags.inactive, tone: snapshot.flags.inactive ? "warn" : undefined },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Platform state" subtitle="What this deployment is running" />
            <DataList
              rows={[
                { label: "Document storage", value: backend === "supabase" ? "Supabase Storage" : "Local disk", tone: backend === "supabase" ? "ok" : "warn" },
                { label: "Messages sent", value: snapshot.messages.sent },
                { label: "Messages queued", value: snapshot.messages.queued },
                { label: "Messages failed", value: snapshot.messages.failed, tone: snapshot.messages.failed ? "bad" : undefined },
                { label: "Branches", value: snapshot.orgs.BRANCH ?? 0 },
                { label: "Sub-agents", value: snapshot.orgs.SUB_AGENT ?? 0 },
                { label: "Commission in flight", value: inr(commission.EXPECTED.partner + commission.INVOICED.partner + commission.RECEIVED.partner) },
                { label: "Paid to partners", value: inr(commission.SETTLED.partner), tone: "ok" },
              ]}
            />
          </Card>

          <Card>
            <CardHeader
              title="Live work"
              subtitle="Same lanes as the work queue"
              action={<Link href="/admin/queue" className="text-[13px] font-medium text-brand-600 hover:underline"><IconQueue className="inline size-4" /></Link>}
            />
            <DataList
              rows={[
                { label: "New / assessment", value: groups.NEW },
                { label: "Pending from partner", value: groups.PENDING_PARTNER, tone: "warn" },
                { label: "In progress", value: groups.IN_PROGRESS },
                { label: "Offer / contract", value: groups.OFFER, tone: "ok" },
                { label: "Past SLA", value: late.total, tone: late.total ? "bad" : undefined },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Busiest partners" subtitle="By total applications" />
            <BarList items={partners.map((p) => ({ label: p.name, hint: p.tier, value: p.total, href: `/applications?org=${p.id}` }))} />
          </Card>

          <ActivityCard rows={snapshot.recentAudit} actionLabel={actionLabel} />
        </div>
      </div>
    </>
  );
}
