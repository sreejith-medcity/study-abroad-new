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

export function fxToInr(currency: string, configured?: Record<string, number>) {
  const rates = { ...DEFAULT_FX };
  for (const pair of (process.env.COMMISSION_FX ?? "").split(",")) {
    const [code, rate] = pair.split(":");
    const value = Number(rate);
    if (code && !Number.isNaN(value) && value > 0) rates[code.trim().toUpperCase()] = value;
  }
  // Platform settings win over both the built-in table and the environment.
  for (const [code, value] of Object.entries(configured ?? {})) {
    if (!Number.isNaN(value) && value > 0) rates[code.toUpperCase()] = value;
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

export type RuleScope = RuleAmounts & {
  id: string;
  programId: string | null;
  universityId: string | null;
  countryId: string | null;
  intakeYear: number | null;
  currency: string;
};

/**
 * The rule that would pay on a program, for showing partners what they can
 * expect before anyone applies: the most specific live rule wins (program, then
 * university, then country), and one pinned to a coming intake year beats an
 * open one. Rules pinned to a past year are ignored.
 */
export function pickRule<R extends RuleScope>(rules: R[], programId: string, universityId: string, countryId: string, year = new Date().getFullYear()): R | null {
  const fits = rules.filter((r) => (r.programId === programId || r.universityId === universityId || r.countryId === countryId) && (r.intakeYear == null || r.intakeYear >= year));
  const score = (r: R) => (r.programId === programId ? 100 : r.universityId === universityId ? 50 : 20) + (r.intakeYear != null ? 5 : 0);
  return fits.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * The partner's share on one program under a rule. A percentage needs a
 * verified yearly tuition; without one the amount stays null and the terms are
 * shown instead, never a figure worked out from a whole-course fee.
 */
export function partnerEstimate(rule: RuleScope, tuitionPerYear: number | null, programCurrency: string) {
  const share = rule.partnerSharePercent;
  if (rule.basis === "FLAT") {
    const amount = rule.flatAmount != null ? Math.round((rule.flatAmount * share) / 100) : null;
    return { amount, currency: rule.currency, terms: `${share}% of a flat ${money(rule.flatAmount, rule.currency)}` };
  }
  const pct = rule.percentOfTuition ?? 0;
  const amount = tuitionPerYear != null && tuitionPerYear > 0 ? Math.round((tuitionPerYear * pct * share) / 10000) : null;
  return { amount, currency: programCurrency, terms: `${share}% of ${pct}% of first-year tuition` };
}
