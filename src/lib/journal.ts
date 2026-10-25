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

/**
 * Who reads the month of figures: the report's readers for every branch, and
 * a branch head for their own branch. A sub-agent's owner has the role but no
 * day end reports to read, so they are not let in.
 */
export const readsMonthFigures = (role: string, orgType: string) => readsJournalReport(role) || (role === "PARTNER" && journalIssued(role, orgType));
/** Whether this reader sees every branch, or only their own. */
export const readsEveryBranch = (role: string) => readsJournalReport(role);

/**
 * Which branches a reader's month of figures covers: every branch, or the one
 * they picked, for the report's readers; their own and nothing else for a
 * branch head, whatever the address asks for. Null when the role may not read
 * it at all. orgIds null means no filter.
 */
export type MonthScope = { every: boolean; orgIds: string[] | null; org: string | null };
export function monthScopeFor(user: { role: string; orgId: string; orgType: string }, requestedOrg?: string | null): MonthScope | null {
  if (!readsMonthFigures(user.role, user.orgType)) return null;
  if (readsEveryBranch(user.role)) return { every: true, orgIds: requestedOrg ? [requestedOrg] : null, org: requestedOrg ?? null };
  return { every: false, orgIds: [user.orgId], org: user.orgId };
}

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
 * The figures the portal can count for somebody before they type anything,
 * which is all five: the enquiries given to them, the calls they logged, the
 * calls they logged as reached, the follow-ups they marked done and the
 * students they registered, that day. A key the count did not deliver is
 * null, which the dashboard reads as not given yet; a counted 0 is a figure.
 */
export const COUNTED_FIGURES = FIGURE_KEYS;
export type CountedFigures = Partial<DayEndFigures>;

/**
 * Where each pre-filled figure came from, said under its box so the person
 * knows what they are correcting. The typed value always wins over the count.
 */
export const FIGURE_SOURCE: Record<FigureKey, string> = {
  leadsReceived: "from the enquiries given to you today",
  callsMade: "from the calls you logged",
  connectedCalls: "from the calls you logged as reached",
  followUpsDone: "from the follow-ups you marked done",
  registrationsDone: "from the students you registered",
};

/**
 * Who gives the figures: everybody who counsels, and the branch head, who
 * counsels alongside running the branch. Nobody else sees the boxes.
 */
export const FIGURES_ROLES = [...COUNSELLING_ROLES, "PARTNER"] as const;
export const givesFigures = (role: string) => (FIGURES_ROLES as readonly string[]).includes(role);

export const emptyFigures = (): DayEndFigures => ({ leadsReceived: null, callsMade: null, connectedCalls: null, followUpsDone: null, registrationsDone: null });

/**
 * What the boxes hold when the report opens: the portal's counts, with a count
 * of nothing as 0, not blank, because nothing logged is itself an answer. A
 * key the count left out opens at 0 for the same reason. Every box stays
 * editable, because calls happen outside the portal too, and a lead can
 * arrive by a phone call that was never entered as an enquiry.
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

/* ---------------- A month of figures ---------------- */

/** One counsellor's month: the five figures added up over the days they answered, and how many days they answered or missed. */
export type MonthPerson = { id: string; name: string; role: string; orgId: string; branch: string; answered: number; missed: number; figures: Record<FigureKey, number> };

/** The states a report is answered in. Only these carry figures; a missed day has none. */
export const ANSWERED_STATES = ["VERIFIED", "FLAGGED"] as const;

/**
 * The month's counsellors grouped by branch in the order they arrive, each
 * branch with its figures, days answered and days missed added up, and all
 * of them with one more. The sums per person come from the database already
 * added up over the month; this only stacks them.
 */
export function monthFiguresByBranch(people: MonthPerson[]) {
  const branches: { orgId: string; name: string; people: MonthPerson[]; totals: Record<FigureKey, number>; answered: number; missed: number }[] = [];
  for (const p of people) {
    let b = branches.find((x) => x.orgId === p.orgId);
    if (!b) {
      b = { orgId: p.orgId, name: p.branch, people: [], totals: sumFigures([]), answered: 0, missed: 0 };
      branches.push(b);
    }
    b.people.push(p);
    for (const k of FIGURE_KEYS) b.totals[k] += p.figures[k];
    b.answered += p.answered;
    b.missed += p.missed;
  }
  return {
    branches,
    totals: sumFigures(people.map((p) => p.figures)),
    answered: people.reduce((n, p) => n + p.answered, 0),
    missed: people.reduce((n, p) => n + p.missed, 0),
    people: people.length,
  };
}
