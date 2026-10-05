import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { inr } from "@/lib/money";
import { stageLabel } from "@/lib/journey";
import { EARNING_STATE_LABEL, EARNING_STATE_MEANS, REFERRAL_STAGE_LABEL, rateText } from "@/lib/agents";
import { earningTotals, effectiveRate, mouStanding, referralCounts, referralsFor } from "@/server/agents";
import { getSettings } from "@/server/settings";
import { Alert, Card, CardHeader, Chip, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { IconPartners } from "@/components/icons";
import { ReferForm } from "@/components/agent-forms";
import type { ReferralEarningState } from "@/db/schema";
import { PARTNER_ROLES } from "@/lib/permissions";

export const metadata = { title: "Referrals" };
export const dynamic = "force-dynamic";

const STATE_TONE: Record<ReferralEarningState, "neutral" | "ok" | "warn" | "bad"> = {
  PENDING: "neutral",
  PAYABLE: "ok",
  PAID: "neutral",
  CANCELLED: "bad",
};

/**
 * A sub-agent's own page: who they have sent, where each one got to, and what it
 * has earned.
 *
 * What is deliberately not here is the student's file. A sub-agent sees the
 * stage and who is holding it, because that is what they need to tell a family;
 * they do not see documents, notes, fees or anybody else's students.
 */
export default async function ReferralsPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const user = await requireUser([...PARTNER_ROLES]);
  const sp = await searchParams;
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) });
  const isSubAgent = org?.type === "SUB_AGENT";

  const [rows, counts, totals, rate, mou, settings] = await Promise.all([
    referralsFor(user.orgId),
    referralCounts(user.orgId),
    earningTotals(user.orgId),
    effectiveRate(user.orgId),
    mouStanding(user.orgId),
    getSettings(),
  ]);

  const mouBlocks = settings.requireMouBeforePortal && !!mou.version && !mou.accepted;

  return (
    <>
      <PageHeader
        title="Referrals"
        subtitle={
          isSubAgent
            ? "Students you have sent to Medcity. The Overseas team works them; you can see where each one has got to."
            : "This page is for sub-agents. Your branch registers students of its own under Students."
        }
      />

      {sp.sent === "1" && (
        <Alert tone="ok" title="Sent">
          The Overseas team has it. Somebody will call them within a day, and this page shows what happens next.
        </Alert>
      )}

      {mouBlocks && (
        <Alert tone="warn" title="Accept the agreement first">
          A new version of the agreement is waiting. Read it on the Agreement page and accept it, then you can send referrals again.
        </Alert>
      )}

      {!isSubAgent ? (
        <Card>
          <EmptyState title="Not a sub-agent" icon={<IconPartners className="size-5" />}>
            Your organisation is a branch, so you register students yourself rather than referring them. Students is where that starts.
          </EmptyState>
        </Card>
      ) : (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Sent altogether" value={counts.total} />
            <Stat label="Being worked" value={counts.working} tone="info" />
            <Stat label="Registered as students" value={counts.registered} tone="good" />
            <Stat
              label="Ready to withdraw"
              value={totals.payable.unpriced > 0 ? `${inr(totals.payable.known)} + ${totals.payable.unpriced} not priced` : inr(totals.payable.known)}
              tone="good"
              href="/wallet"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Everybody you have sent" subtitle={`${rows.length}`} />
              {rows.length === 0 ? (
                <EmptyState title="Nobody yet" icon={<IconPartners className="size-5" />}>
                  Send your first referral with the form beside this. You need their name and a number; everything else helps but can wait.
                </EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Person</Th>
                      <Th>Where it stands</Th>
                      <Th>Held by</Th>
                      <Th>Earned</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <Td>
                          <span className="font-medium text-ink">{r.name}</span>
                          <span className="block text-xs text-muted tabular">{r.phone}</span>
                          {r.medcityId && <span className="block font-mono text-[11px] text-muted">{r.medcityId}</span>}
                        </Td>
                        <Td>
                          <span className="text-[13px]">{REFERRAL_STAGE_LABEL[r.stage] ?? r.stage}</span>
                          {r.journeyStage && <span className="block text-xs text-muted">{stageLabel(r.journeyStage)}</span>}
                          {r.stage === "LOST" && r.lostReason && <span className="block text-xs text-muted">{r.lostReason}</span>}
                        </Td>
                        <Td className="text-[13px] text-muted">{r.heldBy ?? "Not assigned yet"}</Td>
                        <Td>
                          {r.earningState ? (
                            <>
                              <Chip tone={STATE_TONE[r.earningState]}>{EARNING_STATE_LABEL[r.earningState]}</Chip>
                              <span className="block text-xs text-muted tabular">{r.earningAmount == null ? "Not recorded" : inr(r.earningAmount)}</span>
                            </>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <div className="space-y-4">
              <Card className="p-4">
                <h2 className="mb-1 font-semibold text-ink">Refer somebody</h2>
                <p className="mb-3 text-[13px] leading-relaxed text-muted">
                  A name and a number is enough to start. Medcity rings them, and you can watch the rest here.
                </p>
                <ReferForm />
              </Card>

              <Card className="p-4">
                <h2 className="mb-1 font-semibold text-ink">What you are paid</h2>
                <p className="text-[13px] text-ink-soft">{rateText(rate)}</p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  {rate
                    ? "A referral is credited to your wallet once Medcity has actually been paid for that student, not when they are registered."
                    : "The Overseas team has not set your rate yet. Ask them before you start sending people, so there is no argument later."}
                </p>
                <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-[12.5px]">
                  {(Object.keys(EARNING_STATE_LABEL) as ReferralEarningState[]).map((k) => (
                    <div key={k}>
                      <dt className="font-medium text-ink">{EARNING_STATE_LABEL[k]}</dt>
                      <dd className="text-muted">{EARNING_STATE_MEANS[k]}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              {mou.version && (
                <Card className="p-4">
                  <h2 className="font-semibold text-ink">The agreement</h2>
                  <p className="mt-1 text-[13px] text-muted">
                    {mou.accepted
                      ? `You accepted ${mou.version.version} on ${fmtDate(mou.acceptance!.createdAt)}.`
                      : `${mou.version.version} is waiting to be accepted.`}
                  </p>
                  <a href="/agreement" className="mt-2 inline-block text-[13px] font-medium text-brand-600 hover:underline">
                    Read it
                  </a>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
