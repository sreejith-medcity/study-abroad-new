import Link from "next/link";
import { commissionVisible } from "@/server/commission-visibility";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { commissionTotals, inr, payoutList, walletBalance, walletLedger } from "@/server/commission";
import { Alert, Card, CardHeader, Chip, DataList, EmptyState, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { IconWallet, IconCheck, IconClock } from "@/components/icons";
import { PayoutForm, CancelPayoutButton } from "./forms";

export const metadata = { title: "Wallet" };

const KIND_LABEL: Record<string, string> = {
  COMMISSION: "Commission",
  PAYOUT: "Payout",
  BONUS: "Bonus",
  ADJUSTMENT: "Adjustment",
};

const PAYOUT_TONE: Record<string, "neutral" | "info" | "ok" | "bad"> = {
  REQUESTED: "info",
  APPROVED: "neutral",
  PAID: "ok",
  REJECTED: "bad",
};

export default async function WalletPage() {
  const user = await requireUser(["PARTNER", "COUNSELLOR"]);
  if (!(await commissionVisible(user))) {
    const { redirect } = await import("next/navigation");
    redirect("/dashboard");
  }
  const [wallet, ledger, payouts, totals, org] = await Promise.all([
    walletBalance(user.orgId),
    walletLedger(user.orgId, 40),
    payoutList(user.orgId, 10),
    commissionTotals(user),
    db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId) }),
  ]);

  const pending = payouts.find((p) => p.status === "REQUESTED");
  const owner = user.role === "PARTNER";
  const companies = owner
    ? await db.query.billingCompanies.findMany({ where: eq(schema.billingCompanies.orgId, user.orgId), columns: { id: true, legalName: true, gstin: true, isDefault: true } })
    : [];
  const inFlight = totals.EXPECTED.partner + totals.INVOICED.partner + totals.RECEIVED.partner;

  return (
    <>
      <PageHeader
        title="Wallet"
        subtitle={`${org?.name ?? "Your branch"}'s account with Medcity Overseas. Commission lands here once the institution pays.`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available balance" tone="brand" icon={<IconWallet className="size-4" />} value={inr(wallet.balance)} />
        <Stat label="Still to come" tone="warn" icon={<IconClock className="size-4" />} value={inr(inFlight)} href="/commission" />
        <Stat label="Credited so far" tone="good" icon={<IconCheck className="size-4" />} value={inr(wallet.credited)} />
        <Stat label="Paid out" tone="info" value={inr(wallet.paidOut)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            title="Ledger"
            subtitle="Every credit and payout, newest first"
            action={<Link href="/commission" className="text-[13px] font-medium text-brand-600 hover:underline">Commission statement</Link>}
          />
          {ledger.length === 0 ? (
            <EmptyState title="Nothing in the wallet yet" icon={<IconWallet className="size-5" />}>
              Commission is credited once Medcity receives it from the institution and settles your share.
            </EmptyState>
          ) : (
            <Table tableClassName="min-w-[560px]">
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Entry</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap text-muted">{fmtDate(l.createdAt)}</Td>
                    <Td>
                      <Chip tone={l.amountInr >= 0 ? "ok" : "neutral"}>{KIND_LABEL[l.kind] ?? l.kind}</Chip>
                      {l.note && <p className="mt-1 text-xs text-muted">{l.note}</p>}
                    </Td>
                    <Td className="text-[13px] text-muted">{l.reference ?? "None"}</Td>
                    <Td className={`whitespace-nowrap text-right font-semibold tabular ${l.amountInr >= 0 ? "text-good-700" : "text-ink"}`}>
                      {l.amountInr >= 0 ? "+" : "-"}
                      {inr(Math.abs(l.amountInr))}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Withdraw" subtitle={owner ? "Ask the Overseas team to transfer your balance" : "Only the branch owner can request a payout"} />
            <div className="p-4 pt-0">
              {pending ? (
                <div className="space-y-3">
                  <Alert tone="info" title={`${inr(pending.amountInr)} requested`}>
                    Sent {fmtDate(pending.createdAt)}. The Overseas team will confirm the transfer.
                  </Alert>
                  {owner && <CancelPayoutButton payoutId={pending.id} />}
                </div>
              ) : owner ? (
                <>
                  <PayoutForm balance={wallet.balance} companies={companies.map((c) => ({ id: c.id, isDefault: c.isDefault, label: `${c.legalName}${c.gstin ? ` (GSTIN ${c.gstin})` : ""}` }))} />
                  {companies.length === 0 && (
                    <p className="mt-3 text-xs text-muted">
                      Add your billing company in <Link href="/settings/branch#billing" className="font-medium text-brand-600 hover:underline">Settings, Branch</Link> so the team knows where to pay and whether to add GST.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[13px] text-muted">Ask {org?.name ?? "your branch"}'s owner to request the transfer.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Commission in flight" subtitle="Your share, by stage" />
            <DataList
              rows={[
                { label: "Expected", value: inr(totals.EXPECTED.partner), href: "/commission?status=EXPECTED" },
                { label: "Invoiced", value: inr(totals.INVOICED.partner), href: "/commission?status=INVOICED" },
                { label: "Received by Medcity", value: inr(totals.RECEIVED.partner), href: "/commission?status=RECEIVED", tone: "warn" },
                { label: "Paid to you", value: inr(totals.SETTLED.partner), href: "/commission?status=SETTLED", tone: "ok" },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Payout history" subtitle="Last ten requests" />
            {payouts.length === 0 ? (
              <p className="px-4 py-8 text-center text-[13px] text-muted">No payouts requested yet.</p>
            ) : (
              <ul>
                {payouts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-0">
                    <div className="min-w-0">
                      <p className="font-semibold tabular">{inr(p.amountInr)}</p>
                      <p className="text-xs text-muted">{fmtDateTime(p.createdAt)}</p>
                    </div>
                    <Chip tone={PAYOUT_TONE[p.status] ?? "neutral"}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
