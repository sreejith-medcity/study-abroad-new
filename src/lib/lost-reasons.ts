/**
 * Lost reasons: the list a branch picks from when an enquiry does not go
 * ahead, and the arithmetic of the report that counts them. Pure.
 */

/** What the list starts with, in the order it is offered. Kept in Settings from then on. */
export const DEFAULT_LOST_REASONS = [
  "Not reachable",
  "Budget",
  "Chose another agency",
  "Not eligible",
  "Postponed",
  "Visa concerns",
  "Other",
] as const;

/** What an enquiry closed before the list existed shows where the reason would be. */
export const NOT_RECORDED = "Not recorded";

/** The reason as one line: the label picked, then the words typed beside it. */
export function lostReasonText(label: string | null | undefined, detail: string | null | undefined): string {
  const l = label?.trim();
  const d = detail?.trim();
  if (l && d) return `${l}: ${d}`;
  if (l) return l;
  if (d) return d;
  return NOT_RECORDED;
}

export type LostRow = {
  reason: string | null;
  detail: string | null;
  source: string;
  branch: string;
};

export type Tally = { label: string; count: number; share: number };

function tallyBy(rows: LostRow[], key: (r: LostRow) => string): Tally[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  const total = rows.length;
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Counts by reason, by source and by branch. An enquiry closed before the
 * list existed has no reason picked, and is counted as "Not recorded" rather
 * than guessed into one of the reasons from what was typed.
 */
export function tallyLost(rows: LostRow[], sourceLabel: (s: string) => string = (s) => s) {
  return {
    total: rows.length,
    byReason: tallyBy(rows, (r) => r.reason ?? NOT_RECORDED),
    bySource: tallyBy(rows, (r) => sourceLabel(r.source)),
    byBranch: tallyBy(rows, (r) => r.branch),
  };
}

/** One spreadsheet cell, with anything a spreadsheet would run as a formula made inert. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export type LostCsvRow = LostRow & { name: string; lostOn: string | null; owner: string | null };

/** The report as a file: the three counts, then one line per enquiry behind them. */
export function lostReportCsv(rows: LostCsvRow[], period: { from: string; to: string }, sourceLabel: (s: string) => string = (s) => s): string {
  const t = tallyLost(rows, sourceLabel);
  const lines: string[] = [];
  const line = (...cells: unknown[]) => lines.push(cells.map(csvCell).join(","));
  line("Lost enquiries", `${period.from} to ${period.to}`, t.total);
  for (const [title, list] of [
    ["By reason", t.byReason],
    ["By source", t.bySource],
    ["By branch", t.byBranch],
  ] as const) {
    lines.push("");
    line(title, "Enquiries", "Share");
    for (const x of list) line(x.label, x.count, `${Math.round(x.share * 100)}%`);
  }
  lines.push("");
  line("Enquiry", "Branch", "Source", "Reason", "Detail", "Owner", "Lost on");
  for (const r of rows) line(r.name, r.branch, sourceLabel(r.source), r.reason ?? NOT_RECORDED, r.detail ?? "", r.owner ?? "Unassigned", r.lostOn ?? NOT_RECORDED);
  return lines.join("\n") + "\n";
}

/**
 * The period a report covers, from what was asked for. Dates are whole days
 * in YYYY-MM-DD; anything unreadable falls back to the current month so far.
 * The end is inclusive.
 */
export function reportPeriod(from: string | undefined, to: string | undefined, today: string): { from: string; to: string } {
  const ok = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  const start = ok(from) ? from! : `${today.slice(0, 7)}-01`;
  const end = ok(to) ? to! : today;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}
