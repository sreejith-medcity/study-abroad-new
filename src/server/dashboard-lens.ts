import "server-only";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff, orgScope } from "@/lib/permissions";
import { dashboardFor, isDashboardKind, mayViewAs, type DashboardKind } from "@/lib/dashboard-kinds";

/**
 * What the dashboard is looking at: a stretch of time, and for the desk,
 * optionally one branch.
 *
 * The period only moves the figures that are things happening: students
 * registering, applications being made, offers, visas and refusals coming
 * back. Those can be counted between two dates and set against the stretch
 * before. The rest are the state of things now, what is pending and what is
 * owed, and a state has no "this quarter", so those read the same whatever
 * the period says and are marked as being about now.
 */
export const PERIODS = [
  ["today", "Today"],
  ["month", "This month"],
  ["quarter", "Quarter"],
  ["year", "Year"],
  ["all", "All time"],
] as const;
export type Period = (typeof PERIODS)[number][0];

export type Lens = {
  user: SessionUser;
  /** Which dashboard is drawn: the person's own, or the one they asked to view as. */
  kind: DashboardKind;
  /** True when somebody is looking at another job's dashboard rather than their own. */
  viewingAs: boolean;
  /**
   * One person's own students, for a counsellor's dashboard: the students
   * assigned to them. Null reads every student the lens otherwise covers.
   */
  person: { id: string; name: string } | null;
  /** One branch, for the desk. Ignored for anybody who only sees their own. */
  org: string | null;
  orgName: string | null;
  period: Period;
  from: Date | null;
  to: Date;
  /** The stretch before, the same length, for the change shown on a tile. */
  prevFrom: Date | null;
  prevTo: Date | null;
  /** "vs last month", said the way the tile says it. */
  versus: string | null;
};

function bounds(period: Period, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "today": {
      const from = new Date(y, m, now.getDate());
      return { from, prevFrom: new Date(y, m, now.getDate() - 1), versus: "vs yesterday" };
    }
    case "month":
      return { from: new Date(y, m, 1), prevFrom: new Date(y, m - 1, 1), versus: "vs last month" };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: new Date(y, q, 1), prevFrom: new Date(y, q - 3, 1), versus: "vs last quarter" };
    }
    case "year":
      return { from: new Date(y, 0, 1), prevFrom: new Date(y - 1, 0, 1), versus: "vs last year" };
    default:
      return { from: null, prevFrom: null, versus: null };
  }
}

export async function readLens(user: SessionUser, sp: Record<string, string | string[] | undefined>): Promise<Lens> {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const asked = one("period");
  const period: Period = PERIODS.some(([k]) => k === asked) ? (asked as Period) : "all";
  const b = bounds(period);
  const now = new Date();

  const own = dashboardFor(user.role);
  const asked2 = one("as");
  const viewingAs = mayViewAs(user.role) && isDashboardKind(asked2) && asked2 !== own;
  const kind: DashboardKind = viewingAs ? (asked2 as DashboardKind) : own;

  // A counsellor reads their own students. Somebody viewing as a counsellor
  // picks whose, and until they do, reads every counsellor's together.
  let person: Lens["person"] = null;
  if (kind === "counsellor") {
    if (!viewingAs) person = { id: user.id, name: user.name };
    else {
      const who = one("who");
      const found = who ? await db.query.users.findFirst({ where: eq(schema.users.id, who), columns: { id: true, name: true } }) : null;
      if (found) person = found;
    }
  }

  let org: string | null = null;
  let orgName: string | null = null;
  const wanted = one("org");
  if (wanted && isStaff(user)) {
    const found = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, wanted), columns: { id: true, name: true } });
    if (found) {
      org = found.id;
      orgName = found.name;
    }
  }
  return {
    user,
    kind,
    viewingAs,
    person,
    org,
    orgName,
    period,
    from: b.from,
    to: now,
    prevFrom: b.prevFrom,
    // The stretch before ends where this one starts, so today is set against
    // yesterday up to the same hour only for "today"; a month against the
    // whole of last month. Close enough for the direction of a change, which
    // is all a tile says.
    prevTo: b.from,
    versus: b.versus,
  };
}

/** The organisation filter, for any table with an organisation column. */
export function lensOrg(lens: Lens, col: PgColumn): SQL | undefined {
  return and(orgScope(lens.user, col), lens.org ? eq(col, lens.org) : undefined);
}

/**
 * The students a dashboard counts: the organisation filter, and for a
 * counsellor, only the ones assigned to them.
 */
export function lensStudents(lens: Lens): SQL | undefined {
  return and(lensOrg(lens, schema.students.orgId), lens.person ? eq(schema.students.assignedToId, lens.person.id) : undefined);
}

/**
 * The applications a dashboard counts, by the same rule: an application is a
 * counsellor's when its student is.
 */
export function lensApps(lens: Lens): SQL | undefined {
  const a = schema.applications;
  const s = schema.students;
  return and(
    lensOrg(lens, a.orgId),
    // Not correlated, so it reads the same whatever the outer query joins.
    lens.person ? inArray(a.studentId, db.select({ id: s.id }).from(s).where(eq(s.assignedToId, lens.person.id))) : undefined,
  );
}
