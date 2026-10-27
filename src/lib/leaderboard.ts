/**
 * The counsellor leaderboard: what each person's recorded work adds up to over
 * a period, and how a figure reads when nothing was recorded.
 *
 * A count of nothing is not the same as nothing recorded. A counsellor with no
 * calls logged may have made forty and logged none, so the board says "Not
 * recorded" rather than putting a 0 beside their name as if it were known.
 * Pure, so the page, the CSV and the tests read one rule.
 */

export const NOT_RECORDED = "Not recorded";

export type LeaderboardCounts = {
  /** Calls logged, students and enquiries together. */
  calls: number;
  /** Of those, the ones where somebody was reached. */
  connected: number;
  /** Follow-up tasks on their desk finished in the period, on or before the day they were due. */
  onTime: number;
  /** And finished after it. */
  late: number;
  /** Enquiries they held that became students in the period. */
  converted: number;
  /** Enquiries they hold at all; nothing to convert means nothing recorded. */
  enquiriesHeld: number;
};

export type LeaderboardFigures = {
  calls: number | null;
  connected: number | null;
  connectedPct: number | null;
  onTime: number | null;
  late: number | null;
  converted: number | null;
};

/** The figures as they are shown: null wherever there is no record to stand on. */
export function leaderboardFigures(c: LeaderboardCounts): LeaderboardFigures {
  const anyCalls = c.calls > 0;
  const anyFollowUps = c.onTime + c.late > 0;
  return {
    calls: anyCalls ? c.calls : null,
    connected: anyCalls ? c.connected : null,
    connectedPct: anyCalls ? Math.round((100 * c.connected) / c.calls) : null,
    onTime: anyFollowUps ? c.onTime : null,
    late: anyFollowUps ? c.late : null,
    converted: c.enquiriesHeld > 0 || c.converted > 0 ? c.converted : null,
  };
}

export const shown = (v: number | null) => (v === null ? NOT_RECORDED : String(v));

/**
 * Whether a follow-up was done on time: on or before the India day it was due.
 * The task carries a day, not a time, so "on time" is the whole of that day.
 */
export const doneOnTime = (dueOn: string, doneDay: string) => doneDay <= dueOn;

/**
 * Who comes first: most converted, then most connected, then most calls, then
 * by name. Not recorded counts below a recorded 0, so a person who logged
 * nothing never sits above one who logged and missed.
 */
export function compareLeaders(a: { name: string; f: LeaderboardFigures }, b: { name: string; f: LeaderboardFigures }): number {
  const v = (n: number | null) => (n === null ? -1 : n);
  return v(b.f.converted) - v(a.f.converted) || v(b.f.connected) - v(a.f.connected) || v(b.f.calls) - v(a.f.calls) || a.name.localeCompare(b.name);
}

export type Period = { from: string; to: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The period asked for, made safe: both ends real days, the start not after
 * the end, and no longer than a year, defaulting to the month so far.
 */
export function readPeriod(raw: { from?: string | null; to?: string | null }, today: string): Period {
  const real = (v: string | null | undefined) => (v && DAY.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? v : null);
  let to = real(raw.to) ?? today;
  let from = real(raw.from) ?? `${today.slice(0, 7)}-01`;
  if (from > to) [from, to] = [to, from];
  const yearBefore = new Date(`${to}T00:00:00Z`);
  yearBefore.setUTCDate(yearBefore.getUTCDate() - 365);
  const floor = yearBefore.toISOString().slice(0, 10);
  if (from < floor) from = floor;
  return { from, to };
}

/** One CSV cell, quoted, with anything a spreadsheet would run as a formula defused. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const LEADERBOARD_HEADER = ["Counsellor", "Branch", "Calls made", "Connected", "Connected %", "Follow-ups on time", "Follow-ups late", "Enquiries converted"];

export function leaderboardCsvRow(r: { name: string; branch: string; f: LeaderboardFigures }): string {
  const f = r.f;
  return [r.name, r.branch, shown(f.calls), shown(f.connected), f.connectedPct === null ? NOT_RECORDED : `${f.connectedPct}%`, shown(f.onTime), shown(f.late), shown(f.converted)]
    .map(csvCell)
    .join(",");
}
