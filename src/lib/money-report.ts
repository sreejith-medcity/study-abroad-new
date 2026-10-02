/**
 * What management reads on a Monday.
 *
 * Four questions, and the figures that answer them: which road the money comes
 * down, which line it comes from, which branch sent the student, and which
 * country pays. The counting happens in the server module beside this; the
 * arithmetic and the judgements are here, so they can be tested without a
 * database and so two screens cannot reach different conclusions about the same
 * rupees.
 *
 * Nothing on these tables is worked out from a figure nobody recorded. A column
 * with nothing behind it is null here and reads "Not recorded" on the screen,
 * never nought, because nought is a number a person will act on.
 */

/** The Indian financial year: 1 April to 31 March. */
export type FinancialYear = { key: string; label: string; from: string; to: string };

/** The year a date falls in, as a label like "2026-27". */
export function financialYearOf(d: Date): FinancialYear {
  const start = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return {
    key: String(start),
    label: `${start}-${String((start + 1) % 100).padStart(2, "0")}`,
    from: `${start}-04-01`,
    to: `${start + 1}-03-31`,
  };
}

/** This year and the ones before it, newest first, for the picker. */
export function financialYears(today: Date, back = 3): FinancialYear[] {
  const now = financialYearOf(today);
  const first = Number(now.key);
  return Array.from({ length: back + 1 }, (_, i) => financialYearOf(new Date(Date.UTC(first - i, 6, 1))));
}

/** The year a key names, falling back to the one we are in. */
export function financialYearFrom(key: string | undefined, today: Date): FinancialYear {
  const wanted = Number(key);
  return Number.isInteger(wanted) && wanted > 2000 && wanted < 2100 ? financialYearOf(new Date(Date.UTC(wanted, 6, 1))) : financialYearOf(today);
}

/** Per student, or null where there is nothing to divide, or nobody to divide it by. */
export const perStudent = (total: number | null, students: number): number | null =>
  total == null || students <= 0 ? null : Math.round(total / students);

/** A share of the whole, or null where either side of the sum was never recorded. */
export const share = (part: number | null, whole: number | null): number | null =>
  part == null || whole == null || whole <= 0 ? null : (part / whole) * 100;

/**
 * Adds up what was recorded, and says so when nothing was.
 *
 * Treating a missing figure as nought is how a column of unpriced lines comes to
 * read as a branch that sold nothing, which is a different thing and one
 * somebody would act on.
 */
export function addUp(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v != null);
  return known.length === 0 ? null : known.reduce((a, b) => a + b, 0);
}

/**
 * The middle value, not the average.
 *
 * One vendor who paid after four hundred days drags an average far enough to
 * make a route look worse than every invoice on it, and the figure is read to
 * decide which road to send students down.
 */
export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export type MoneyRow = {
  key: string;
  label: string;
  students: number;
  /** Null where not one line behind the row carries a figure. Never nought standing in for unknown. */
  expected: number | null;
  received: number | null;
  /** Null until somebody has been paid, because nought days is not the same as never. */
  daysToPay: number | null;
};

export type ShapedRow = MoneyRow & { perStudent: number | null; stillToCome: number | null; share: number | null };

/**
 * Puts the money that arrived first, because the question on a Monday is where
 * it came from rather than where it was promised.
 */
export function shape(rows: MoneyRow[]): { rows: ShapedRow[]; total: { students: number; expected: number | null; received: number | null } } {
  const received = addUp(rows.map((r) => r.received));
  const rank = (n: number | null) => n ?? -1;
  const shaped = rows
    .map((r) => ({
      ...r,
      perStudent: perStudent(r.received, r.students),
      // Never below nought: a vendor who paid more than was expected has nothing
      // still to come, and a negative figure in that column reads as a credit.
      stillToCome: r.expected == null ? null : r.received == null ? r.expected : Math.max(0, r.expected - r.received),
      share: share(r.received, received),
    }))
    .sort((a, b) => rank(b.received) - rank(a.received) || rank(b.expected) - rank(a.expected) || a.label.localeCompare(b.label));
  return {
    rows: shaped,
    total: {
      students: rows.reduce((sum, r) => sum + r.students, 0),
      expected: addUp(rows.map((r) => r.expected)),
      received,
    },
  };
}

/**
 * Rupees as a person says them.
 *
 * Three point one crore is read at a glance; 31,000,000 is counted on the
 * screen with a finger. Below a lakh the exact figure is the useful one.
 */
export function inWords(amount: number | null | undefined, currency = "INR"): string {
  if (amount == null) return "Not recorded";
  const n = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (n >= 1_00_00_000) return `${sign}${currency} ${trim(n / 1_00_00_000)} cr`;
  if (n >= 1_00_000) return `${sign}${currency} ${trim(n / 1_00_000)} lakh`;
  return `${sign}${currency} ${n.toLocaleString("en-IN")}`;
}

const trim = (n: number) => String(Number(n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)));

/** Days to pay, said plainly, including the case where nobody has paid yet. */
export const daysToPayText = (days: number | null): string => (days == null ? "Nobody has paid yet" : `${days} day${days === 1 ? "" : "s"}`);

/** A share as a percentage, or the honest absence of one. */
export const shareText = (pct: number | null): string => (pct == null ? "Not recorded" : pct >= 1 ? `${Math.round(pct)}%` : "<1%");

/**
 * The one sentence worth putting above the tables.
 *
 * The column that changes behaviour is the last one: a road that pays in fifty
 * days is worth more than one that pays in ninety-six at the same rate, and
 * nobody reads that off a table of four rows without being told.
 */
export function fastestPayer(rows: ShapedRow[]): string {
  const paid = rows.filter((r) => r.daysToPay != null && (r.received ?? 0) > 0);
  if (paid.length < 2) return "";
  const quick = paid.reduce((a, b) => (a.daysToPay! <= b.daysToPay! ? a : b));
  const slow = paid.reduce((a, b) => (a.daysToPay! >= b.daysToPay! ? a : b));
  if (quick.key === slow.key || slow.daysToPay! - quick.daysToPay! < 14) return "";
  return `${quick.label} pays in ${quick.daysToPay} days against ${slow.label}'s ${slow.daysToPay}, which is worth more than the same rate paid late.`;
}
