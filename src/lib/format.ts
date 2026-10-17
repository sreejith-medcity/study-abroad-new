import { format } from "date-fns";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function intakeLabel(month: number, year: number) {
  return `${MONTHS[month - 1]}-${year}`;
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "";
  return format(new Date(d), "dd/MM/yyyy");
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "";
  return format(new Date(d), "dd/MM/yyyy hh:mm a");
}

/**
 * A number with Indian grouping: 12,34,567 rather than 1,234,567.
 *
 * Written out rather than left to toLocaleString("en-IN"), because a number
 * in a component that runs in the browser is formatted twice, once by the
 * server's Node and once by the browser, and the two only agree if the
 * server's Node was built with the full set of locale data. On a host where
 * it was not, the server writes 1,234,567 and the browser writes 12,34,567:
 * the same number, a different string, and React throws out the page. This
 * gives one answer everywhere.
 */
export function groupInr(n: number): string {
  const neg = n < 0;
  const [whole, fraction] = Math.abs(n).toString().split(".");
  // The last three digits, then pairs: 1 23 45 678.
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  return `${neg ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function fmtMoney(amount: number | null | undefined, currency: string) {
  if (amount == null) return "";
  return `${currency} ${groupInr(amount)}`;
}

/** Indian financial year label, e.g. 26-27 for dates between Apr 2026 and Mar 2027. */
export function financialYear(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y % 100).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;
}

export function fullName(s: { firstName: string; lastName: string }) {
  return `${s.firstName} ${s.lastName}`.trim();
}

/** First name for greetings. Desk-style accounts ("UK Documentation") keep the full name. */
export function greetingName(name: string) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return first.length >= 4 ? first : name;
}

/** Events are run from Kerala, so their times are entered and shown in IST. */
export function istDateTime(d: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d)) + " IST";
}
export function istTime(d: Date | string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" }).format(new Date(d));
}
/** A datetime-local value ("2027-03-14T18:30") read as IST. */
export function fromIstInput(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? new Date(`${v}:00+05:30`) : null;
}
