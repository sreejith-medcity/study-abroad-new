import { Chip } from "./ui";
import type { RouteChip } from "@/server/vendors";

/**
 * The roads a course can be applied down, as they appear on a row.
 *
 * The colour never carries the meaning on its own: the vendor's code sits
 * beside it, so the row reads in black and white and to somebody who cannot
 * tell teal from green.
 */
export function RouteChips({ routes, showCommission, money }: { routes: RouteChip[] | undefined; showCommission?: boolean; money?: (amount: number, currency: string) => string }) {
  if (!routes?.length) return <Chip tone="warn">No route</Chip>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {routes.map((r) => (
        <span
          key={r.vendorId}
          title={r.commission.known ? `${r.name}: ${r.commission.basis}` : `${r.name}: ${r.commission.basis}, ${r.commission.reason.toLowerCase()}`}
          className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-soft"
        >
          <span className="size-2.5 rounded-sm" style={{ background: r.colour }} aria-hidden="true" />
          {r.code}
          {showCommission && money && r.commission.known && <span className="tabular font-normal text-muted">{money(r.commission.amount, r.commission.currency)}</span>}
        </span>
      ))}
    </span>
  );
}
