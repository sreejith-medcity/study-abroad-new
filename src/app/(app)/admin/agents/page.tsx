import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { inr } from "@/lib/money";
import { ADMIN_ROLES, isSuperAdmin } from "@/lib/permissions";
import { APPLICATION_STATUS_LABEL, EARNING_STATE_LABEL, FEE_KIND_LABEL, REFERRAL_STAGE_LABEL, rateText } from "@/lib/agents";
import {
  agentApplicationCounts,
  agentApplications,
  agreementStandings,
  allAgentRates,
  branchesForAssignment,
  mouAcceptanceCounts,
  mouVersions,
  readApplicationFilters,
  referralQueue,
  subAgents,
  unpricedEarnings,
} from "@/server/agents";
import { getSettings } from "@/server/settings";
import { publishMouAction } from "@/server/agent-actions";
import { Alert, Button, Card, CardHeader, Chip, EmptyState, Input, PageHeader, Select, Stat, Table, Td, Th, Toolbar, cn } from "@/components/ui";
import { IconPartners } from "@/components/icons";
import { AgentSettingsForm, ApproveForm, AssignReferral, CancelEarning, MouForm, PriceEarning, RateForm, RejectForm } from "@/components/agent-forms";
import { StartReview } from "./forms";
import type { AgentApplicationStatus } from "@/db/schema";

export const metadata = { title: "Sub-agents" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "applications", label: "Applications" },
  { key: "agents", label: "Sub-agents" },
  { key: "referrals", label: "Referrals" },
  { key: "agreement", label: "Agreement" },
] as const;

const STATUS_TONE: Record<AgentApplicationStatus, "neutral" | "info" | "ok" | "bad"> = {
  NEW: "info",
  REVIEWING: "neutral",
  APPROVED: "ok",
  REJECTED: "bad",
};

/**
 * The desk's side of the sub-agent module: who has applied, who is on the books,
 * what their referrals are doing, and the agreement they are held to.
 *
 * Four tabs rather than seven, because the work goes in that order: somebody
 * applies, becomes a sub-agent, sends leads, and is paid under an agreement.
 */
export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser([...ADMIN_ROLES]);
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as string) : "applications";
  const filters = readApplicationFilters(sp);

  const [counts, settings] = await Promise.all([agentApplicationCounts(), getSettings()]);
  const branches = await branchesForAssignment();

  return (
    <>
      <PageHeader
        title="Sub-agents"
        subtitle="People who send Medcity students rather than working them. They apply, accept the agreement, refer, and are paid once Medcity has been paid."
        actions={
          <Link href="/join" className="text-[13px] font-medium text-brand-600 hover:underline">
            See the public form
          </Link>
        }
      />

      <div className="mb-4 flex gap-6 border-b border-line">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/agents?tab=${t.key}`}
            className={cn("-mb-px border-b-2 py-2 font-medium", t.key === tab ? "border-brand-600 text-brand-600" : "border-transparent text-muted hover:text-ink")}
          >
            {t.label}
            {t.key === "applications" && counts.new > 0 ? ` (${counts.new})` : ""}
          </Link>
        ))}
      </div>

      {!settings.agentSignupOpen && (
        <Alert tone="warn" title="The application form is shut">
          Anybody opening the link is told to try later. Switch it back on under Agreement when the desk can keep up.
        </Alert>
      )}

      {tab === "applications" && <Applications filters={filters} counts={counts} branches={branches} />}
      {tab === "agents" && <Agents />}
      {tab === "referrals" && <Referrals branches={branches} />}
      {tab === "agreement" && <Agreement superAdmin={isSuperAdmin(user)} settings={settings} />}
    </>
  );
}

// ---------- Applications ----------

async function Applications({
  filters,
  counts,
  branches,
}: {
  filters: ReturnType<typeof readApplicationFilters>;
  counts: Awaited<ReturnType<typeof agentApplicationCounts>>;
  branches: { id: string; name: string; city: string | null }[];
}) {
  const rows = await agentApplications(filters);

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New" value={counts.new} tone="warn" href="/admin/agents?tab=applications&status=NEW" />
        <Stat label="Being looked at" value={counts.reviewing} tone="info" href="/admin/agents?tab=applications&status=REVIEWING" />
        <Stat label="Approved" value={counts.approved} tone="good" href="/admin/agents?tab=applications&status=APPROVED" />
        <Stat label="Turned down" value={counts.rejected} href="/admin/agents?tab=applications&status=REJECTED" />
      </div>

      <Toolbar className="mb-4">
        <form className="grid gap-2.5 sm:grid-cols-3">
          <input type="hidden" name="tab" value="applications" />
          <Select name="status" aria-label="Status" defaultValue={filters.status ?? ""}>
            <option value="">Every status</option>
            {(Object.keys(APPLICATION_STATUS_LABEL) as AgentApplicationStatus[]).map((k) => (
              <option key={k} value={k}>
                {APPLICATION_STATUS_LABEL[k]}
              </option>
            ))}
          </Select>
          <Input name="q" placeholder="Name, firm, phone or email" aria-label="Search" defaultValue={filters.q} />
          <Button variant="secondary">Filter</Button>
        </form>
      </Toolbar>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No applications" icon={<IconPartners className="size-5" />}>
            The public form is at /join. Send the link to anybody who asks about working with Medcity.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <Table tableClassName="min-w-[900px]">
            <thead>
              <tr>
                <Th>Who</Th>
                <Th>Where</Th>
                <Th>About them</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="font-medium text-ink">{r.contactName}</span>
                    {r.firmName && <span className="block text-xs text-muted">{r.firmName}</span>}
                    <span className="block text-xs text-muted tabular">{r.phone}</span>
                    <span className="block break-all text-xs text-muted">{r.email}</span>
                  </Td>
                  <Td className="text-[13px] text-muted">
                    {[r.city, r.state].filter(Boolean).join(", ") || "Not given"}
                    {r.referredBy && <span className="block text-xs">Via {r.referredBy}</span>}
                    <span className="block text-xs">Applied {fmtDate(r.createdAt)}</span>
                  </Td>
                  <Td className="max-w-[22rem] text-[12.5px] leading-relaxed text-ink-soft">{r.aboutThem ?? <span className="text-muted">Nothing written</span>}</Td>
                  <Td>
                    <Chip tone={STATUS_TONE[r.status]}>{APPLICATION_STATUS_LABEL[r.status]}</Chip>
                    {r.decisionNote && <p className="mt-1 max-w-[16rem] text-xs text-muted">{r.decisionNote}</p>}
                    {r.orgId && (
                      <Link href="/admin/agents?tab=agents" className="mt-1 block text-xs font-medium text-brand-600 hover:underline">
                        On the books
                      </Link>
                    )}
                  </Td>
                  <Td>
                    {r.status === "APPROVED" ? (
                      <span className="text-xs text-muted">Done {r.reviewedAt ? fmtDate(r.reviewedAt) : ""}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {r.status === "NEW" && <StartReview applicationId={r.id} />}
                        <ApproveForm applicationId={r.id} suggestedName={r.firmName ?? r.contactName} branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
                        {r.status !== "REJECTED" && <RejectForm applicationId={r.id} />}
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

// ---------- Sub-agents and their rates ----------

async function Agents() {
  const [rows, rates] = await Promise.all([subAgents(), allAgentRates()]);
  const platform = rates.filter((r) => !r.orgId);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="On the books" subtitle={`${rows.length}`} />
        {rows.length === 0 ? (
          <EmptyState title="No sub-agents yet" icon={<IconPartners className="size-5" />}>
            Approve an application and the organisation is created here.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[820px]">
            <thead>
              <tr>
                <Th>Sub-agent</Th>
                <Th>Under</Th>
                <Th className="text-right">Referred</Th>
                <Th className="text-right">Registered</Th>
                <Th className="text-right">Earned</Th>
                <Th className="text-right">Balance</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className={r.active ? "font-medium text-ink" : "text-muted line-through"}>{r.name}</span>
                    {r.idCode && <span className="ml-1.5 font-mono text-[11px] text-muted">{r.idCode}</span>}
                    {r.city && <span className="block text-xs text-muted">{r.city}</span>}
                  </Td>
                  <Td className="text-[13px] text-muted">{r.parentName ?? "Nobody in particular"}</Td>
                  <Td className="text-right tabular">{r.referrals}</Td>
                  <Td className="text-right tabular">{r.registered}</Td>
                  <Td className="text-right tabular">{inr(r.earned)}</Td>
                  <Td className="text-right font-medium tabular">{inr(r.balance)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Referral rates"
            subtitle="Added rather than edited, so a figure that was in force when an earning was worked out can still be read back"
          />
          {platform.length === 0 && (
            <Alert tone="warn" title="No platform rate">
              Until a rate is set, a referral is credited with no figure on it and reads as &quot;Not recorded&quot;. Set one before sub-agents start sending people.
            </Alert>
          )}
          {rates.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted">Nothing set yet.</p>
          ) : (
            <Table tableClassName="min-w-[620px]">
              <thead>
                <tr>
                  <Th>Who</Th>
                  <Th>How</Th>
                  <Th>From</Th>
                  <Th>Set by</Th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium">{r.org?.name ?? "Every sub-agent"}</Td>
                    <Td className="text-[13px]">
                      {rateText({ id: r.id, orgId: r.orgId, kind: r.kind, percent: r.percent, flatAmountInr: r.flatAmountInr, activeFrom: r.activeFrom })}
                      <span className="block text-xs text-muted">{FEE_KIND_LABEL[r.kind]}</span>
                      {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                    </Td>
                    <Td className="whitespace-nowrap tabular text-[13px]">{fmtDate(r.activeFrom)}</Td>
                    <Td className="text-[13px] text-muted">{r.createdBy?.name ?? "Unknown"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 font-semibold text-ink">Add a rate</h2>
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            A share is taken of the commission Medcity received for that student. A rate for one sub-agent beats the platform rate, however old it is.
          </p>
          <RateForm agents={(await subAgents()).map((a) => ({ id: a.id, name: a.name }))} />
        </Card>
      </div>
    </div>
  );
}

// ---------- Referrals and earnings ----------

async function Referrals({ branches }: { branches: { id: string; name: string; city: string | null }[] }) {
  const [queue, unpriced] = await Promise.all([referralQueue(), unpricedEarnings()]);
  const waiting = queue.filter((r) => r.withTheDesk && !r.studentId);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Waiting for a branch"
          subtitle={`${waiting.length} · a referral the desk has not passed on is a referral nobody is working`}
        />
        {waiting.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted">Everything a sub-agent has sent is with a branch.</p>
        ) : (
          <Table tableClassName="min-w-[860px]">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>From</Th>
                <Th>What they want</Th>
                <Th>Give it to</Th>
              </tr>
            </thead>
            <tbody>
              {waiting.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="font-medium text-ink">{r.name}</span>
                    <span className="block text-xs text-muted tabular">{r.phone}</span>
                    <span className="block text-xs text-muted">Sent {fmtDate(r.createdAt)}</span>
                  </Td>
                  <Td className="text-[13px]">{r.agentName}</Td>
                  <Td className="max-w-[20rem] text-[12.5px] text-ink-soft">
                    {[r.interestCountry, r.interestPathway].filter(Boolean).join(" · ") || "Not said"}
                    {r.notes && <span className="block text-muted">{r.notes}</span>}
                  </Td>
                  <Td>
                    <AssignReferral enquiryId={r.id} branches={branches} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Earnings with no figure on them" subtitle={`${unpriced.length} · a sub-agent reads these as "Not recorded" until somebody sets them`} />
        {unpriced.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted">Every referral earning has an amount.</p>
        ) : (
          <Table tableClassName="min-w-[760px]">
            <thead>
              <tr>
                <Th>Sub-agent</Th>
                <Th>Student</Th>
                <Th>State</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {unpriced.map((e) => (
                <tr key={e.id}>
                  <Td className="font-medium">{e.orgName}</Td>
                  <Td>
                    {e.studentName}
                    {e.medcityId && <span className="block font-mono text-[11px] text-muted">{e.medcityId}</span>}
                  </Td>
                  <Td>
                    <Chip tone={e.state === "PAYABLE" ? "ok" : "neutral"}>{EARNING_STATE_LABEL[e.state]}</Chip>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      <PriceEarning earningId={e.id} />
                      <CancelEarning earningId={e.id} />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Everything referred" subtitle={`${queue.length}`} />
        {queue.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted">No sub-agent has sent anybody yet.</p>
        ) : (
          <Table tableClassName="min-w-[820px]">
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>From</Th>
                <Th>Held by</Th>
                <Th>Stage</Th>
              </tr>
            </thead>
            <tbody>
              {queue.map((r) => (
                <tr key={r.id}>
                  <Td>
                    {r.studentId ? (
                      <Link href={`/students/${r.studentId}/profile`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <Link href={`/enquiries/${r.id}`} className="font-medium text-ink hover:text-brand-600 hover:underline">
                        {r.name}
                      </Link>
                    )}
                    <span className="block text-xs text-muted tabular">{r.phone}</span>
                  </Td>
                  <Td className="text-[13px]">{r.agentName}</Td>
                  <Td className="text-[13px] text-muted">
                    {r.ownerName}
                    {r.withTheDesk && <Chip tone="warn" className="ml-1.5">The desk</Chip>}
                  </Td>
                  <Td className="text-[13px]">{REFERRAL_STAGE_LABEL[r.stage] ?? r.stage}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ---------- The agreement and the switches ----------

async function Agreement({ superAdmin, settings }: { superAdmin: boolean; settings: Awaited<ReturnType<typeof getSettings>> }) {
  const [versions, acceptedCounts, standings] = await Promise.all([mouVersions(), mouAcceptanceCounts(), agreementStandings()]);
  const notAccepted = standings.rows.filter((r) => r.active && !r.acceptedAt);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Versions"
          subtitle="Added, never edited. Somebody accepted particular words on a particular day, and those words stay as they were."
          action={superAdmin ? <MouForm /> : undefined}
        />
        {versions.length === 0 ? (
          <EmptyState title="Nothing published" icon={<IconPartners className="size-5" />}>
            Until an agreement is published, nothing is asked of a sub-agent and the agreement condition on a withdrawal cannot hold anybody up.
          </EmptyState>
        ) : (
          <Table tableClassName="min-w-[700px]">
            <thead>
              <tr>
                <Th>Version</Th>
                <Th>Title</Th>
                <Th>In force from</Th>
                <Th className="text-right">Accepted by</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <Td>
                    <span className="font-medium">{v.version}</span>
                    {v.active && (
                      <Chip tone="ok" className="ml-1.5">
                        Being asked for
                      </Chip>
                    )}
                  </Td>
                  <Td className="text-[13px]">{v.title}</Td>
                  <Td className="whitespace-nowrap tabular text-[13px]">{v.effectiveFrom ? fmtDate(v.effectiveFrom) : "Not said"}</Td>
                  <Td className="text-right tabular">{acceptedCounts[v.id] ?? 0}</Td>
                  <Td>
                    {!v.active && superAdmin && (
                      <form action={publishMouAction}>
                        <input type="hidden" name="versionId" value={v.id} />
                        <Button variant="quiet" className="py-1 text-xs">
                          Publish it
                        </Button>
                      </form>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="Who has accepted"
            subtitle={standings.version ? `${standings.version.version} · ${notAccepted.length} still to accept` : "Nothing is being asked for"}
          />
          {standings.rows.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted">No sub-agents yet.</p>
          ) : (
            <Table tableClassName="min-w-[520px]">
              <thead>
                <tr>
                  <Th>Sub-agent</Th>
                  <Th>Accepted</Th>
                  <Th>By</Th>
                </tr>
              </thead>
              <tbody>
                {standings.rows.map((r) => (
                  <tr key={r.id}>
                    <Td className={r.active ? "font-medium" : "text-muted line-through"}>{r.name}</Td>
                    <Td className="whitespace-nowrap text-[13px]">
                      {r.acceptedAt ? <span className="tabular">{fmtDateTime(r.acceptedAt)}</span> : <Chip tone="warn">Not yet</Chip>}
                    </Td>
                    <Td className="text-[13px] text-muted">{r.acceptedName ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-1 font-semibold text-ink">How the module behaves</h2>
          <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
            {superAdmin ? "Only a super admin changes these." : "A super admin changes these."}
          </p>
          {superAdmin ? (
            <AgentSettingsForm signupOpen={settings.agentSignupOpen} requireMou={settings.requireMouBeforePortal} minimum={settings.minWithdrawalInr} />
          ) : (
            <dl className="space-y-2 text-[13px]">
              <div>
                <dt className="text-muted">The application form</dt>
                <dd className="font-medium">{settings.agentSignupOpen ? "Answers" : "Shut"}</dd>
              </div>
              <div>
                <dt className="text-muted">Agreement before referring</dt>
                <dd className="font-medium">{settings.requireMouBeforePortal ? "Required" : "Not required"}</dd>
              </div>
              <div>
                <dt className="text-muted">Smallest withdrawal</dt>
                <dd className="font-medium">{settings.minWithdrawalInr == null ? "No minimum" : inr(settings.minWithdrawalInr)}</dd>
              </div>
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
