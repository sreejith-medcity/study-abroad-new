import Link from "next/link";
import type { Lens } from "@/server/dashboard-lens";
import { monthElapsed, monthText, setsBranchTargets, setsPeopleTargets, targetCard } from "@/server/targets";
import { Card, CardHeader } from "@/components/ui";
import { TargetBars, TargetRows } from "@/components/dashboard/role-pieces";

/**
 * This month's targets on a dashboard: every branch's for leadership, the
 * branch's own and its people's for a branch head, and a counsellor's own.
 * Whoever sets them gets the way to; a card with nothing set says so to them
 * and stays out of the way of everybody else.
 */
export async function TargetsCard({ lens, className }: { lens: Lens; className?: string }) {
  const card = await targetCard(lens);
  if (!card) return null;
  const elapsed = monthElapsed(card.month);
  const mayEdit = card.kind === "branches" ? setsBranchTargets(lens.user) : card.kind === "branch" ? setsPeopleTargets(lens.user) : false;
  const nothingSet = card.kind === "branches" ? card.rows.length === 0 : card.own.every((p) => p.target == null) && card.rows.length === 0;
  if (nothingSet && !mayEdit) return null;
  const title = card.kind === "person" ? `My targets for ${monthText(card.month)}` : `Targets for ${monthText(card.month)}`;
  return (
    <Card className={className} data-targets>
      <CardHeader
        title={title}
        subtitle={`${Math.round(elapsed * 100)}% of the month gone; the thin line on each bar marks it`}
        action={
          mayEdit ? (
            <Link href="/targets" className="text-xs font-medium text-brand-700 hover:underline">
              Set targets
            </Link>
          ) : undefined
        }
      />
      {nothingSet ? (
        <p className="px-4 py-6 text-sm text-muted">No targets are set for this month yet.</p>
      ) : (
        <>
          {card.kind !== "branches" && (
            <div className="px-4 py-4">
              {card.kind === "branch" && <p className="mb-2 text-sm font-semibold text-ink">The branch</p>}
              <TargetBars progress={card.own} elapsed={elapsed} />
            </div>
          )}
          {card.rows.length > 0 && (
            <div className={card.kind !== "branches" ? "border-t border-line" : undefined}>
              <TargetRows rows={card.rows} elapsed={elapsed} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
