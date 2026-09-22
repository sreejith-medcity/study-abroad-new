import { fmtMoney, MONTHS } from "./format";

export const LEVEL_LABEL: Record<string, string> = {
  SCHOOL: "School",
  UG_DIPLOMA: "Diploma",
  UG: "Bachelor's",
  PG_DIPLOMA: "PG diploma",
  PG: "Master's",
  PHD: "PhD",
  VOCATIONAL: "Ausbildung",
  REGISTRATION: "Registration route",
  CERTIFICATE: "Certificate",
};

export const PATHWAY_LABEL: Record<string, string> = {
  DEGREE: "Degree",
  AUSBILDUNG: "Ausbildung",
  NURSING: "Nurse registration",
};

/**
 * Money in the catalogue has three states and each must read differently:
 * a figure the institution published, a zero it stated, and nothing because
 * nobody has verified it. Showing the third as "free" would mislead a student.
 */
export function feeText(amount: number | null | undefined, currency: string, labels: { zero: string; unknown?: string }) {
  if (amount == null) return labels.unknown ?? "Not recorded";
  if (amount === 0) return labels.zero;
  return fmtMoney(amount, currency);
}

export function intakesText(months: number[]) {
  return months.length ? months.map((m) => MONTHS[m - 1]).join(", ") : "Not recorded";
}

export function durationText(months: number | null | undefined) {
  if (months == null) return "Not recorded";
  if (months % 12 === 0) return `${months / 12} year${months === 12 ? "" : "s"}`;
  return `${months} months`;
}

/** Long enough to compare honestly, short enough that it is still a shortlist. */
export const SHORTLIST_LIMIT = 12;

/**
 * Tuition as the source published it: per year where known, otherwise the
 * whole-course figure (CRICOS publishes only that), never one derived from the other.
 */
export function tuitionText(perYear: number | null | undefined, total: number | null | undefined, currency: string) {
  if (perYear != null) return perYear === 0 ? "No tuition fee" : `${fmtMoney(perYear, currency)} / yr`;
  if (total != null) return total === 0 ? "No tuition fee" : `${fmtMoney(total, currency)} whole course`;
  return "Not recorded";
}

/**
 * A rough rupee figure for a foreign amount, for Indian families who think in
 * lakhs. Only with a rate the team has set on the platform; never shown when
 * the currency has no rate, and always marked as approximate.
 */
export function inrApprox(amount: number | null | undefined, currency: string, rates: Record<string, number>): string | null {
  if (amount == null || amount <= 0) return null;
  const rate = currency === "INR" ? 1 : rates[currency];
  if (!rate || rate <= 0) return null;
  const inr = amount * rate;
  if (inr >= 1e7) return `≈ ₹${(inr / 1e7).toFixed(inr >= 1e8 ? 0 : 1)} crore`;
  if (inr >= 1e5) return `≈ ₹${(inr / 1e5).toFixed(inr >= 1e7 ? 0 : 1)} lakh`;
  return `≈ ₹${(inr >= 1000 ? Math.round(inr / 1000) * 1000 : Math.round(inr)).toLocaleString("en-IN")}`;
}

/** Whole days from today (local midnight) to a yyyy-mm-dd date; negative once it has passed. */
export function daysUntil(isoDate: string, today = new Date()) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((new Date(y, m - 1, d).getTime() - start.getTime()) / 86_400_000);
}

/** "30 Jun 2027" for a yyyy-mm-dd date, without a time zone shifting the day. */
export function dayText(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "30 Jun 2027 (12 days left)", "closes today", or "closed 3 days ago". */
export function deadlineText(isoDate: string, today = new Date()) {
  const n = daysUntil(isoDate, today);
  const when = n === 0 ? "closes today" : n === 1 ? "1 day left" : n > 1 ? `${n} days left` : n === -1 ? "closed yesterday" : `closed ${-n} days ago`;
  return `${dayText(isoDate)} (${when})`;
}

/** What the visa rests on, by destination. */
export function confirmationLabel(countryCode: string) {
  return ({ GB: "CAS", US: "I-20", AU: "CoE", CA: "LOA", NZ: "Offer of place", IE: "Letter of acceptance", DE: "Admission letter" } as Record<string, string>)[countryCode] ?? "Confirmation of enrolment";
}
