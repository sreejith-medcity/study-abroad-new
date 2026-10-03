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
          title={
            (r.isDirect ? "Our own agreement with the university. " : "") +
            (r.commission.known ? `${r.name}: ${r.commission.basis}` : `${r.name}: ${r.commission.basis}, ${r.commission.reason.toLowerCase()}`)
          }
          // Our own agreements are marked rather than merely sorted first: a
          // counsellor scanning a page of results should be able to see which
          // road is ours without reading the order.
          className={
            r.isDirect
              ? "inline-flex items-center gap-1 rounded-full border border-good-500/40 bg-good-50 px-2 py-0.5 text-[11px] font-semibold text-good-700"
              : "inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-soft"
          }
        >
          <span className="size-2.5 rounded-sm" style={{ background: r.colour }} aria-hidden="true" />
          {r.code}
          {r.isDirect && <span className="font-normal">ours</span>}
          {showCommission && money && r.commission.known && <span className="tabular font-normal text-muted">{money(r.commission.amount, r.commission.currency)}</span>}
        </span>
      ))}
    </span>
  );
}
