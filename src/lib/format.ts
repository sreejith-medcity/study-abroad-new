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
