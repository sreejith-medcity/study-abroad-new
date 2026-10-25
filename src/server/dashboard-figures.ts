import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { FIGURES_ROLES, istDay, journalIssued, type DayEndFigures } from "@/lib/journal";
import { addMonths, mergeToday, sumMonth, sumToday, type MonthFigures, type TodayFigures } from "@/lib/day-figures";
import { countedFigures } from "./journal";
import type { Lens } from "./dashboard-lens";

const { users: us, organizations: og, dailyJournals: dj } = schema;

/*
 * The day's figures for a dashboard: the five a counsellor gives at the end of
 * the day (leads, calls, connected calls, follow-ups, registrations), for
 * today and for the month so far.
 *
 * Today is read from the answered report where there is one, and otherwise
 * from the portal's own counts, exactly as the report's boxes would open, so
 * the dashboard and the report never disagree. The month adds up answered
 * reports only. Neither moves with the dashboard's period: today is today and
 * the month is this one, in India time.
 */

export type FigurePerson = { id: string; name: string; role: string; orgId: string; branch: string; today: TodayFigures; month: MonthFigures };
export type FigureBranch = { orgId: string; name: string; people: number; today: ReturnType<typeof sumToday>; month: MonthFigures };

export type DayFigures = { day: string; month: string } & (
  | { kind: "person"; person: FigurePerson }
  | { kind: "branch"; todayTotal: ReturnType<typeof sumToday>; monthTotal: MonthFigures; people: FigurePerson[] }
  | { kind: "branches"; branches: FigureBranch[] }
);

/** Everybody who gives figures, at the head office and the branches, optionally one organisation's. */
async function figurePeople(orgId: string | null, userId: string | null) {
  return db
    .select({ id: us.id, name: us.name, role: us.role, orgId: og.id, branch: og.name, orgType: og.type })
    .from(us)
    .innerJoin(og, eq(us.orgId, og.id))
    .where(
      and(
        eq(us.active, true),
        inArray(og.type, ["HQ", "BRANCH"]),
        inArray(us.role, [...FIGURES_ROLES]),
        orgId ? eq(og.id, orgId) : undefined,
        userId ? eq(us.id, userId) : undefined,
      ),
    )
    .orderBy(asc(og.type), asc(og.name), asc(us.name));
}

/**
 * Today and the month so far for each of these people. One query for today's
 * reports, one for the month's, and the portal's counts for whoever has not
 * answered today, all together.
 */
async function figuresFor(ids: string[], day: string, month: string): Promise<Map<string, { today: TodayFigures; month: MonthFigures }>> {
  const out = new Map<string, { today: TodayFigures; month: MonthFigures }>();
  if (ids.length === 0) return out;
  // A report's figures are only ever there once it was answered, so "has
  // figures" is the test, and an older answer from before the figures were
  // asked for reads like no answer: the portal's counts stand in for it.
  const monthRows = await db
    .select({ who: dj.userId, day: dj.day, figures: dj.figures })
    .from(dj)
    .where(and(inArray(dj.userId, ids), gte(dj.day, `${month}-01`), lte(dj.day, day), isNotNull(dj.figures)));
  const answeredToday = new Map<string, DayEndFigures>();
  const byPerson = new Map<string, DayEndFigures[]>(ids.map((id) => [id, []]));
  for (const r of monthRows) {
    if (!r.figures) continue;
    byPerson.get(r.who)?.push(r.figures);
    if (r.day === day) answeredToday.set(r.who, r.figures);
  }
  const live = await countedFigures(day, ids.filter((id) => !answeredToday.has(id)));
  for (const id of ids) {
    out.set(id, { today: mergeToday(answeredToday.get(id), live.get(id)), month: sumMonth(byPerson.get(id) ?? []) });
  }
  return out;
}

/**
 * The day's figures the dashboard shows, by what it is looking at. A
 * counsellor: their own. A branch head, a senior counsellor, or the desk
 * viewing as a branch: the branch's people added up, each listed. Somebody
 * viewing as a counsellor without picking one reads the same list across the
 * lens. Leadership: each branch added up. Null where the lens has nobody who
 * gives figures, such as a sub-agent's counsellor, who is not issued a report.
 */
export async function dayFigures(lens: Lens, now: Date = new Date()): Promise<DayFigures | null> {
  const day = istDay(now);
  const month = day.slice(0, 7);

  if (lens.kind === "counsellor" && lens.person) {
    const [p] = await figurePeople(null, lens.person.id);
    if (!p || !journalIssued(p.role, p.orgType)) return null;
    const got = (await figuresFor([p.id], day, month)).get(p.id)!;
    return { kind: "person", day, month, person: { id: p.id, name: p.name, role: p.role, orgId: p.orgId, branch: p.branch, ...got } };
  }

  if (lens.kind === "branch" || lens.kind === "counsellor") {
    // A branch head and a senior counsellor read their own branch; the desk
    // viewing as one reads the branch it picked, or all of them until it does.
    const orgId = lens.viewingAs ? lens.org : lens.user.orgId;
    const rows = await figurePeople(orgId, null);
    if (rows.length === 0) return null;
    const got = await figuresFor(rows.map((r) => r.id), day, month);
    const people: FigurePerson[] = rows.map((r) => ({ id: r.id, name: r.name, role: r.role, orgId: r.orgId, branch: r.branch, ...got.get(r.id)! }));
    return { kind: "branch", day, month, todayTotal: sumToday(people.map((p) => p.today)), monthTotal: addMonths(people.map((p) => p.month)), people };
  }

  if (lens.kind === "leadership") {
    const rows = await figurePeople(lens.org, null);
    if (rows.length === 0) return null;
    const got = await figuresFor(rows.map((r) => r.id), day, month);
    const branches: FigureBranch[] = [];
    for (const r of rows) {
      let b = branches.find((x) => x.orgId === r.orgId);
      if (!b) {
        b = { orgId: r.orgId, name: r.branch, people: 0, today: sumToday([]), month: addMonths([]) };
        branches.push(b);
      }
      b.people += 1;
    }
    for (const b of branches) {
      const theirs = rows.filter((r) => r.orgId === b.orgId).map((r) => got.get(r.id)!);
      b.today = sumToday(theirs.map((t) => t.today));
      b.month = addMonths(theirs.map((t) => t.month));
    }
    return { kind: "branches", day, month, branches };
  }

  return null;
}
