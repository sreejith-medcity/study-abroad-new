import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn, Avatar } from "../ui";
import { groupInr } from "@/lib/format";
import { FIGURE_KEYS, FIGURE_LABEL } from "@/lib/journal";
import { NOT_RECORDED, todayBlank, type FigureSet, type MonthFigures, type TodayFigures } from "@/lib/day-figures";

/*
 * The pieces the role dashboards are built from.
 *
 * Three layouts share them. The executive summary opens on a band of four
 * figures with a gauge, then a flow, the things that need somebody, a year
 * as a line and a grid of small figures. The pipeline board opens on a strip
 * of figures and then the work itself, stage by stage, as cards. The command
 * centre is the board of tiles that was already there, with the week's
 * deadlines and the desk's load beside it.
 *
 * Every figure is written out beside its mark and every mark opens the list
 * behind it, so nothing is read off a colour alone and nothing is a dead end.
 */

const fmt = (n: number) => n.toLocaleString("en-IN");

/* ---------------- The band at the top of the executive summary ---------------- */

export function ExecHero({
  eyebrow,
  greeting,
  line,
  periods,
  figures,
  gauge,
}: {
  eyebrow: string;
  greeting: string;
  line: ReactNode;
  periods: { key: string; label: string; href: string; on: boolean }[];
  figures: { label: string; value: string; note?: string; href?: string; slug: string }[];
  gauge?: ReactNode;
}) {
  return (
    <section data-exec-hero className="brand-wash grain relative overflow-hidden rounded-2xl px-5 py-6 text-white shadow-lg sm:px-7">
      <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center">
        <div className="min-w-0 lg:w-[18rem] lg:shrink-0">
          <p className="text-3xs font-semibold uppercase tracking-[0.16em] text-white/70">{eyebrow}</p>
          <h1 className="mt-1 font-display text-[1.625rem] font-semibold leading-tight">{greeting}</h1>
          <p className="mt-1 text-sm text-white/80">{line}</p>
          <nav aria-label="Period" className="mt-3 flex flex-wrap gap-1" data-print="hide">
            {periods.map((p) => (
              <Link
                key={p.key}
                href={p.href}
                scroll={false}
                aria-current={p.on ? "page" : undefined}
                className={cn("whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors", p.on ? "bg-white text-brand-800" : "bg-white/12 text-white hover:bg-white/20")}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-7 gap-y-5 sm:grid-cols-4 lg:border-l lg:border-white/15 lg:pl-7">
          {figures.map((f) => {
            const body = (
              <>
                <dd data-figure className="whitespace-nowrap font-display text-[clamp(1.5rem,2.3vw,2.25rem)] font-semibold leading-none tabular tracking-[-0.03em]">
                  {f.value}
                </dd>
                <dt className="mt-1.5 text-sm font-medium">{f.label}</dt>
                {f.note && <p className="text-2xs text-white/70">{f.note}</p>}
              </>
            );
            return (
              <div key={f.slug} data-hero={f.slug} className="min-w-0">
                {f.href ? (
                  <Link href={f.href} className="block rounded-md transition-opacity hover:opacity-85">
                    {body}
                  </Link>
                ) : (
                  body
                )}
              </div>
            );
          })}
        </dl>
        {gauge && <div className="shrink-0 lg:border-l lg:border-white/15 lg:pl-6">{gauge}</div>}
      </div>
    </section>
  );
}

/**
 * Half a ring, filling as a share is reached: money received out of all that
 * has been earned, say. The share is written in the middle, and the two
 * figures it comes from underneath, so the arc is never the only reading.
 */
export function Gauge({ value, of, label, middle, under, onDark = true }: { value: number; of: number; label: string; middle: string; under: string; onDark?: boolean }) {
  const share = of > 0 ? Math.min(1, Math.max(0, value / of)) : 0;
  const r = 70;
  const cx = 90;
  const cy = 86;
  const arc = (to: number) => {
    const a = Math.PI * (1 - to);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${(cx + r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`;
  };
  return (
    <figure data-gauge className="flex w-[180px] flex-col items-center" aria-label={`${label}: ${middle}, ${under}`}>
      <figcaption className={cn("text-2xs", onDark ? "text-white/75" : "text-muted")}>{label}</figcaption>
      <svg viewBox="0 0 180 96" width="180" height="96" aria-hidden="true">
        <path d={arc(1)} fill="none" stroke={onDark ? "rgba(255,255,255,0.18)" : "var(--color-line)"} strokeWidth="14" strokeLinecap="round" />
        {share > 0 && <path d={arc(share)} fill="none" stroke={onDark ? "var(--color-gold-400)" : "var(--color-brand-600)"} strokeWidth="14" strokeLinecap="round" />}
        <text x={cx} y={cy - 14} textAnchor="middle" className="font-display" fontSize="26" fontWeight="600" fill={onDark ? "#fff" : "var(--color-ink)"}>
          {middle}
        </text>
      </svg>
      <p className={cn("-mt-1 text-center text-2xs", onDark ? "text-white/80" : "text-muted")}>{under}</p>
    </figure>
  );
}

/* ---------------- Needs attention ---------------- */

const attentionTone = {
  warn: { badge: "bg-warn-50 text-warn-700", button: "bg-warn-500 text-white hover:bg-warn-700" },
  stop: { badge: "bg-stop-50 text-stop-700", button: "bg-stop-500 text-white hover:bg-stop-700" },
  info: { badge: "bg-info-50 text-info-700", button: "bg-info-500 text-white hover:bg-info-700" },
} as const;

/**
 * The few things only somebody can move, each with its number and the way to
 * it. A line with nothing in it says it is clear rather than vanishing, so the
 * list is read the same way every morning.
 */
export function AttentionList({ rows }: { rows: { slug: string; value: number | string; label: string; note: string; tone: keyof typeof attentionTone; href: string; action: string }[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => {
        const clear = r.value === 0 || r.value === "0" || r.value === "₹0";
        const t = attentionTone[r.tone];
        return (
          <li key={r.slug} data-attention={r.slug} className="flex items-center gap-3 px-4 py-3">
            <span data-figure className={cn("grid h-10 min-w-10 shrink-0 place-items-center rounded-lg px-2 font-display text-base font-semibold tabular", clear ? "bg-good-50 text-good-700" : t.badge)}>
              {r.value}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{r.label}</span>
              <span className="block truncate text-xs text-muted">{clear ? "Nothing waiting" : r.note}</span>
            </span>
            {clear ? (
              <span className="text-xs font-medium text-good-700">Clear</span>
            ) : (
              <Link href={r.href} className={cn("shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold", t.button)}>
                {r.action}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Small figures ---------------- */

const miniTone = {
  good: "bg-good-50 [--bar:var(--color-good-500)]",
  warn: "bg-warn-50 [--bar:var(--color-warn-500)]",
  stop: "bg-stop-50 [--bar:var(--color-stop-500)]",
  info: "bg-info-50 [--bar:var(--color-info-500)]",
  brand: "bg-brand-50 [--bar:var(--color-brand-600)]",
} as const;

/** A grid of small washed figures, each a link, for the ones read in passing. */
export function MiniTiles({ tiles, cols = 3 }: { tiles: { slug: string; label: string; value: number | string; tone: keyof typeof miniTone; href: string }[]; cols?: 2 | 3 }) {
  return (
    <div data-mini-tiles className={cn("grid gap-3", cols === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
      {tiles.map((t) => {
        const nothing = t.value === 0 || t.value === "0";
        return (
          <Link key={t.slug} href={t.href} data-tile={t.slug} className={cn("flex flex-col rounded-xl border border-line/60 px-3.5 py-3 transition-transform hover:-translate-y-px", miniTone[t.tone])}>
            <span data-figure className={cn("block font-display text-2xl font-semibold leading-none tabular", nothing ? "text-muted" : "text-ink")}>
              {typeof t.value === "number" ? fmt(t.value) : t.value}
            </span>
            <span className="mt-1.5 block flex-1 text-xs font-medium leading-tight text-ink-soft">{t.label}</span>
            <span className="mt-2 block h-0.5 w-7 rounded-full bg-[var(--bar)]" />
          </Link>
        );
      })}
    </div>
  );
}

/* ---------------- How students flow through ---------------- */

/**
 * The journey as ribbons: everybody registered on the left, and at each step
 * the band carries on at the width of those who went further, with those who
 * stopped peeling off underneath. One hue throughout, deepening as students
 * go further; the ones who stopped are grey.
 */
export function FlowRibbon({ steps }: { steps: { label: string; value: number; href: string }[] }) {
  const W = 760;
  const H = 230;
  const top = 26;
  const band = 150;
  const first = Math.max(1, steps[0]?.value ?? 0);
  const x = (i: number) => 14 + (i * (W - 150)) / Math.max(1, steps.length - 1);
  const h = (v: number) => Math.max(v > 0 ? 3 : 0, (v / first) * band);
  const fill = (i: number) => `color-mix(in oklab, var(--color-brand-600) ${100 - i * 14}%, white)`;
  if (steps.every((s) => s.value === 0)) return <p className="px-4 py-10 text-center text-sm text-muted">Nobody has registered in this period yet.</p>;
  return (
    <figure data-flow className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px]" role="img" aria-label={steps.map((s) => `${s.label} ${s.value}`).join(", ")}>
        {steps.slice(1).map((s, j) => {
          const i = j + 1;
          const prev = steps[i - 1];
          const x0 = x(i - 1) + 10;
          const x1 = x(i);
          const mid = (x0 + x1) / 2;
          const hPrev = h(prev.value);
          const hNow = h(s.value);
          const stopped = prev.value - s.value;
          const hStop = hPrev - hNow;
          return (
            <g key={s.label}>
              <path d={`M ${x0} ${top} C ${mid} ${top}, ${mid} ${top}, ${x1} ${top} L ${x1} ${top + hNow} C ${mid} ${top + hNow}, ${mid} ${top + hNow}, ${x0} ${top + hNow} Z`} fill={fill(i)} opacity="0.35" />
              {hStop > 0.5 && (
                <>
                  <path
                    d={`M ${x0} ${top + hNow} C ${mid} ${top + hNow}, ${mid} ${top + band + 26}, ${x1} ${top + band + 26} L ${x1} ${top + band + 26 + Math.max(2, hStop * 0.35)} C ${mid} ${top + band + 26 + Math.max(2, hStop * 0.35)}, ${mid} ${top + hPrev}, ${x0} ${top + hPrev} Z`}
                    fill="var(--color-line-strong)"
                    opacity="0.55"
                  />
                  <text x={x1 + 14} y={top + band + 34} fontSize="12" fill="var(--color-muted)">
                    Stopped here · {fmt(stopped)}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {steps.map((s, i) => (
          <g key={s.label}>
            <rect x={x(i)} y={top} width="10" height={Math.max(2, h(s.value))} rx="2" fill={fill(i)} />
            <a href={s.href}>
              <text x={x(i) + (i === 0 ? 0 : 14)} y={top - 9} fontSize="13" fontWeight="600" fill="var(--color-ink)">
                {s.label} · {fmt(s.value)}
              </text>
            </a>
          </g>
        ))}
      </svg>
    </figure>
  );
}

/* ---------------- A year as one line ---------------- */

/**
 * Twelve months of one figure as a line over a soft area, with the latest
 * month written at its end. One series, so no legend: the card says what it
 * is. The scale's top is a round number and is written on the left.
 */
export function AreaLine({ points, unit = "", money = false }: { points: { key: string; label: string; value: number }[]; unit?: string; money?: boolean }) {
  const W = 640;
  const H = 210;
  const L = 44;
  const R = 16;
  const T = 26;
  const B = 24;
  const max = Math.max(...points.map((p) => p.value), 0);
  const nice = (() => {
    if (max <= 4) return 4;
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    for (const m of [1, 2, 2.5, 4, 5, 8, 10]) if (m * step >= max) return m * step;
    return 10 * step;
  })();
  const short = (n: number) => (money ? (n >= 1e7 ? `₹${+(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `₹${+(n / 1e3).toFixed(0)}K` : `₹${n}`) : fmt(n));
  const px = (i: number) => L + (i * (W - L - R)) / Math.max(1, points.length - 1);
  const py = (v: number) => T + (1 - v / nice) * (H - T - B);
  if (max === 0) return <p className="px-4 py-12 text-center text-sm text-muted">Nothing in the last twelve months.</p>;
  const line = points.map((p, i) => `${i ? "L" : "M"} ${px(i).toFixed(1)} ${py(p.value).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    // Kept to a readable size on a phone and scrolled, rather than shrunk
    // until the months cannot be read.
    <figure data-area-line className="thin-scroll overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label={points.map((p) => `${p.label} ${short(p.value)}${unit}`).join(", ")}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={py(nice * f)} y2={py(nice * f)} stroke="var(--color-line)" />
            <text x={L - 8} y={py(nice * f) + 4} fontSize="11" textAnchor="end" fill="var(--color-muted)">
              {short(nice * f)}
            </text>
          </g>
        ))}
        <path d={`${line} L ${px(points.length - 1)} ${py(0)} L ${px(0)} ${py(0)} Z`} fill="var(--color-brand-600)" opacity="0.1" />
        <path d={line} fill="none" stroke="var(--color-brand-600)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.key}>
            <circle cx={px(i)} cy={py(p.value)} r="9" fill="transparent">
              <title>{`${p.label}: ${short(p.value)}${unit}`}</title>
            </circle>
            <text x={px(i)} y={H - 6} fontSize="11" textAnchor="middle" fill="var(--color-muted)">
              {p.label}
            </text>
          </g>
        ))}
        <circle cx={px(points.length - 1)} cy={py(last.value)} r="4.5" fill="var(--color-brand-600)" stroke="var(--color-surface)" strokeWidth="2" />
        <text x={px(points.length - 1)} y={py(last.value) - 11} fontSize="13" fontWeight="600" textAnchor="end" fill="var(--color-ink)">
          {short(last.value)}
          {unit} in {last.label}
        </text>
      </svg>
    </figure>
  );
}

/* ---------------- The strip of figures over a pipeline board ---------------- */

const stripTone = {
  brand: "before:bg-brand-600",
  info: "before:bg-info-500",
  good: "before:bg-good-500",
  warn: "before:bg-warn-500",
  stop: "before:bg-stop-500",
  gold: "before:bg-gold-500",
} as const;

/**
 * Every figure in one row, small, each with its colour along the top edge.
 * Read by position, so every one is drawn whatever it holds; a nought steps
 * back to grey.
 */
export function FigureStrip({ figures }: { figures: { slug: string; label: string; value: number | string; note?: string; tone: keyof typeof stripTone; href: string }[] }) {
  return (
    // A wrapping row whose cells grow, so a short last row fills the width
    // rather than leaving a hole at the end of the strip.
    <div data-stat-tiles className="flex flex-wrap overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {figures.map((f) => {
        const nothing = f.value === 0 || f.value === "0" || f.value === "₹0";
        return (
          <Link
            key={f.slug}
            href={f.href}
            data-tile={f.slug}
            className={cn(
              "relative min-w-0 grow basis-[9rem] border-b border-r border-line px-3.5 pb-3 pt-4 transition-colors before:absolute before:inset-x-3 before:top-0 before:h-[3px] before:rounded-b hover:bg-surface-2",
              stripTone[f.tone],
            )}
          >
            <span data-figure className={cn("block font-display text-[1.625rem] font-semibold leading-none tabular", nothing ? "text-muted" : "text-ink")}>
              {typeof f.value === "number" ? fmt(f.value) : f.value}
            </span>
            <span className="mt-1.5 block text-xs font-medium leading-tight text-ink-soft">{f.label}</span>
            {f.note && <span className="block text-3xs text-muted">{f.note}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/* ---------------- The board itself ---------------- */

export type BoardCard = { id: string; href: string; title: string; lines: string[]; age: string; late?: boolean; who?: string | null };
export type BoardColumn = { key: string; label: string; blurb?: string; total: number; href: string; cards: BoardCard[] };

const dot = [
  "bg-[color-mix(in_oklab,var(--color-brand-600)_35%,white)]",
  "bg-warn-500",
  "bg-info-500",
  "bg-brand-600",
  "bg-good-500",
  "bg-good-700",
];

/**
 * The work as columns, one per stage, oldest waiting at the top. A column
 * shows a handful and says how many it holds, and its heading opens all of
 * them. A card past its service level carries a red edge.
 */
export function PipelineColumns({ columns, empty = "Nothing here" }: { columns: BoardColumn[]; empty?: string }) {
  return (
    // On a phone the columns sit side by side at most of the screen's width
    // and snap as they are swiped, the way a board is used on one; from a
    // laptop up they share the width.
    <div data-board className="thin-scroll overflow-x-auto p-4">
      <div
        className="grid snap-x snap-mandatory auto-cols-[82%] grid-flow-col gap-3 sm:auto-cols-[46%] lg:snap-none lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]"
        style={{ "--cols": columns.length } as CSSProperties}
      >
        {columns.map((c, i) => (
          <section key={c.key} data-column={c.key} aria-label={c.label} className="flex min-w-0 snap-start flex-col rounded-xl border border-line bg-surface-2/70 p-2">
            <Link href={c.href} className="mb-2 flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface">
              <span className={cn("size-2 shrink-0 rounded-sm", dot[i] ?? "bg-brand-600")} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" style={{ fontFamily: "var(--font-sans)" }}>
                {c.label}
              </span>
              <span data-count className="rounded-full bg-surface px-2 text-xs font-semibold tabular text-ink-soft ring-1 ring-inset ring-line">
                {c.total}
              </span>
            </Link>
            {c.blurb && <p className="-mt-1 mb-2 px-1.5 text-3xs text-muted">{c.blurb}</p>}
            <ul className="space-y-2">
              {c.cards.length === 0 && <li className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-xs text-muted">{empty}</li>}
              {c.cards.map((card) => (
                <li key={card.id}>
                  <Link
                    href={card.href}
                    className={cn("block rounded-lg border border-line bg-surface p-2.5 shadow-sm transition-colors hover:border-brand-200", card.late && "border-l-[3px] border-l-stop-500")}
                  >
                    <span className="flex items-start gap-2">
                      <Avatar name={card.title} className="size-6 text-3xs" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{card.title}</span>
                      <span className={cn("shrink-0 text-2xs tabular", card.late ? "font-semibold text-stop-500" : "text-muted")}>{card.age}</span>
                    </span>
                    {card.lines.map((l, k) => (
                      <span key={k} className={cn("mt-0.5 block truncate text-xs", k === 0 ? "text-ink-soft" : "text-muted")}>
                        {l}
                      </span>
                    ))}
                    {card.who !== undefined && <span className="mt-1 block truncate text-3xs text-muted">{card.who ? `With ${card.who}` : "Nobody has it yet"}</span>}
                  </Link>
                </li>
              ))}
              {c.total > c.cards.length && (
                <li>
                  <Link href={c.href} className="block px-1.5 text-xs font-medium text-brand-700 hover:underline">
                    {c.total - c.cards.length} more
                  </Link>
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Documents still to come ---------------- */

/**
 * Each student who still owes documents, with a bar of how much of what was
 * asked has come in. The bar turns from red to amber to green as it fills,
 * and the count is written beside it.
 */
export function ProgressList({ rows, footer }: { rows: { id: string; label: string; done: number; of: number; href: string }[]; footer?: ReactNode }) {
  if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">Nobody owes a document.</p>;
  return (
    <div className="px-4 py-3">
      <ul className="space-y-3">
        {rows.map((r) => {
          const share = r.of > 0 ? r.done / r.of : 0;
          return (
            <li key={r.id} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3">
              <Link href={r.href} className="truncate text-sm font-semibold text-ink hover:underline">
                {r.label}
              </Link>
              <span className="h-2 rounded-full bg-surface-2 ring-1 ring-inset ring-line">
                <span className={cn("block h-full rounded-full", share < 0.34 ? "bg-stop-500" : share < 0.75 ? "bg-warn-500" : "bg-good-500")} style={{ width: `${Math.max(4, share * 100)}%` }} />
              </span>
              <span className="text-xs tabular text-muted">
                {r.done} of {r.of} in
              </span>
            </li>
          );
        })}
      </ul>
      {footer && <div className="mt-3 text-xs">{footer}</div>}
    </div>
  );
}

/* ---------------- A ranked table of people or places ---------------- */

export function Leaderboard({ head, rows, empty }: { head: string[]; rows: { id: string; name: string; sub?: string; href?: string; cells: (number | string)[] }[]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
            <th className="px-4 py-2.5">{head[0]}</th>
            {head.slice(1).map((h) => (
              <th key={h} className="px-2 py-2.5 text-right last:pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2.5">
                  <span className={cn("grid size-5 shrink-0 place-items-center rounded-md text-3xs font-bold tabular", i === 0 ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-700")}>{i + 1}</span>
                  <span className="min-w-0">
                    {r.href ? (
                      <Link href={r.href} className="block truncate font-medium text-ink hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="block truncate font-medium text-ink">{r.name}</span>
                    )}
                    {r.sub && <span className="block truncate text-2xs text-muted">{r.sub}</span>}
                  </span>
                </span>
              </td>
              {r.cells.map((c, k) => (
                <td key={k} className="px-2 py-2.5 text-right tabular last:pr-4">
                  {typeof c === "number" ? fmt(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- The week's deadlines ---------------- */

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * This week as seven days, today picked out, with a dot under each day that
 * has something due, and the milestones themselves underneath.
 */
export function WeekStrip({
  days,
  today,
  items,
  late,
  more,
}: {
  days: { date: string; n: number }[];
  today: string;
  items: { id: string; title: string; sub: string; due: string; href: string }[];
  late: number;
  more: number;
}) {
  return (
    <div data-week>
      <ol className="grid grid-cols-7 gap-1 px-3 pt-3">
        {days.map((d, i) => {
          const on = d.date === today;
          return (
            <li key={d.date} className={cn("flex flex-col items-center rounded-lg py-1.5", on ? "bg-brand-600 text-white" : "text-ink")}>
              <span className={cn("text-3xs", on ? "text-white/80" : "text-muted")}>{DAY[i]}</span>
              <span className="font-display text-base font-semibold tabular">{Number(d.date.slice(8))}</span>
              <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", d.n > 0 ? (on ? "bg-white" : "bg-warn-500") : "bg-transparent")} title={d.n > 0 ? `${d.n} due` : undefined} />
            </li>
          );
        })}
      </ol>
      {late > 0 && (
        <p className="mx-4 mt-3 rounded-md bg-stop-50 px-2.5 py-1.5 text-xs font-medium text-stop-700">
          {late} {late === 1 ? "milestone is" : "milestones are"} past due and not done
        </p>
      )}
      <ul className="mt-2">
        {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nothing falls due this week.</li>}
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-0">
            <span className="h-8 w-1 shrink-0 rounded-full bg-warn-500" />
            <span className="min-w-0 flex-1">
              <Link href={it.href} className="block truncate text-sm font-semibold text-ink hover:underline">
                {it.title}
              </Link>
              <span className="block truncate text-xs text-muted">{it.sub}</span>
            </span>
            <span className="shrink-0 rounded-md bg-warn-50 px-2 py-0.5 text-2xs font-semibold text-warn-700">{it.due}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="border-t border-line px-4 py-2 text-xs text-muted">and {more} more this week</p>}
    </div>
  );
}

/* ---------------- A short list of follow-ups ---------------- */

export function TaskList({ rows, todayIs }: { rows: { id: string; title: string; dueOn: string; studentId: string | null; student: string | null }[]; todayIs: string }) {
  if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">No follow-ups waiting.</p>;
  return (
    <ul>
      {rows.map((r) => {
        const late = r.dueOn < todayIs;
        const today = r.dueOn === todayIs;
        return (
          <li key={r.id} className="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-0">
            <span className={cn("h-8 w-1 shrink-0 rounded-full", late ? "bg-stop-500" : today ? "bg-warn-500" : "bg-line-strong")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{r.title}</span>
              {r.student && r.studentId && (
                <Link href={`/students/${r.studentId}`} className="block truncate text-xs text-muted hover:underline">
                  {r.student}
                </Link>
              )}
            </span>
            <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-2xs font-semibold", late ? "bg-stop-50 text-stop-700" : today ? "bg-warn-50 text-warn-700" : "bg-surface-2 text-muted")}>
              {late ? "Late" : today ? "Today" : shortDate(r.dueOn)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string) {
  return `${Number(iso.slice(8, 10))} ${MONTH[Number(iso.slice(5, 7)) - 1]}`;
}

/** "3d", "today", said the same way on every card. */
export function ageText(days: number) {
  if (days <= 0) return "today";
  return `${days}d`;
}

/* ---------------- Placements: Ausbildung and NCLEX-RN ---------------- */

/**
 * The placement work in two short rows of figures, each opening the
 * placement tracker on exactly that list. Drawn whatever they hold, so the
 * card reads the same way every day; a nought steps back to grey.
 */
export function Placements({
  ausbildung,
  nclex,
  query,
}: {
  ausbildung: { students: number; interview: number; contract: number; german: number; unpaid: number };
  nclex: { students: number; opened: number; passed: number };
  /** The branch or counsellor the tracker should open on, as an address query. */
  query: string;
}) {
  const href = (extra: string) => `/ausbildung?${[extra, query].filter(Boolean).join("&")}`;
  const row = (title: string, items: { slug: string; label: string; value: number; href: string; tone?: "warn" | "good" | "stop" }[]) => (
    <div>
      <p className="mb-2 text-3xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {items.map((it) => (
          <Link key={it.slug} href={it.href} data-placement={it.slug} className="rounded-lg border border-line bg-surface-2/60 px-3 py-2.5 transition-colors hover:border-brand-200">
            <span
              data-figure
              className={cn(
                "block font-display text-xl font-semibold leading-none tabular",
                it.value === 0 ? "text-muted" : it.tone === "warn" ? "text-warn-700" : it.tone === "good" ? "text-good-700" : it.tone === "stop" ? "text-stop-700" : "text-ink",
              )}
            >
              {fmt(it.value)}
            </span>
            <span className="mt-1 block text-xs leading-tight text-ink-soft">{it.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
  return (
    <div data-placements className="space-y-4 p-4">
      {row("Ausbildung", [
        { slug: "ausbildung-students", label: "Students", value: ausbildung.students, href: href("tab=ausbildung") },
        { slug: "interview-coming", label: "Interview coming up", value: ausbildung.interview, href: href("tab=ausbildung&show=interview"), tone: "warn" },
        { slug: "contract-received", label: "Contract received", value: ausbildung.contract, href: href("tab=ausbildung&show=contract"), tone: "good" },
        { slug: "german-not-finished", label: "German not finished", value: ausbildung.german, href: href("tab=ausbildung&show=german"), tone: "warn" },
        { slug: "service-charge-pending", label: "Service charge pending", value: ausbildung.unpaid, href: href("tab=ausbildung&show=unpaid"), tone: "stop" },
      ])}
      {row("NCLEX-RN (USA)", [
        { slug: "nursing-students", label: "Nursing students", value: nclex.students, href: href("tab=nclex") },
        { slug: "nclex-opened", label: "On the NCLEX process", value: nclex.opened, href: href("tab=nclex") },
        { slug: "nclex-passed", label: "Passed", value: nclex.passed, href: href("tab=nclex"), tone: "good" },
      ])}
    </div>
  );
}

/* ---------------- Targets ---------------- */

type TargetProgress = { metric: string; label: string; actual: number; target: number | null };

/**
 * One bar per target: what has happened against what was set, with a thin
 * mark for where the month has got to, so "on pace" can be read without
 * working it out. Green at or past the target, amber behind the pace, the
 * brand colour otherwise. A metric with no target says so.
 */
export function TargetBars({ progress, elapsed, compact = false }: { progress: TargetProgress[]; elapsed: number; compact?: boolean }) {
  return (
    <div className={cn("grid gap-3", compact ? "sm:grid-cols-3" : "sm:grid-cols-3")}>
      {progress.map((p) => {
        const share = p.target ? p.actual / p.target : 0;
        const behind = p.target != null && share < elapsed && share < 1;
        return (
          <div key={p.metric} data-target={p.metric} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-ink-soft">{p.label}</span>
              <span className="text-xs tabular text-muted">
                {p.target == null ? (
                  "No target"
                ) : (
                  <>
                    <span data-figure className="font-semibold text-ink">
                      {fmt(p.actual)}
                    </span>{" "}
                    of {fmt(p.target)}
                  </>
                )}
              </span>
            </div>
            <div className="relative mt-1.5 h-2 rounded-full bg-surface-2 ring-1 ring-inset ring-line">
              {p.target != null && (
                <span
                  className={cn("block h-full rounded-full", share >= 1 ? "bg-good-500" : behind ? "bg-warn-500" : "bg-brand-600")}
                  style={{ width: `${Math.min(100, Math.max(p.actual > 0 ? 3 : 0, share * 100))}%` }}
                />
              )}
              {p.target != null && elapsed > 0 && elapsed < 1 && (
                <span className="absolute -top-1 h-4 w-px bg-ink/40" style={{ left: `${elapsed * 100}%` }} title="Where the month has got to" aria-hidden="true" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A list of people or branches, each with their three bars. */
export function TargetRows({ rows, elapsed }: { rows: { id: string; name: string; progress: TargetProgress[] }[]; elapsed: number }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} data-target-row={r.id} className="px-4 py-3">
          <p className="mb-2 text-sm font-semibold text-ink">{r.name}</p>
          <TargetBars progress={r.progress} elapsed={elapsed} compact />
        </li>
      ))}
    </ul>
  );
}

/* ---------------- The day's figures ---------------- */

/** A figure, or what its absence reads as. Written with the shared grouping so the server and the browser agree. */
function figureText(v: number | null, blank: string) {
  return v == null ? blank : groupInr(v);
}

/**
 * The five day end figures as tiles: today large, the month so far under it.
 * Today is what the person typed on their report, or until they answer, the
 * portal's own count, with the two figures only they know reading "Not given
 * yet". A month with no answered report reads "Not recorded", never 0.
 */
export function DayFigureTiles({ today, month }: { today: { source: TodayFigures["source"]; figures: FigureSet }; month: MonthFigures }) {
  return (
    <div data-day-figure-tiles className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {FIGURE_KEYS.map((k) => {
        const now = today.figures[k];
        const sum = month.reports > 0 ? month.figures[k] : null;
        return (
          <div key={k} data-figure-tile={k} data-source={today.source} className="min-w-0 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
            <span className="block text-xs font-medium leading-tight text-ink-soft">{FIGURE_LABEL[k]}</span>
            <span data-today className={cn("mt-1.5 block font-display leading-none tabular", now == null ? "text-sm font-medium text-muted" : cn("text-2xl font-semibold", now === 0 ? "text-muted" : "text-ink"))}>
              {figureText(now, todayBlank(today.source))}
            </span>
            <span className="mt-1.5 block text-2xs text-muted">
              Month so far: <span data-month className={cn("tabular", sum == null ? "" : "font-semibold text-ink-soft")}>{figureText(sum, NOT_RECORDED)}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The branch's people, one row each, with their five figures for the month
 * and how many days they answered. A row with no answered report reads "Not
 * recorded" across, rather than a line of noughts.
 */
export function DayFigureTable({ rows, empty }: { rows: { id: string; name: string; sub?: string; month: MonthFigures }[]; empty: string }) {
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm" data-day-figures-people>
        <thead>
          <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
            <th className="px-4 py-2.5">Name</th>
            {FIGURE_KEYS.map((k) => (
              <th key={k} className="px-2 py-2.5 text-right">
                {FIGURE_LABEL[k]}
              </th>
            ))}
            <th className="px-2 py-2.5 pr-4 text-right">Days answered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-day-figures-row={r.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <span className="block truncate font-medium text-ink">{r.name}</span>
                {r.sub && <span className="block truncate text-2xs text-muted">{r.sub}</span>}
              </td>
              {r.month.reports === 0 ? (
                <td colSpan={5} data-col="none" className="px-2 py-2.5 text-right text-muted">
                  {NOT_RECORDED}
                </td>
              ) : (
                FIGURE_KEYS.map((k) => (
                  <td key={k} data-col={k} className={cn("px-2 py-2.5 text-right tabular", r.month.figures[k] == null ? "text-muted" : "text-ink")}>
                    {figureText(r.month.figures[k], NOT_RECORDED)}
                  </td>
                ))
              )}
              <td data-col="days" className="px-2 py-2.5 pr-4 text-right tabular text-ink-soft">
                {groupInr(r.month.reports)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Each branch's month so far in one line: the five figures added up over its
 * counsellors' answered reports, and how many reports that is. Only branches
 * with a report this month are listed, so the strip never says 0 for a branch
 * that has simply not started.
 */
export function DayFigureBranches({ rows, href }: { rows: { orgId: string; name: string; people: number; month: MonthFigures }[]; href: string }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((b) => (
        <li key={b.orgId} data-day-figures-branch={b.orgId} className="px-4 py-3">
          <Link href={href} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md hover:bg-surface-2">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{b.name}</span>
              <span className="block text-2xs text-muted">
                {groupInr(b.month.reports)} {b.month.reports === 1 ? "report" : "reports"} from {groupInr(b.people)} {b.people === 1 ? "person" : "people"}
              </span>
            </span>
            <span className="grid grid-cols-5 gap-x-4 text-right">
              {FIGURE_KEYS.map((k) => (
                <span key={k} className="min-w-0">
                  <span data-col={k} className={cn("block font-display text-lg font-semibold leading-none tabular", b.month.figures[k] == null ? "text-sm text-muted" : "text-ink")}>
                    {figureText(b.month.figures[k], NOT_RECORDED)}
                  </span>
                  <span className="mt-0.5 block text-3xs leading-tight text-muted">{FIGURE_LABEL[k]}</span>
                </span>
              ))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
