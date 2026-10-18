import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { storageBackend } from "@/server/storage";
import { actionLabel } from "@/server/audit-query";
import type { ApplicationFilters } from "@/server/queries";
import { GROUP_LABEL, funnel, groupCounts, lateWork, officerLoad, partnerLeaderboard, platformSnapshot, todayCounts } from "@/server/dashboard";
import { commissionTotals, inr } from "@/server/commission";
import { db, schema } from "@/db";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { ROLE_LABEL } from "@/lib/permissions";
import {
  Alert,
  BarList,
  Chip,
  AlertTiles,
  KpiBoard,
  DashboardHero,
  DataList,
  EmptyState,
  FunnelSteps,
  LinkButton,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { IconCheck, IconPartners, IconShield } from "@/components/icons";
import { Section } from "@/components/section";

const WATCHED = ["passport.reveal", "student.delete", "applications.export", "audit.export", "document.delete", "user.role_change", "user.password_reset"];

/** The platform view: accounts, access, integrations and anything that needs an owner. */
export default async function SuperAdminDashboard({ user, f }: { user: SessionUser; f: ApplicationFilters }) {
  void f;
  const { users: us, organizations: og } = schema;

  const [snapshot, groups, late, load, steps, partners, today, commission, attention, sensitive] = await Promise.all([
    platformSnapshot(),
    groupCounts(user),
    lateWork(user),
    officerLoad(user),
    funnel(user),
    partnerLeaderboard(5),
    todayCounts(user),
    commissionTotals(user),
    db
      .select({ id: us.id, name: us.name, email: us.email, role: us.role, active: us.active, mustChangePassword: us.mustChangePassword, lastSignInAt: us.lastSignInAt, orgName: og.name })
      .from(us)
      .innerJoin(og, eq(us.orgId, og.id))
      .where(
        or(
          and(eq(us.mustChangePassword, true), eq(us.active, true)),
          and(isNull(us.lastSignInAt), eq(us.active, true)),
          eq(us.active, false),
        ),
      )
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

  // Counting the team and the partners two different ways was for a board
  // that now carries the live lanes instead. Both figures are still a click
  // away, in full, under Accounts by role.
  const orgCount = (snapshot.orgs.BRANCH ?? 0) + (snapshot.orgs.SUB_AGENT ?? 0);
  const backend = storageBackend();

  // Everything that is open somewhere, which is what the platform is for.
  // Closed work is history and does not belong in a morning figure.
  const liveApplications = groups.NEW + groups.PENDING_PARTNER + groups.IN_PROGRESS + groups.OFFER;

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
        /* Students and live applications first. Counting accounts three ways
           and never mentioning a student is a maintenance screen, not a
           morning one; the account figures moved down to where they belong. */
        meta={[
          { label: "Live applications", value: liveApplications },
          { label: "Past the service level", value: late.total },
          { label: "Moves today", value: today.moves },
          { label: "Branches", value: orgCount },
          { label: "Accounts", value: snapshot.flags.total - snapshot.flags.inactive },
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

      {/*
        What the morning needs, then everything else a line at a time.

        This screen was nine panels of equal weight, all open, in two columns:
        every number the platform holds, shown at once, so none of them stood
        out and the ones that matter were somewhere in the middle. The shape
        below is the one the HR portal uses and it is the right one. What is
        wrong and what is live stay drawn. Everything else folds to a single
        row that says its own summary on the line, so the whole of it can be
        read without opening anything, and opened when there is a reason.
      */}
      <div className="space-y-5">
        {/*
          What is wrong, then where the work is.

          This used to lead with accounts: how many had never signed in and
          how many were on a temporary password. That is housekeeping, not a
          morning. It is still here, under Accounts that need an owner, which
          is the same people and says how many on its line.
        */}
        <AlertTiles
          allClear="Nothing is late and nothing is unclaimed."
          tiles={[
            { label: "Past the service level", nothing: "past the service level", value: late.total, tone: "stop", note: "Sitting longer than the lane allows", href: "/admin/queue" },
            { label: "Nobody has picked up", nothing: "unclaimed", value: load.unassigned, tone: "warn", note: "Live and with no officer", href: "/applications?assignedTo=none" },
          ]}
        />

        {/* The lanes an application actually moves through, in the order it
            moves through them, named as the portal names them everywhere
            else. Drawn in full every day, a nought dimmed rather than gone. */}
        <KpiBoard
          columns={3}
          tiles={[
            { label: GROUP_LABEL.NEW, value: groups.NEW, tone: "brand", href: "/applications?group=NEW", note: "Waiting to be assessed" },
            { label: GROUP_LABEL.PENDING_PARTNER, value: groups.PENDING_PARTNER, tone: "warn", href: "/applications?group=PENDING_PARTNER", note: "Held up at a branch" },
            { label: GROUP_LABEL.IN_PROGRESS, value: groups.IN_PROGRESS, tone: "info", href: "/applications?group=IN_PROGRESS", note: "With the desk" },
            { label: GROUP_LABEL.OFFER, value: groups.OFFER, tone: "good", href: "/applications?group=OFFER", note: "Offer or contract in hand" },
            { label: GROUP_LABEL.SUCCESS, value: groups.SUCCESS, tone: "good", href: "/applications?group=SUCCESS", note: "Visa received or deployed" },
            { label: GROUP_LABEL.HOLD, value: groups.HOLD, tone: "warn", href: "/applications?group=HOLD", note: "Deferred or waiting on an intake" },
          ]}
        />

        <h2 className="pt-1 text-[11px] font-semibold uppercase tracking-[0.13em] text-muted">More detail</h2>

        <Section
          id="attention"
          title="Accounts that need an owner"
          meta={
            attention.length === 0
              ? "every account is in good shape"
              : `${attention.length} on a temporary password, never used, or switched off`
          }
          defaultOpen={false}
          bodyClassName=""
        >
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
                    <Td>
                      <Chip tone={r.role === "SUPER_ADMIN" ? "gold" : r.role === "OPS_MANAGER" ? "warn" : r.role === "ADMIN" ? "brand" : "neutral"}>
                        {ROLE_LABEL[r.role] ?? r.role}
                      </Chip>
                    </Td>
                    <Td className="max-w-[14rem] truncate text-[13px]" title={r.orgName}>{r.orgName}</Td>
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
        </Section>

        <Section
          id="watching"
          title="Actions worth watching"
          meta={sensitive.length === 0 ? "nothing sensitive recorded yet" : `${sensitive.length} passport reveals, deletions and exports`}
          defaultOpen={false}
          bodyClassName=""
        >
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
        </Section>

        <Section
          id="funnel"
          title="Business funnel"
          meta={steps.map((x) => `${x.value} ${x.label.toLowerCase()}`).slice(0, 3).join(" · ")}
          defaultOpen={false}
        >
          <FunnelSteps steps={steps} />
        </Section>

        <Section
          id="people"
          title="Accounts by role"
          meta={`${snapshot.flags.total - snapshot.flags.inactive} active${snapshot.flags.inactive ? `, ${snapshot.flags.inactive} switched off` : ""}`}
          defaultOpen={false}
          bodyClassName=""
        >
          <DataList
            rows={[
              { label: "Super admin", value: snapshot.roles.SUPER_ADMIN ?? 0 },
              { label: "Ops manager", value: snapshot.roles.OPS_MANAGER ?? 0 },
              { label: "Overseas admin", value: snapshot.roles.ADMIN ?? 0 },
              { label: "Documentation team", value: snapshot.roles.DOCUMENTATION ?? 0 },
              { label: "Management", value: snapshot.roles.MANAGEMENT ?? 0 },
              { label: "Branch head", value: snapshot.roles.PARTNER ?? 0 },
              { label: "Counsellor", value: snapshot.roles.COUNSELLOR ?? 0 },
              { label: "Student portal", value: snapshot.roles.STUDENT ?? 0 },
              { label: "Switched off", value: snapshot.flags.inactive, tone: snapshot.flags.inactive ? "warn" : undefined },
            ]}
          />
        </Section>

        <Section
          id="partners"
          title="Busiest partners"
          meta={partners.length === 0 ? "no applications yet" : `${partners[0].name} leads with ${partners[0].total}`}
          defaultOpen={false}
          bodyClassName=""
        >
          <BarList items={partners.map((p) => ({ label: p.name, hint: p.tier, value: p.total, href: `/applications?org=${p.id}` }))} />
        </Section>

        <Section
          id="activity"
          title="Recorded activity"
          meta="the last seven days, by what was done"
          defaultOpen={false}
          bodyClassName=""
        >
          <BarList
            items={snapshot.auditByAction.map((r) => ({ label: actionLabel(r.action), value: r.value }))}
            tone="brand"
            empty="Nothing recorded in the last week."
          />
        </Section>

        <Section
          id="platform"
          title="Platform state"
          meta={[
            backend === "supabase" ? "Supabase storage" : "documents on local disk",
            `${snapshot.orgs.BRANCH ?? 0} branches`,
            snapshot.messages.failed ? `${snapshot.messages.failed} messages failed` : `${snapshot.messages.sent} messages sent`,
          ].join(" · ")}
          defaultOpen={false}
          bodyClassName=""
        >
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
        </Section>
      </div>
    </>
  );
}
