import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff, orgScope } from "@/lib/permissions";

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
