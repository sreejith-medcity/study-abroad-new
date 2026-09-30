/**
 * Routes: who an application is sent through.
 *
 * Medcity reaches the same university by more than one road, and the roads pay
 * differently, answer at different speeds and ask for different paperwork. A
 * route is one road to one course. Everything here is pure, so the same rules
 * hold on a search page, on a program page and in a test.
 */

/** The colours a vendor can be given. Each is dark enough for white text. */
export const VENDOR_COLOURS = [
  { value: "#0F766E", label: "Teal" },
  { value: "#4338CA", label: "Indigo" },
  { value: "#B45309", label: "Amber" },
  { value: "#BE185D", label: "Rose" },
  { value: "#15803D", label: "Green" },
  { value: "#475569", label: "Slate" },
  { value: "#7C3AED", label: "Violet" },
  { value: "#0E7490", label: "Cyan" },
] as const;

export const COLOUR_VALUES = VENDOR_COLOURS.map((c) => c.value);
export const isColour = (v: string) => COLOUR_VALUES.includes(v as (typeof COLOUR_VALUES)[number]);

/** Two to four letters, shown beside the colour so the screen reads without it. */
export const CODE_RE = /^[A-Z]{2,4}$/;
export const tidyCode = (v: string) => v.trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);

export const PAYABLE_ON = {
  OFFER_ACCEPTED: "the offer is accepted",
  FEE_PAID: "the student pays the fee",
  VISA_APPROVED: "the visa is approved",
  ENROLMENT_CONFIRMED: "enrolment is confirmed",
} as const;
export type PayableOn = keyof typeof PAYABLE_ON;

export type VendorTerms = { payableOn: PayableOn; daysToPay: number };
export type RouteLike = {
  basis: "PERCENT_TUITION" | "FLAT";
  percentOfTuition: number | null;
  flatAmount: number | null;
  currency: string | null;
  payableOn: PayableOn | null;
  daysToPay: number | null;
  applicationFee: number | null;
  offerTatDays: number | null;
  active: boolean;
};
export type ProgramMoney = {
  tuitionPerYear: number | null;
  tuitionTotal: number | null;
  applicationFee: number | null;
  offerTatDays: number | null;
  currency: string;
};

export type RouteCommission =
  | { known: true; amount: number; currency: string; basis: string }
  | { known: false; reason: string; basis: string };

/**
 * What this route pays Medcity for one placement.
 *
 * A percentage is of the first year's tuition, which is the only figure both
 * sides agree on. Where only a whole-course fee is on record the percentage is
 * not applied to it: that would invent a yearly figure the institution never
 * published, so the terms are shown and the amount is not.
 */
export function routeCommission(route: RouteLike, program: ProgramMoney): RouteCommission {
  if (route.basis === "FLAT") {
    if (route.flatAmount == null) return { known: false, reason: "Flat fee not recorded", basis: "Flat fee" };
    return { known: true, amount: route.flatAmount, currency: route.currency || program.currency, basis: "Flat fee" };
  }
  const pct = route.percentOfTuition;
  if (pct == null) return { known: false, reason: "Rate not recorded", basis: "Percentage of the first year" };
  const basis = `${pct}% of the first year`;
  if (program.tuitionPerYear == null) {
    return {
      known: false,
      basis,
      reason: program.tuitionTotal == null ? "No tuition on record" : "Only a whole-course fee on record",
    };
  }
  return { known: true, amount: Math.round((program.tuitionPerYear * pct) / 100), currency: program.currency, basis };
}

/** The terms that apply, which fall back to the vendor's where the route says nothing. */
export const routeTerms = (route: RouteLike, vendor: VendorTerms): VendorTerms => ({
  payableOn: route.payableOn ?? vendor.payableOn,
  daysToPay: route.daysToPay ?? vendor.daysToPay,
});

/** The application fee and the turnaround, which fall back to the program's own. */
export const routeApplicationFee = (route: RouteLike, program: ProgramMoney) => route.applicationFee ?? program.applicationFee;
export const routeOfferTat = (route: RouteLike, program: ProgramMoney) => route.offerTatDays ?? program.offerTatDays;

/**
 * The route to put first: the one that pays Medcity most, in rupees at the
 * platform's indicative rates, among those still live. A route whose
 * commission is not on record never wins, because an unknown is not a zero
 * and is not a maximum either.
 */
export function bestRoute<T extends { route: RouteLike; commission: RouteCommission }>(rows: T[], rates: Record<string, number>): T | null {
  const inr = (c: RouteCommission) => {
    if (!c.known) return -1;
    const rate = c.currency === "INR" ? 1 : rates[c.currency];
    return rate && rate > 0 ? c.amount * rate : -1;
  };
  const live = rows.filter((r) => r.route.active);
  if (!live.length) return null;
  return live.reduce((best, r) => (inr(r.commission) > inr(best.commission) ? r : best), live[0]);
}

/** How long ago the terms were confirmed, and whether that is long enough to say so. */
export const STALE_AFTER_DAYS = 180;
export function termsAge(confirmedAt: Date | null, today = new Date()) {
  if (!confirmedAt) return { days: null as number | null, stale: true, text: "Terms never confirmed" };
  const days = Math.floor((today.getTime() - confirmedAt.getTime()) / 86_400_000);
  return { days, stale: days > STALE_AFTER_DAYS, text: days === 0 ? "Terms confirmed today" : `Terms confirmed ${days} day${days === 1 ? "" : "s"} ago` };
}
