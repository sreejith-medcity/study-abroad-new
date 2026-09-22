import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { daysLeft, promotionState, rangeText } from "@/lib/promotions";
import { commissionVisible } from "@/server/commission-visibility";
import { currentPromotions, pastPromotions } from "@/server/directory-queries";
import { Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Promotional schemes" };

export default async function PromotionsPage() {
  const user = await requireUser([...APP_ROLES]);
  if (!(await commissionVisible(user))) redirect("/dashboard");
  const [now, past] = await Promise.all([currentPromotions(), pastPromotions()]);
  return (
    <>
      <PageHeader title="Promotional schemes" subtitle="Incentives from Medcity Overseas on top of the usual commission. Read the terms: only placements that meet them count." />
      <div className="space-y-4">
        {now.length === 0 && (
          <Card>
            <EmptyState title="No scheme is running right now">You are told as soon as the next one is published.</EmptyState>
          </Card>
        )}
        {now.map((p) => {
          const st = promotionState(p.startsOn, p.endsOn);
          const left = daysLeft(p.endsOn);
          return (
            <Card key={p.id} id={p.id} className="scroll-mt-20">
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
                <div>
                  <h2 className="font-display text-[17px] font-semibold text-ink">{p.title}</h2>
                  <p className="text-[14px] font-medium text-emerald-700">{p.summary}</p>
                </div>
                {st === "running" ? <Chip tone={left <= 7 ? "warn" : "ok"}>{left === 1 ? "Last day" : `${left} days left`}</Chip> : <Chip tone="info">Starts soon</Chip>}
              </div>
              <p className="px-4 pt-1 text-xs text-muted">{rangeText(p.startsOn, p.endsOn)} · {p.countries.length ? p.countries.join(", ") : "All destinations"}</p>
              <div className="m-4 whitespace-pre-line rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-soft">{p.terms}</div>
            </Card>
          );
        })}
        {past.length > 0 && (
          <Card>
            <CardHeader title="Ended in the last year" />
            <ul className="divide-y divide-line">
              {past.map((p) => (
                <li key={p.id} className="px-4 py-2.5 text-[13px]">
                  <p className="font-medium text-ink">{p.title}</p>
                  <p className="text-muted">{p.summary} · {rangeText(p.startsOn, p.endsOn)}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
