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
