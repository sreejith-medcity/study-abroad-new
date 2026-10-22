import Link from "next/link";
import { inrShort } from "@/lib/money";
import { AGE_LABEL } from "@/lib/invoicing";
import { moneyFigures } from "@/server/dashboard-money";
import { MONTHS } from "@/lib/format";
import { PERIODS, type Lens } from "@/server/dashboard-lens";
import { Card, CardHeader } from "@/components/ui";
import { AreaLine, AttentionList, ExecHero, Gauge, MiniTiles, shortDate } from "@/components/dashboard/role-pieces";
import { Controls, ViewingAsNote, firstName, partOfDay, periodLinks } from "./controls";

/**
 * The finance desk's dashboard, as an executive summary about money and
 * nothing else: no students, no applications, no documents, which is the
 * finance role's own rule.
 *
 * The band says what has been earned and not yet invoiced, what is ready to
 * invoice, what has gone out and not come back, and what came in over the
 * period, with a gauge of how much of what is owed has been collected. Under
 * it, what needs chasing, the year's money month by month, the ageing, and
 * the latest money in.
 */
export default async function Finance({ lens, sp }: { lens: Lens; sp: Record<string, string | string[] | undefined> }) {
  const { user } = lens;
  const m = await moneyFigures(lens);
  const when = PERIODS.find(([k]) => k === lens.period)?.[1] ?? "All time";
  const change = (() => {
    if (m.received.before === null || !lens.versus) return undefined;
    const d = m.received.inr - m.received.before;
    return d === 0 ? `No change ${lens.versus}` : `${d > 0 ? "+" : "−"}${inrShort(Math.abs(d))} ${lens.versus}`;
  })();
  const labels = new Map(
    m.months.map((p) => {
      const mo = Number(p.key.slice(5, 7)) - 1;
      return [p.key, MONTHS[mo]];
    }),
  );
  const maxBucket = Math.max(...m.buckets.map((b) => b.inr), 1);

  return (
    <>
      <ViewingAsNote lens={lens} />
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <Controls lens={lens} periods={false} />
      </div>
      <ExecHero
        eyebrow={`Finance · ${when}`}
        greeting={`${partOfDay()}, ${firstName(user.name)}`}
        line="In rupees, at the rates kept in settings."
        periods={periodLinks(lens, sp)}
        figures={[
          { slug: "earned-not-invoiced", label: "Earned, not invoiced", value: inrShort(m.expected), note: "Commission still expected", href: "/admin/commission?status=EXPECTED" },
          {
            slug: "ready-to-invoice",
            label: "Ready to invoice",
            value: m.ready.lines.toLocaleString("en-IN"),
            note: m.ready.lines > 0 ? `${inrShort(m.ready.inr)} across them` : "Nothing ready yet",
            href: "/admin/invoices?tab=queue",
          },
          { slug: "outstanding", label: "Invoiced, not paid", value: inrShort(m.outstanding.inr), note: `${m.outstanding.invoices} ${m.outstanding.invoices === 1 ? "invoice" : "invoices"}`, href: "/admin/invoices?tab=ageing" },
          { slug: "received", label: lens.period === "all" ? "Received" : `Received, ${when.toLowerCase()}`, value: inrShort(m.received.inr), note: change, href: "/admin/invoices?tab=invoices&state=PAID" },
        ]}
        gauge={
          <Gauge
            label="Collected of what was invoiced"
            value={m.received.inr}
            of={m.received.inr + m.outstanding.inr}
            middle={m.received.inr + m.outstanding.inr > 0 ? `${Math.round((m.received.inr / (m.received.inr + m.outstanding.inr)) * 100)}%` : "–"}
            under={`${inrShort(m.outstanding.inr)} still to come`}
          />
        }
      />

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="Money in, last twelve months" subtitle="Payments recorded against invoices, in rupees" />
          <div className="p-4">
            <AreaLine money points={m.months.map((p) => ({ key: p.key, label: labels.get(p.key) ?? p.key, value: p.value }))} />
          </div>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Needs attention" subtitle="What only finance can move" />
          <AttentionList
            rows={[
              { slug: "late-invoices", value: m.late.invoices, label: "Invoices past due", note: `${inrShort(m.late.inr)} late`, tone: "stop", href: "/admin/invoices?tab=ageing", action: "Chase now" },
              { slug: "ready-lines", value: m.ready.lines, label: "Ready to invoice", note: `${inrShort(m.ready.inr)} can go out today`, tone: "warn", href: "/admin/invoices?tab=queue", action: "Raise" },
              { slug: "payouts", value: m.payouts.n, label: "Payouts asked for", note: `${inrShort(m.payouts.inr)} to branches and partners`, tone: "info", href: "/admin/commission?tab=payouts", action: "Decide" },
              { slug: "disputed", value: m.disputed, label: "Disputed invoices", note: "The vendor has said no", tone: "stop", href: "/admin/invoices?tab=invoices&state=DISPUTED", action: "See them" },
            ]}
          />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader title="How late the money is" subtitle="What is owed on invoices that have gone out, by how far past due" action={<Link href="/admin/invoices?tab=ageing" className="text-xs font-medium text-brand-700 hover:underline">Ageing report</Link>} />
          <ul data-ageing className="space-y-3 p-4">
            {m.buckets.map((b) => (
              <li key={b.bucket} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
                <span className="truncate text-sm text-ink-soft">{AGE_LABEL[b.bucket]}</span>
                <span className="h-3 rounded-full bg-surface-2 ring-1 ring-inset ring-line">
                  <span
                    className={b.bucket === "NOT_DUE" ? "block h-full rounded-full bg-good-500" : b.bucket === "DUE" || b.bucket === "LATE_30" ? "block h-full rounded-full bg-warn-500" : "block h-full rounded-full bg-stop-500"}
                    style={{ width: `${b.inr > 0 ? Math.max(3, (b.inr / maxBucket) * 100) : 0}%` }}
                  />
                </span>
                <span className="text-right text-xs tabular text-ink">
                  <strong>{inrShort(b.inr)}</strong> <span className="text-muted">· {b.count}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <MiniTiles
          tiles={[
            { slug: "drafts", label: "Drafts", value: m.drafts, tone: "info", href: "/admin/invoices?tab=invoices&state=DRAFT" },
            { slug: "waiting-on-a-milestone", label: "Waiting on a milestone", value: m.ready.waiting, tone: "warn", href: "/admin/invoices?tab=queue" },
            { slug: "no-rate-recorded", label: "No rate recorded", value: m.ready.unpriced, tone: "stop", href: "/admin/invoices?tab=queue" },
            { slug: "credit-notes", label: lens.period === "all" ? "Credit notes" : "Credit notes, this period", value: m.credits, tone: "brand", href: "/admin/invoices?tab=invoices" },
          ]}
          cols={2}
        />
      </div>

      <Card className="mt-5">
        <CardHeader title="Latest money in" subtitle="Payments recorded against invoices, newest first" />
        {m.latest.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No payment has been recorded yet.</p>
        ) : (
          <ul>
            {m.latest.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-0">
                <span className="size-2 shrink-0 rounded-full bg-good-500" />
                <span className="min-w-0 flex-1">
                  <Link href={`/admin/invoices/${p.invoiceId}`} className="block truncate text-sm font-semibold text-ink hover:underline">
                    {p.vendor} paid {p.number}
                  </Link>
                  <span className="block text-xs text-muted">{shortDate(p.on)}</span>
                </span>
                <span className="text-sm font-semibold tabular text-ink">{inrShort(p.inr)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
