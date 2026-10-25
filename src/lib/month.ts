import { istDay } from "./journal";

/**
 * A calendar month as "YYYY-MM", the way the targets and the month of day end
 * figures address one. Every boundary here is India time: a month begins at
 * midnight in Kottayam, whatever the server's own clock says.
 */

/** This month as YYYY-MM in India time. */
export const thisMonth = (now = new Date()) => istDay(now).slice(0, 7);

export const isMonth = (v: string | undefined): v is string => !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** The month so many months on (or back, with a negative number). */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "October 2026". */
export function monthText(month: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}

/** The month's first day and the day after its last, as YYYY-MM-DD, for a range on a date column. */
export function monthDays(month: string) {
  return { first: `${month}-01`, next: `${shiftMonth(month, 1)}-01` };
}

/** The month's first instant and the first instant of the next, in India time, for a range on a timestamp column. */
export function monthBounds(month: string) {
  const { first, next } = monthDays(month);
  return { from: new Date(`${first}T00:00:00+05:30`), to: new Date(`${next}T00:00:00+05:30`) };
}
