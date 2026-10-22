"use client";

import { useState } from "react";

type Month = { key: string; label: string; year: number; registrations: number; applications: number };

/** A round top for the scale, so the axis reads 0 / 40 / 80 rather than 0 / 37 / 74. */
function niceTop(max: number) {
  if (max <= 4) return 4;
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 4, 5, 8, 10]) if (m * step >= max) return m * step;
  return 10 * step;
}
const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n)));

/**
 * The two lines are a blue and an orange, fixed rather than taken from the
 * brand: the brand colour is whatever the portal is set to, and a crimson
 * brand against a green second line was all but one colour to a reader with
 * red-green colour blindness. Blue and orange stay apart for every kind of
 * colour vision, checked rather than judged by eye.
 */
export const REGS = "var(--color-info-500)";
export const APPS = "#e2711d";

const W = 640;
const H = 220;
const L = 34;
const R = 12;
const T = 14;
const B = 26;

/**
 * Registrations and applications, a year of months, as two lines on one
 * scale. Both are counts of the same kind of thing, so one axis is honest;
 * the legend says which line is which and the hover says each month's two
 * figures together, on a rule drawn down the month.
 */
export function MonthlyLines({ months }: { months: Month[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = niceTop(Math.max(...months.map((m) => Math.max(m.registrations, m.applications)), 0));
  // Quarters only where they come out whole; otherwise halves.
  const ticks = top % 4 === 0 ? [0, top / 4, top / 2, (top * 3) / 4, top] : [0, top / 2, top];
  const x = (i: number) => L + (i * (W - L - R)) / (months.length - 1);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const line = (k: "registrations" | "applications") => months.map((m, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(m[k]).toFixed(1)}`).join(" ");
  const area = `${line("registrations")} L${x(months.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const h = hover !== null ? months[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Registrations and applications per month, last twelve months" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
            <text x={L - 8} y={y(t) + 3.5} textAnchor="end" className="fill-muted text-[10.5px] tabular">
              {compact(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) => (
          <text key={m.key} x={x(i)} y={H - 7} textAnchor="middle" className="fill-muted text-[10.5px]">
            {m.label}
          </text>
        ))}
        <path d={area} fill="var(--color-info-500)" opacity="0.09" />
        <path d={line("registrations")} fill="none" stroke="var(--color-info-500)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={line("applications")} fill="none" stroke={APPS} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--color-ink)" strokeOpacity="0.2" />
            <circle cx={x(hover)} cy={y(h.registrations)} r="4.5" fill="var(--color-info-500)" stroke="var(--color-surface)" strokeWidth="2" />
            <circle cx={x(hover)} cy={y(h.applications)} r="4.5" fill={APPS} stroke="var(--color-surface)" strokeWidth="2" />
          </g>
        )}
        {/* A band per month, wider than the line, so the hover finds it. */}
        {months.map((m, i) => (
          <rect
            key={m.key}
            x={x(i) - (W - L - R) / (months.length - 1) / 2}
            y={T}
            width={(W - L - R) / (months.length - 1)}
            height={H - T - B}
            fill="transparent"
            tabIndex={0}
            aria-label={`${m.label} ${m.year}: ${m.registrations} registrations, ${m.applications} applications`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            className="outline-none"
          />
        ))}
      </svg>
      {h && hover !== null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-2 z-10 whitespace-nowrap rounded-lg bg-ink px-3 py-2 text-xs text-surface shadow-pop"
          style={hover > months.length / 2 ? { right: `${100 - (x(hover) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}
        >
          <span className="block text-2xs opacity-70">
            {h.label} {h.year}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-full bg-info-500" /> <b>{h.registrations}</b> registrations
          </span>
          <span className="flex items-center gap-1.5">
            <i className="size-2 rounded-full" style={{ background: APPS }} /> <b>{h.applications}</b> applications
          </span>
        </div>
      )}
      <table className="sr-only">
        <caption>Registrations and applications per month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Registrations</th>
            <th>Applications</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m.key}>
              <td>
                {m.label} {m.year}
              </td>
              <td>{m.registrations}</td>
              <td>{m.applications}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
