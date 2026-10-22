import Link from "next/link";
import type { StatusGroup } from "@/db/schema";
import type { ActivityItem } from "@/server/dashboard-charts";
import { StatusBadge, cn } from "../ui";
import { IconDoc, IconFlow, IconStudents } from "../icons";

/*
 * The pictures under the dashboard's board.
 *
 * Colour follows one rule throughout: these are ordered things (steps of a
 * journey, stages of the work), so they are drawn in one hue that deepens as
 * the work moves on, taken from the brand ramp so they follow whatever colour
 * the portal is set to. The one stage that is not a step forward, on hold or
 * closed, is grey. Text is always in the ink colours, never the bar colour,
 * and every figure is written out beside its mark, so nothing is read off the
 * colour alone.
 */

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/* ---------------- From registration to enrolment ---------------- */

/*
 * The steps darken towards the start and lighten towards the end, mixed from
 * the brand colour itself with black and with white. The stored brand ramp
 * is mixed towards a fixed deep crimson at its dark end, which is right for
 * a crimson brand and turns a blue one purple, so it is not used here.
 */
const B = "var(--color-brand-600)";
const STEP_FILL = [
  `color-mix(in oklab, ${B} 62%, black)`,
  `color-mix(in oklab, ${B} 80%, black)`,
  B,
  `color-mix(in oklab, ${B} 84%, white)`,
  `color-mix(in oklab, ${B} 70%, white)`,
];

/**
 * The journey as a row of steps, deepening to lighter as students move on,
 * with what each step kept of the one before written on the join. Each step
 * says its own share of everybody who registered underneath, and opens its
 * list.
 */
export function JourneyFlow({ steps }: { steps: { label: string; value: number; href: string }[] }) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
      {steps.map((s, i) => {
        const before = i > 0 ? steps[i - 1].value : null;
        return (
          <li key={s.label} className="flex flex-col lg:flex-1 lg:flex-row lg:items-stretch">
            {before !== null && (
              <span className="relative flex items-center justify-center py-1 lg:w-16 lg:shrink-0 lg:flex-col lg:py-0" title="Share of the step before">
                <span className="absolute inset-x-3 top-1/2 hidden h-0.5 bg-brand-200 lg:block" aria-hidden="true" />
                <span className="relative bg-surface px-1 text-sm font-bold tabular text-brand-700">{before > 0 ? `${Math.round((s.value / before) * 100)}%` : "–"}</span>
                <span className="relative ml-1 bg-surface px-1 text-3xs text-muted lg:ml-0">kept</span>
              </span>
            )}
            <Link href={s.href} className="flex flex-1 flex-col rounded-xl px-4 py-3 text-white transition-transform hover:-translate-y-px" style={{ background: STEP_FILL[i] ?? B }}>
              <span className="text-xs text-white/85">{s.label}</span>
              <span className="font-display text-2xl font-semibold leading-tight">{s.value.toLocaleString("en-IN")}</span>
              <span className="text-2xs text-white/75">{first > 0 ? `${Math.round((s.value / first) * 100)}% of registered` : "\u00a0"}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------- Branches compared ---------------- */

/**
 * The branches side by side. Ranked by registrations, with a bar against the
 * busiest so the ranking reads at a glance; the visa rate is visas over
 * applications, said as a share, because a branch with few files and a
 * high rate is a different story from one with many and a low one.
 */
export function BranchTable({ rows }: { rows: { id: string; name: string; subAgent: boolean; registered: number; applied: number; visas: number }[] }) {
  if (rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">No branch has registered anybody in this period.</p>;
  const top = Math.max(...rows.map((r) => r.registered), 1);
  return (
    <div className="thin-scroll relative overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-3xs font-semibold uppercase tracking-wider text-muted">
            <th className="px-4 py-2.5 font-semibold">Branch</th>
            <th className="w-40 px-2 py-2.5" aria-hidden="true" />
            <th className="px-3 py-2.5 text-right font-semibold">Registered</th>
            <th className="px-3 py-2.5 text-right font-semibold">Applied</th>
            <th className="px-3 py-2.5 text-right font-semibold">Visas</th>
            <th className="px-4 py-2.5 text-right font-semibold">Visa rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/70 last:border-0 hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <Link href={`/dashboard?org=${r.id}`} className="font-medium text-ink hover:underline">
                  {r.name}
                </Link>
                {r.subAgent && <span className="ml-1.5 text-2xs text-muted">sub-agent</span>}
              </td>
              <td className="px-2 py-2.5">
                <span className="block h-2 rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-info-500" style={{ width: `${(r.registered / top) * 100}%` }} />
                </span>
              </td>
              <td className="px-3 py-2.5 text-right tabular">{r.registered}</td>
              <td className="px-3 py-2.5 text-right tabular">{r.applied}</td>
              <td className="px-3 py-2.5 text-right tabular">{r.visas}</td>
              <td className="px-4 py-2.5 text-right font-semibold tabular">{r.applied > 0 ? `${Math.round((r.visas / r.applied) * 100)}%` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Where the applications stand ---------------- */

const STAGE_FILL: Record<string, string> = {
  NEW: `color-mix(in oklab, ${B} 30%, white)`,
  PENDING_PARTNER: `color-mix(in oklab, ${B} 50%, white)`,
  IN_PROGRESS: `color-mix(in oklab, ${B} 75%, white)`,
  OFFER: B,
  SUCCESS: `color-mix(in oklab, ${B} 65%, black)`,
  PARKED: "var(--color-line-strong)",
};

/** One ring segment, from one angle to another, as a path. */
function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const p = (a: number) => [cx + r * Math.cos(a - Math.PI / 2), cy + r * Math.sin(a - Math.PI / 2)];
  const [x1, y1] = p(from);
  const [x2, y2] = p(to);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/**
 * Every application, by where it is now. Six stages at most, which is as
 * many as a ring can carry before the slices stop being told apart; the
 * legend beside it says each one in words and opens its list.
 */
export function StageRing({ stages }: { stages: { key: string; label: string; value: number; href: string }[] }) {
  const total = stages.reduce((a, s) => a + s.value, 0);
  const R = 62;
  const W = 18;
  // A small gap between slices, in the surface colour, rather than a line
  // drawn round each one. Left out when one stage holds everything.
  const live = stages.filter((s) => s.value > 0);
  const gap = live.length > 1 ? 0.035 : 0;
  let at = 0;
  const slices = live.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const from = at + gap / 2;
    const to = at + sweep - gap / 2;
    at += sweep;
    return { ...s, d: sweep >= Math.PI * 2 - 0.0001 ? null : arc(80, 80, R, from, Math.max(to, from + 0.01)) };
  });

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <svg viewBox="0 0 160 160" className="size-36 shrink-0" role="img" aria-label={`${total} applications by stage`}>
        <circle cx="80" cy="80" r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth={W} />
        {slices.map((s) =>
          s.d ? (
            <path key={s.key} d={s.d} fill="none" stroke={STAGE_FILL[s.key]} strokeWidth={W} strokeLinecap="butt">
              <title>{`${s.label}: ${s.value} (${pct(s.value, total)}%)`}</title>
            </path>
          ) : (
            <circle key={s.key} cx="80" cy="80" r={R} fill="none" stroke={STAGE_FILL[s.key]} strokeWidth={W}>
              <title>{`${s.label}: ${s.value} (100%)`}</title>
            </circle>
          ),
        )}
        <text x="80" y="78" textAnchor="middle" className="fill-ink font-display text-[30px] font-semibold">
          {total}
        </text>
        <text x="80" y="98" textAnchor="middle" className="fill-muted text-[11px]">
          {total === 1 ? "application" : "applications"}
        </text>
      </svg>
      <ul className="w-full min-w-0 space-y-1">
        {stages.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="flex items-center gap-2.5 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: STAGE_FILL[s.key] }} aria-hidden="true" />
              <span className={cn("min-w-0 flex-1 leading-tight", s.value ? "text-ink" : "text-muted")}>{s.label}</span>
              <span className={cn("tabular font-semibold", s.value ? "text-ink" : "text-muted")}>{s.value}</span>
              <span className="w-9 text-right text-2xs tabular text-muted">{total ? `${pct(s.value, total)}%` : ""}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Where students want to go ---------------- */

/** One bar per country, longest first, the count at the tip. One series, one colour. */
export function CountryBars({ rows, notRecorded }: { rows: { label: string; value: number }[]; notRecorded: number }) {
  const widest = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No preferred country recorded on any student yet.</p>;
  }
  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] items-center gap-3">
            <span className="truncate text-sm text-ink-soft" title={r.label}>{r.label}</span>
            <span className="flex items-center gap-2">
              <span className="h-3 rounded-r-[4px] bg-info-500/85" style={{ width: `${Math.max((r.value / widest) * 100, 2)}%` }} />
              <span className="text-xs font-semibold tabular text-ink">{r.value}</span>
            </span>
          </li>
        ))}
      </ul>
      {notRecorded > 0 && (
        <p className="mt-3 text-xs text-muted">
          {notRecorded} {notRecorded === 1 ? "student has" : "students have"} no preferred country recorded.
        </p>
      )}
    </div>
  );
}

/* ---------------- What just happened ---------------- */

function ago(at: Date, now = Date.now()) {
  const mins = Math.max(0, Math.round((now - at.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return at.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const KIND = {
  status: { icon: IconFlow, badge: "bg-info-50 text-info-700" },
  registered: { icon: IconStudents, badge: "bg-brand-50 text-brand-700" },
  document: { icon: IconDoc, badge: "bg-warn-50 text-warn-700" },
} as const;

/**
 * The latest things that happened, whatever kind: a file moving on, a student
 * registering, a document coming in. Each one opens the student it is about.
 */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="px-4 py-10 text-center text-sm text-muted">Nothing has happened yet.</p>;
  const now = Date.now();
  return (
    <ol className="relative px-4 py-2">
      {/* The thread the events hang on. */}
      <span className="absolute bottom-6 left-[2.125rem] top-6 w-px bg-line" aria-hidden="true" />
      {items.map((it) => {
        const k = KIND[it.kind];
        const Icon = k.icon;
        return (
          <li key={it.id} className="relative">
            <Link href={`/students/${it.studentId}`} className="flex gap-3 rounded-lg px-1.5 py-2.5 hover:bg-surface-2">
              <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full ring-4 ring-surface [&>svg]:size-4", k.badge)}>
                <Icon />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug text-ink">
                  <span className="font-semibold">{it.student}</span>{" "}
                  {it.kind === "status" && <span className="text-ink-soft">moved to</span>}
                  {it.kind === "registered" && <span className="text-ink-soft">registered</span>}
                  {it.kind === "document" && (
                    <span className="text-ink-soft">{it.count && it.count > 1 ? `has ${it.count} new documents` : "has a new document"}</span>
                  )}
                </span>
                {it.kind === "status" && it.group ? (
                  <StatusBadge group={it.group as StatusGroup} label={it.what} className="mt-1" />
                ) : it.kind === "document" ? (
                  <span className="mt-0.5 block truncate text-xs text-ink-soft">
                    {it.what}
                    {it.count && it.count > 1 ? ` and ${it.count - 1} more` : ""}
                  </span>
                ) : null}
                <span className="mt-0.5 block truncate text-2xs text-muted">
                  {ago(it.at, now)}
                  {it.who ? ` · ${it.who}` : ""}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
