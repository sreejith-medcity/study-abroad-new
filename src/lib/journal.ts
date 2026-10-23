/**
 * The daily journal's clock, kept free of the database so the screens, the
 * scheduler and the suites all read the working day the same way.
 *
 * Every time here is India time, whatever the server's own clock is set to:
 * the day ends at 5:30 PM in Kottayam, not in the data centre.
 */

export const IST = "Asia/Kolkata";

/** The working day a moment falls on, as YYYY-MM-DD in India time. */
export function istDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** A clock time on a working day, "17:30" on "2026-10-23", as an instant. */
export function istAt(day: string, hhmm: string): Date {
  const [h, m] = hhmm.split(":");
  return new Date(`${day}T${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}:00+05:30`);
}

/** The day after, as YYYY-MM-DD. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The day before, as YYYY-MM-DD. */
export function previousDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const isSunday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay() === 0;

/** "17:30" to "5:30 PM", the way the screens say it. */
export function clockText(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const pm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
}

/** An instant as "5:42 PM" in India time. */
export function istClock(at: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at)).toUpperCase();
}

/** "23 Oct 2026", "Friday 23 October" for a heading. */
export function dayText(day: string, long = false): string {
  return new Intl.DateTimeFormat("en-GB", long ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" } : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

export type JournalClock = { dayEnd: string; outOfHours: string; cutoff: string; onSundays: boolean };

/**
 * Where a working day stands. Before the day ends the journal is still being
 * written. From the end of the day until the cutoff it is open to verify.
 * After the cutoff it is closed, and an answer not given is a journal missed.
 * A Sunday has no journal unless Settings asks for one.
 */
export type JournalPhase = "NONE" | "BEFORE" | "OPEN" | "CLOSED";

export function journalPhase(day: string, clock: JournalClock, now: Date = new Date()): JournalPhase {
  if (isSunday(day) && !clock.onSundays) return "NONE";
  if (now < istAt(day, clock.dayEnd)) return "BEFORE";
  if (now < istAt(day, clock.cutoff)) return "OPEN";
  return "CLOSED";
}

/** A valid "HH:MM" on the 24-hour clock. */
export const isClock = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** How somebody's day reads on the consolidated report. */
export type JournalStanding = "VERIFIED" | "VERIFIED_LATE" | "FLAGGED" | "PENDING" | "MISSED";

export const STANDING_LABEL: Record<JournalStanding, string> = {
  VERIFIED: "Verified",
  VERIFIED_LATE: "Verified after hours",
  FLAGGED: "Flagged a problem",
  PENDING: "Not yet verified",
  MISSED: "Missed",
};

/** What each kind of line in a journal is called, for the totals at the top. */
export const KIND_LABEL: Record<string, string> = {
  signin: "Sign-ins",
  student: "Students registered",
  application: "Applications made",
  status: "Status changes",
  upload: "Documents uploaded",
  check: "Documents checked",
  ask: "Documents asked for",
  contact: "Calls and messages logged",
  followup_done: "Follow-ups done",
  followup_set: "Follow-ups set",
  message: "Messages and notes",
  enquiry: "Enquiries",
  payment: "Payments recorded",
  other: "Other changes",
};

/**
 * Who is issued a journal: Medcity's own people, at the head office and the
 * Medcity branches. Not a sub-agent firm's staff, not the super admin who
 * owns the platform, and not management, who read and change nothing.
 */
export const NOT_ISSUED = ["SUPER_ADMIN", "MANAGEMENT", "STUDENT", "PARENT"] as const;
export function journalIssued(role: string, orgType: string) {
  return !(NOT_ISSUED as readonly string[]).includes(role) && (orgType === "HQ" || orgType === "BRANCH");
}

/** Who reads the consolidated report. */
export const REPORT_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "MANAGEMENT"] as const;
export const readsJournalReport = (role: string) => (REPORT_ROLES as readonly string[]).includes(role);
