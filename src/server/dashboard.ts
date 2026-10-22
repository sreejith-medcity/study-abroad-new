import "server-only";
import { getSettings, slaDays } from "./settings";

/**
 * How long a lane may sit untouched.
 *
 * What is left of this module. It used to hold the queries behind seven
 * dashboards, one per job: lane health, aging lists, officer load, partner
 * leaderboards, country and pathway mixes, six-month trends. The dashboard is
 * now a board of figures, which has its own definitions in dashboard-tiles.ts,
 * and the lists those queries drew are read where the work is done rather than
 * on a screen somebody opens to look. They are in the history if any of them
 * is wanted back.
 *
 * The service levels stayed because the work queue measures against them.
 */

/**
 * Days a lane may sit untouched before it counts as late. The real numbers live in
 * platform settings; these are only the fallback for a database that has not been
 * read yet. Call getSlaDays() wherever the figure is shown or compared.
 */
export const SLA_DAYS: Record<string, number> = {
  NEW: 2,
  PENDING_PARTNER: 5,
  IN_PROGRESS: 7,
  OFFER: 10,
  HOLD: 60,
};

/** The configured service levels, cached per request by getSettings. */
export async function getSlaDays(): Promise<Record<string, number>> {
  return slaDays(await getSettings());
}
