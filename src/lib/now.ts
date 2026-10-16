/**
 * Reading "now" in a component that renders twice.
 *
 * A client component runs on the server to make the HTML and again in the
 * browser to hydrate it. If it asks its own machine what today is, the two
 * machines answer in their own timezones, cross into the next day, month or
 * year hours apart, and render different HTML. React reports that as a
 * hydration error, and because it only happens for a few hours around a
 * boundary it reads as random. The portal carried one of these on the apply
 * tab for weeks.
 *
 * So: never call new Date() in a client component. Either take the value from
 * the server as a prop, which is best when the answer should be the office's
 * day rather than the viewer's, or use one of these, which are read in UTC and
 * therefore give one answer for every machine at the same instant.
 */

/** This month as a sortable number, 202610 for October 2026. */
export function utcYearMonth(now: Date = new Date()): number {
  return now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
}

/** This year. */
export function utcYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/** Today as YYYY-MM-DD, the form a date input wants. */
export function utcToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
