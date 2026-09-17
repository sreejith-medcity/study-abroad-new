/**
 * Money and commission arithmetic. Kept out of the server modules so the
 * calculations can be unit tested on their own.
 */

/**
 * Indicative rates so every commission carries a rupee figure from the start.
 * The real amount is entered when the partner's share is settled, which
 * overwrites this estimate. Override through COMMISSION_FX, for example
 * COMMISSION_FX="GBP:115,EUR:98".
 */
const DEFAULT_FX: Record<string, number> = { INR: 1, GBP: 112, EUR: 96, AUD: 58, CAD: 62, USD: 88 };

export function fxToInr(currency: string) {
  const rates = { ...DEFAULT_FX };
  for (const pair of (process.env.COMMISSION_FX ?? "").split(",")) {
    const [code, rate] = pair.split(":");
    const value = Number(rate);
    if (code && !Number.isNaN(value) && value > 0) rates[code.trim().toUpperCase()] = value;
  }
  return rates[currency.toUpperCase()] ?? 1;
}

export type RuleAmounts = {
  basis: string;
  percentOfTuition: number | null;
  flatAmount: number | null;
  partnerSharePercent: number;
};

/** What Medcity earns on a placement, and what the partner keeps of it. */
export function amountsFor(rule: RuleAmounts, tuition: number | null) {
  const gross =
    rule.basis === "FLAT"
      ? Math.round(rule.flatAmount ?? 0)
      : Math.round(((tuition ?? 0) * (rule.percentOfTuition ?? 0)) / 100);
  const partner = Math.round((gross * rule.partnerSharePercent) / 100);
  return { gross, partner };
}

/** Rupees, no decimals: every amount in the money modules is a whole unit. */
export function inr(amount: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount ?? 0);
}

export function money(amount: number | null | undefined, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount ?? 0);
}

/** Percentage of a whole, safe when the whole is zero. */
export function rate(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}
