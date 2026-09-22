/** Checks for the Indian tax and bank identifiers on a billing company. */

export const MAX_BILLING_COMPANIES = 4;

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** A GSTIN carries the PAN in characters 3 to 12. */
export const gstinMatchesPan = (gstin: string, pan: string) => gstin.slice(2, 12) === pan;

export function maskAccount(n: string) {
  const digits = n.replace(/\s/g, "");
  return digits.length <= 4 ? digits : `•••• ${digits.slice(-4)}`;
}

/** An LUT runs for a financial year; a lapsed one means GST applies to the invoice. */
export function lutState(validUntil: string | null, today = new Date()): "none" | "valid" | "expired" {
  if (!validUntil) return "none";
  return new Date(`${validUntil}T23:59:59`) >= today ? "valid" : "expired";
}
