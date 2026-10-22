import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./ui";

/**
 * The board of figures a dashboard opens with.
 *
 * One tile per figure: what it is, what it reads, and a line underneath when
 * the number needs a word to be understood. Each one is the way into its own
 * list, because a figure nobody can open is a figure nobody can act on.
 *
 * The icon is there to make a tile findable by shape rather than by reading
 * every label, which is how somebody who opens this screen every morning
 * actually uses it. A nought is dimmed rather than hidden: a board that
 * changes shape between Monday and Tuesday cannot be read by position, and
 * position is the whole point of a board.
 */
const tileTone = {
  brand: "bg-brand-50 text-brand-700",
  info: "bg-info-50 text-info-700",
  good: "bg-good-50 text-good-700",
  warn: "bg-warn-50 text-warn-700",
  stop: "bg-stop-50 text-stop-700",
  gold: "bg-gold-400/20 text-[#7a5c00]",
} as const;

export type StatTile = {
  label: string;
  value: number | string;
  /** The line under the figure, for what the number does not say on its own. */
  note?: string;
  tone: keyof typeof tileTone;
  icon: ReactNode;
  href?: string;
};

/** A tile's own handle, so a suite can read one figure without counting cards. */
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function StatTiles({ tiles, columns = 4 }: { tiles: StatTile[]; columns?: 3 | 4 }) {
  return (
    <div
      data-stat-tiles
      className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", columns === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")}
    >
      {tiles.map((t) => {
        const nothing = t.value === 0 || t.value === "0";
        const body = (
          <>
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&>svg]:size-5", nothing ? "bg-surface-2 text-muted" : tileTone[t.tone])}>
              {t.icon}
            </span>
            <span className="min-w-0">
              <span
                data-figure
                className={cn(
                  "block truncate font-display text-[1.75rem] font-semibold leading-none tabular tracking-[-0.03em]",
                  nothing ? "text-muted/45" : "text-ink",
                )}
              >
                {t.value}
              </span>
              <span className="mt-1.5 block truncate text-xs font-medium text-ink-soft" title={t.label}>
                {t.label}
              </span>
              {t.note && <span className="mt-0.5 block truncate text-2xs text-muted" title={t.note}>{t.note}</span>}
            </span>
          </>
        );
        const shell = "flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card";
        return t.href ? (
          <Link
            key={t.label}
            href={t.href}
            data-tile={slug(t.label)}
            className={cn(shell, "transition-all duration-150 hover:-translate-y-px hover:shadow-lift")}
          >
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
