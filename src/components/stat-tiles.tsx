import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./ui";

/**
 * The board of figures a dashboard opens with.
 *
 * One small card per figure: an icon to find it by shape, what it is, the
 * figure, and underneath either how it moved against the stretch before or a
 * word on what the number does not say on its own, with the last year drawn
 * as a line where there is a year to draw. Each card is the way into its own
 * list, because a figure nobody can open is a figure nobody can act on.
 *
 * A nought keeps its place and its size, on a board read by position, and
 * steps back a shade so the eye lands on the numbers with something in them.
 */
/*
 * Each card is washed in its own tone, the way the references sent for this
 * draw it, so the board reads as colour at a glance rather than a grid of
 * white boxes. The icon sits on a surface-coloured chip on top of the wash,
 * which keeps it crisp in daylight and at night alike.
 */
const tileTone = {
  brand: { card: "bg-brand-50 border-brand-100", badge: "bg-surface text-brand-600", line: "text-brand-500" },
  info: { card: "bg-info-50 border-info-500/15", badge: "bg-surface text-info-500", line: "text-info-500" },
  good: { card: "bg-good-50 border-good-500/15", badge: "bg-surface text-good-500", line: "text-good-500" },
  warn: { card: "bg-warn-50 border-warn-500/15", badge: "bg-surface text-warn-500", line: "text-warn-500" },
  stop: { card: "bg-stop-50 border-stop-500/15", badge: "bg-surface text-stop-500", line: "text-stop-500" },
  gold: { card: "bg-gold-400/12 border-gold-500/25", badge: "bg-surface text-[#8a6d00]", line: "text-gold-500" },
} as const;

export type StatTile = {
  label: string;
  value: number | string;
  /** The line under the figure, for what the number does not say on its own. */
  note?: string;
  /** How it moved against the stretch before, and whether that is good news. */
  change?: { text: string; good: boolean | null };
  /** A year, a month at a time, for the line in the corner. */
  spark?: number[];
  /** A state of things now, which the period picker does not move. */
  now?: boolean;
  tone: keyof typeof tileTone;
  icon: ReactNode;
  href?: string;
};

/** A tile's own handle, so a suite can read one figure without counting cards. */
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A year as a line: no axes, no dots, only the shape, in the tile's colour. */
function Spark({ values, className }: { values: number[]; className: string }) {
  const W = 64;
  const H = 24;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (values.length < 2 || max === 0) return null;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / (max - min || 1)) * (H - 6)).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={cn("shrink-0", className)} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <div data-stat-tiles className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => {
        const nothing = t.value === 0 || t.value === "0";
        const tone = tileTone[t.tone];
        const body = (
          <>
            <span className="flex items-start gap-2">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg shadow-sm [&>svg]:size-[18px]", tone.badge)}>{t.icon}</span>
              <span className="min-w-0 flex-1 text-[0.8125rem] font-medium leading-tight text-ink-soft" title={t.label}>
                {t.label}
              </span>
            </span>
            <span className="mt-2.5 flex items-end justify-between gap-2">
              <span
                data-figure
                className={cn("min-w-0 truncate font-display text-[1.625rem] font-semibold leading-none tracking-[-0.03em]", nothing ? "text-ink-soft/70" : "text-ink")}
              >
                {t.value}
              </span>
              {t.spark ? (
                <Spark values={t.spark} className={tone.line} />
              ) : (
                t.now && (
                  <span
                    className="mb-0.5 shrink-0 rounded px-1 text-3xs font-semibold uppercase tracking-wider text-muted ring-1 ring-inset ring-line"
                    title="The state of things now; the period does not change it"
                  >
                    Now
                  </span>
                )
              )}
            </span>
            <span className="mt-1.5 block truncate text-2xs" title={t.change?.text ?? t.note}>
              {t.change ? (
                <span className={cn(t.change.good === true ? "text-good-700" : t.change.good === false ? "text-stop-700" : "text-muted")}>{t.change.text}</span>
              ) : (
                t.note && <span className="text-muted">{t.note}</span>
              )}
            </span>
          </>
        );
        const shell = cn("flex min-w-0 flex-col rounded-xl border px-3.5 py-3 shadow-card", tone.card);
        return t.href ? (
          <Link key={t.label} href={t.href} data-tile={slug(t.label)} className={cn(shell, "transition-all duration-150 hover:-translate-y-px hover:shadow-lift")}>
            {body}
          </Link>
        ) : (
          <div key={t.label} data-tile={slug(t.label)} className={shell}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
