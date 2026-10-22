import "server-only";
import { and, count, eq, gte, inArray, lt, min, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { isStaff } from "@/lib/permissions";
import { commissionVisible } from "./commission-visibility";
import { fxRates, getSettings } from "./settings";
import { fxToInr } from "@/lib/money";
import { lensOrg, type Lens } from "./dashboard-lens";

const { applications: a, statusDefinitions: sd, statusHistory: sh, students: s, organizations: og, checklistItems: ci, commissions: cm } = schema;

/** The statuses that mean a visa is in hand, or the student has gone further. */
const VISA_OR_LATER = ["VISA_RECEIVED", "ENROLLED", "JOINED", "DEPLOYED"] as const;

/**
 * The figures the dashboard opens with.
 *
 * Eleven numbers, asked for by name: how many students are registered, how
 * many applications they have made, how many offers and visas came back, how
 * many were refused, what documents are still outstanding, what has been
 * deferred, what has been paid for and what has not, what is sitting with a
 * branch or a sub-agent, and what the whole of it is worth.
 *
 * Every one of them is scoped the same way the rest of the portal is scoped,
 * so the Overseas desk sees all of it and a branch or a sub-agent opening the
 * same screen sees its own and nothing else. The desk can narrow to one
 * branch on top of that.
 *
 * Two kinds of figure, and the difference matters for the period picker:
 *
 * Things that happen (a registration, an application, an offer, a visa, a
 * refusal) are counted between two dates, set against the stretch before,
 * and drawn as a line over the last year. An offer, a visa and a refusal are
 * counted at the moment they first happened, from the status history, so a
 * student who has since enrolled still received an offer and a visa, each
 * once, in the month it came.
 *
 * Things that are (documents outstanding, files deferred, fees paid or due,
 * what is waiting on somebody, money owed) are the state of things now. They
 * read the same whatever the period says.
 */
export type Flow = { value: number; before: number | null; spark: number[] };
export type Tiles = Awaited<ReturnType<typeof dashboardTiles>>;

const monthKey = (col: SQL | PgColumn | SQL.Aliased) => sql<string>`to_char(date_trunc('month', ${col}), 'YYYY-MM')`;

/** The twelve month keys ending this month, oldest first. */
export function lastTwelve(now = new Date()) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

export async function dashboardTiles(lens: Lens) {
  const { user } = lens;
  const scope = lensOrg(lens, a.orgId);
  const studentScope = lensOrg(lens, s.orgId);
  const money = await commissionVisible(user);
  const months = lastTwelve();
  const yearAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1);


  // Registrations and applications have their own dates.
  const dated = async (table: typeof s | typeof a, at: PgColumn, where: SQL | undefined): Promise<Flow> => {
    const countIn = async (f: Date | null, t: Date | null) => {
      const [row] = await db
        .select({ n: count() })
        .from(table)
        .where(and(where, f ? gte(at, f) : undefined, t ? lt(at, t) : undefined));
      return Number(row?.n ?? 0);
    };
    const [value, before, perMonth] = await Promise.all([
      countIn(lens.from, null),
      lens.prevFrom ? countIn(lens.prevFrom, lens.prevTo) : Promise.resolve(null),
      db.select({ m: monthKey(at), n: count() }).from(table).where(and(where, gte(at, yearAgo))).groupBy(monthKey(at)),
    ]);
    const by = new Map(perMonth.map((r) => [r.m, Number(r.n)]));
    return { value, before, spark: months.map((m) => by.get(m) ?? 0) };
  };

  // Offers, visas and refusals happen once each, at the first time a file
  // reached that status.
  const firstTime = async (match: SQL): Promise<Flow> => {
    const first = db
      .select({ app: sh.applicationId, at: min(sh.createdAt).as("at") })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      .where(and(scope, match))
      .groupBy(sh.applicationId)
      .as("first");
    // A column made inside a subquery has lost the knowledge that it holds a
    // timestamp, so the bounds go in as written-out times rather than dates.
    const after = (d: Date) => sql`${first.at} >= ${d.toISOString()}::timestamptz`;
    const beforeTime = (d: Date) => sql`${first.at} < ${d.toISOString()}::timestamptz`;
    const countIn = async (f: Date | null, t: Date | null) => {
      const [row] = await db
        .select({ n: count() })
        .from(first)
        .where(and(f ? after(f) : undefined, t ? beforeTime(t) : undefined));
      return Number(row?.n ?? 0);
    };
    const [value, before, perMonth] = await Promise.all([
      countIn(lens.from, null),
      lens.prevFrom ? countIn(lens.prevFrom, lens.prevTo) : Promise.resolve(null),
      db.select({ m: monthKey(first.at), n: count() }).from(first).where(after(yearAgo)).groupBy(monthKey(first.at)),
    ]);
    const by = new Map(perMonth.map((r) => [r.m, Number(r.n)]));
    return { value, before, spark: months.map((m) => by.get(m) ?? 0) };
  };

  const nowIs = async (match: SQL) => {
    const [row] = await db
      .select({ n: count() })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(scope, match));
    return Number(row?.n ?? 0);
  };

  // What is waiting on the people outside this desk, and how long the oldest
  // of it has been waiting, split by our own branches and the sub-agents.
  const waitingOn = async (type: "BRANCH" | "SUB_AGENT") => {
    const [row] = await db
      .select({ n: count(), oldest: min(a.statusChangedAt) })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .innerJoin(og, eq(a.orgId, og.id))
      .where(and(scope, eq(sd.group, "PENDING_PARTNER"), eq(og.type, type)));
    const oldest = row?.oldest ? new Date(row.oldest) : null;
    return { n: Number(row?.n ?? 0), days: oldest ? Math.floor((Date.now() - oldest.getTime()) / 86400000) : null };
  };

  const [registrations, applications, offers, visaReceived, visaRejected, deferrals, feesPaid, feesDue, documents, fromBranches, fromSubAgents, revenue] =
    await Promise.all([
      dated(s, s.createdAt, and(studentScope, eq(s.archived, false))),
      dated(a, a.createdAt, scope),
      // A visa cannot be had without an offer, so a file that went straight
      // to a visa status still received one.
      firstTime(or(eq(sd.group, "OFFER"), inArray(sd.code, [...VISA_OR_LATER]))!),
      firstTime(inArray(sd.code, [...VISA_OR_LATER])),
      firstTime(eq(sd.code, "VISA_REJECTED")),
      nowIs(eq(sd.code, "DEFERRED")),
      nowIs(eq(a.feeStatus, "PAID")),
      nowIs(eq(a.feeStatus, "DUE")),
      // Asked for and not settled: still to come in, or in and not yet accepted.
      db
        .select({ items: count(), students: sql<number>`count(distinct ${ci.studentId})::int` })
        .from(ci)
        .innerJoin(s, eq(ci.studentId, s.id))
        .where(and(studentScope, eq(s.archived, false), inArray(ci.state, ["ASKED", "UPLOADED", "IN_REVIEW", "REJECTED"])))
        .then((r) => ({ items: Number(r[0]?.items ?? 0), students: Number(r[0]?.students ?? 0) })),
      waitingOn("BRANCH"),
      waitingOn("SUB_AGENT"),
      money ? revenueInr(lens) : Promise.resolve(null),
    ]);

  return { money, registrations, applications, offers, visaReceived, visaRejected, deferrals, feesPaid, feesDue, documents, fromBranches, fromSubAgents, revenue };
}

/**
 * What the work on the books is worth, in rupees.
 *
 * The desk reads the whole fee the institution pays, because that is Medcity's
 * revenue; a branch or a sub-agent reads its own share, because that is the
 * only part of it that is theirs.
 *
 * An institution pays in its own currency, so the gross cannot simply be added
 * up: a column of pounds and Australian dollars summed together is a number
 * that means nothing. It is converted a currency at a time, at the rates kept
 * in platform settings, which is the same conversion the commission itself was
 * written down with. The partner's share is already stored in rupees.
 */
async function revenueInr(lens: Lens) {
  const rates = fxRates(await getSettings());
  const rows = await db
    .select({
      status: cm.status,
      currency: cm.currency,
      gross: sql<number>`coalesce(sum(${cm.grossAmount}), 0)::int`,
      share: sql<number>`coalesce(sum(coalesce(${cm.partnerAmountInr}, ${cm.partnerAmount})), 0)::int`,
    })
    .from(cm)
    .where(lensOrg(lens, cm.orgId))
    .groupBy(cm.status, cm.currency);

  let expected = 0;
  let received = 0;
  for (const r of rows) {
    const amount = isStaff(lens.user) ? Math.round(Number(r.gross) * fxToInr(r.currency, rates)) : Number(r.share);
    if (r.status === "EXPECTED" || r.status === "INVOICED") expected += amount;
    if (r.status === "RECEIVED" || r.status === "SETTLED") received += amount;
  }
  return { expected, received };
}
