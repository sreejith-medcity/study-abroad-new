import { COUNSELLING_ROLES } from "./permissions";

/**
 * The day end report's clock, kept free of the database so the screens, the
 * scheduler and the suites all read the working day the same way. The code
 * still calls the report a journal, after the bank teller's batch journal it
 * was modelled on; the screens say "day end report".
 *
 * Every time here is India time, whatever the server's own clock is set to:
 * the day ends at 5 PM in Kottayam, not in the data centre.
 */

export const IST = "Asia/Kolkata";

/** The working day a moment falls on, as YYYY-MM-DD in India time. */
export function istDay(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** A clock time on a working day, "17:00" on "2026-10-23", as an instant. */
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
 * Who is issued a day end report: Medcity's own people, at the head office
 * and the Medcity branches. Not a sub-agent firm's staff, not the super admin
 * who owns the platform, and not management, who read and change nothing.
 */
export const NOT_ISSUED = ["SUPER_ADMIN", "MANAGEMENT", "STUDENT", "PARENT"] as const;
export function journalIssued(role: string, orgType: string) {
  return !(NOT_ISSUED as readonly string[]).includes(role) && (orgType === "HQ" || orgType === "BRANCH");
}

/** Who reads the consolidated report. */
export const REPORT_ROLES = ["SUPER_ADMIN", "OPS_MANAGER", "ADMIN", "MANAGEMENT"] as const;
export const readsJournalReport = (role: string) => (REPORT_ROLES as readonly string[]).includes(role);

/* ---------------- The day end figures ---------------- */

/**
 * The five figures a counsellor types at the end of the day. Stored as one
 * JSON object on the report row, so a sixth figure is a new key here and
 * nothing else; the keys are listed in the order the boxes and columns show.
 */
export const FIGURE_KEYS = ["leadsReceived", "callsMade", "connectedCalls", "followUpsDone", "registrationsDone"] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];
export type DayEndFigures = Record<FigureKey, number | null>;

export const FIGURE_LABEL: Record<FigureKey, string> = {
  leadsReceived: "Leads received",
  callsMade: "Calls made",
  connectedCalls: "Connected calls",
  followUpsDone: "Follow-ups done",
  registrationsDone: "Registrations done",
};

/**
 * The figures the portal can count for somebody before they type anything:
 * calls they logged, follow-ups they marked done and students they registered
 * that day. Leads received and connected calls are not in the portal, so
 * those two boxes start empty.
 */
export const COUNTED_FIGURES = ["callsMade", "followUpsDone", "registrationsDone"] as const satisfies readonly FigureKey[];
export type CountedFigures = Partial<Pick<DayEndFigures, (typeof COUNTED_FIGURES)[number]>>;

/**
 * Who gives the figures: everybody who counsels, and the branch head, who
 * counsels alongside running the branch. Nobody else sees the boxes.
 */
export const FIGURES_ROLES = [...COUNSELLING_ROLES, "PARTNER"] as const;
export const givesFigures = (role: string) => (FIGURES_ROLES as readonly string[]).includes(role);

export const emptyFigures = (): DayEndFigures => ({ leadsReceived: null, callsMade: null, connectedCalls: null, followUpsDone: null, registrationsDone: null });

/**
 * What the boxes hold when the report opens: the portal's counts where it has
 * them (a count of nothing is 0, not blank, because nothing logged is itself
 * an answer), and blank where only the person knows. Every box stays
 * editable, because calls happen outside the portal too.
 */
export function prefillFigures(counted: CountedFigures): DayEndFigures {
  const out = emptyFigures();
  for (const k of COUNTED_FIGURES) out[k] = counted[k] ?? 0;
  return out;
}

export const FIGURE_BLANK = "Give a whole number. 0 if none.";
export const FIGURE_NOT_WHOLE = "A whole number, 0 or more.";
export const FIGURE_TOO_BIG = "That is more than a day holds. Check the figure.";
/** A day's figure never reaches six digits; anything larger is a slipped key. */
export const FIGURE_MAX = 99_999;

/**
 * The five boxes as typed, checked. Every one has to hold a whole number,
 * 0 included; a blank is refused, because a blank box on a report nobody
 * can tell from a 0. Thousands separators and surrounding spaces are
 * forgiven, since "1,250" is how people write it.
 */
export function parseFigures(raw: Partial<Record<FigureKey, string | null | undefined>>): { ok: true; figures: DayEndFigures } | { ok: false; fieldErrors: Partial<Record<FigureKey, string[]>> } {
  const figures = emptyFigures();
  const fieldErrors: Partial<Record<FigureKey, string[]>> = {};
  for (const k of FIGURE_KEYS) {
    const text = String(raw[k] ?? "")
      .trim()
      .replace(/,/g, "");
    if (text === "") {
      fieldErrors[k] = [FIGURE_BLANK];
      continue;
    }
    if (!/^\d+$/.test(text)) {
      fieldErrors[k] = [FIGURE_NOT_WHOLE];
      continue;
    }
    const n = Number(text);
    if (n > FIGURE_MAX) {
      fieldErrors[k] = [FIGURE_TOO_BIG];
      continue;
    }
    figures[k] = n;
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, figures };
}

/** The five added up across people. Somebody who gave nothing adds nothing. */
export function sumFigures(list: (DayEndFigures | null | undefined)[]): Record<FigureKey, number> {
  const out = { leadsReceived: 0, callsMade: 0, connectedCalls: 0, followUpsDone: 0, registrationsDone: 0 };
  for (const f of list) {
    if (!f) continue;
    for (const k of FIGURE_KEYS) out[k] += f[k] ?? 0;
  }
  return out;
}

export type FiguresPerson = { id: string; name: string; role: string; orgId: string; branch: string; figures: DayEndFigures | null };

/**
 * The counsellors on the consolidated report, grouped by branch in the order
 * they arrive, each branch with its own total and all of them with one more.
 * Only the roles that give figures are listed; a documentation officer who
 * verified their day has no row here, rather than a row of "Not given".
 */
export function figuresByBranch(people: FiguresPerson[]) {
  const branches: { orgId: string; name: string; people: FiguresPerson[]; totals: Record<FigureKey, number>; given: number }[] = [];
  for (const p of people) {
    if (!givesFigures(p.role)) continue;
    let b = branches.find((x) => x.orgId === p.orgId);
    if (!b) {
      b = { orgId: p.orgId, name: p.branch, people: [], totals: sumFigures([]), given: 0 };
      branches.push(b);
    }
    b.people.push(p);
  }
  for (const b of branches) {
    b.people.sort((x, y) => x.name.localeCompare(y.name));
    b.totals = sumFigures(b.people.map((p) => p.figures));
    b.given = b.people.filter((p) => p.figures).length;
  }
  const all = branches.flatMap((b) => b.people);
  return { branches, totals: sumFigures(all.map((p) => p.figures)), people: all.length, given: all.filter((p) => p.figures).length };
}
