/** Dates are calendar days in IST, stored as yyyy-mm-dd. */
const istToday = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

export function promotionState(startsOn: string, endsOn: string, now = new Date()): "upcoming" | "running" | "ended" {
  const today = istToday(now);
  if (today < startsOn) return "upcoming";
  if (today > endsOn) return "ended";
  return "running";
}

/** Whole days left including today, for a running scheme. */
export function daysLeft(endsOn: string, now = new Date()) {
  const today = istToday(now);
  return Math.round((Date.parse(`${endsOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) + 1;
}

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const rangeText = (a: string, b: string) => `${fmt(a)} to ${fmt(b)}`;
