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

export function fmtMoney(amount: number | null | undefined, currency: string) {
  if (amount == null) return "";
  return `${currency} ${amount.toLocaleString("en-IN")}`;
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
