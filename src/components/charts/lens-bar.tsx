"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "../ui";

/**
 * What the dashboard is looking at: a period, and for the desk, a branch.
 *
 * The period is a row of links rather than buttons, so each is an address
 * that can be bookmarked or sent to somebody, and works before the script.
 * The branch is a select, because there are too many to lay out in a row.
 */
export function LensBar({
  periods,
  period,
  orgs,
  org,
  hidePeriods = false,
}: {
  periods: readonly (readonly [string, string])[];
  /** Where the period is picked somewhere else on the screen, as in the summary's band. */
  hidePeriods?: boolean;
  period: string;
  /** Empty for anybody who only sees their own. */
  orgs: { id: string; name: string; subAgent: boolean }[];
  org: string | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!hidePeriods && (
        <nav aria-label="Period" className="inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-inset ring-line">
          {periods.map(([k, label]) => (
            <Link
              key={k}
              href={href({ period: k === "all" ? null : k })}
              scroll={false}
              aria-current={period === k ? "page" : undefined}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", period === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
            >
              {label}
            </Link>
          ))}
        </nav>
      )}
      {orgs.length > 0 && (
        <select
          aria-label="Branch"
          value={org ?? ""}
          onChange={(e) => router.push(href({ org: e.target.value || null }), { scroll: false })}
          className="h-8 max-w-[15rem] rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink"
        >
          <option value="">All branches</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.subAgent ? " (sub-agent)" : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
