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
