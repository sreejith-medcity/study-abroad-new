import "server-only";
import { and, count, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff, orgScope } from "@/lib/permissions";
import { commissionVisible } from "./commission-visibility";
import { fxRates, getSettings } from "./settings";
import { fxToInr } from "@/lib/money";

const { applications: a, statusDefinitions: sd, statusHistory: sh, students: s, organizations: og, checklistItems: ci, commissions: cm } = schema;

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
 * same screen sees its own and nothing else. There is one definition of each
 * figure, here, rather than one per dashboard.
 *
 * "Received" means it happened, not that it is the state the file is in now:
 * a student whose visa is in hand and who has since enrolled still received
 * an offer and received a visa, so those three read from what the file has
 * been through rather than from where it has got to. Deferrals, fees and
 * whatever is waiting on somebody are the opposite: they are about now, so
 * they read from the current state.
 */
export type Tiles = Awaited<ReturnType<typeof dashboardTiles>>;

export async function dashboardTiles(user: SessionUser) {
  const scope = orgScope(user, a.orgId);
  const studentScope = orgScope(user, s.orgId);
  const money = await commissionVisible(user);

  // Did this application ever get this far? Counted from the status history,
  // so a file that has moved on still counts where it has been.
  const everReached = async (match: SQL) => {
    const [row] = await db
      .select({ n: sql<number>`count(distinct ${sh.applicationId})::int` })
      .from(sh)
      .innerJoin(a, eq(sh.applicationId, a.id))
      .innerJoin(sd, eq(sh.toStatusId, sd.id))
      .where(and(scope, match));
    return Number(row?.n ?? 0);
  };

  const nowIs = async (match: SQL) => {
    const [row] = await db
      .select({ n: count() })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .where(and(scope, match));
    return Number(row?.n ?? 0);
  };

  // What is waiting on the people outside this desk, split by which kind of
  // outside: our own branches, and the sub-agents who work through them.
  const waitingOn = async (type: "BRANCH" | "SUB_AGENT") => {
    const [row] = await db
      .select({ n: count() })
      .from(a)
      .innerJoin(sd, eq(a.statusId, sd.id))
      .innerJoin(og, eq(a.orgId, og.id))
      .where(and(scope, eq(sd.group, "PENDING_PARTNER"), eq(og.type, type)));
    return Number(row?.n ?? 0);
  };

  const [
    registrations,
    applications,
    offers,
    visaReceived,
    visaRejected,
    deferrals,
    feesPaid,
    feesDue,
    documents,
    fromBranches,
    fromSubAgents,
    revenue,
  ] = await Promise.all([
    db.select({ n: count() }).from(s).where(and(studentScope, eq(s.archived, false))).then((r) => Number(r[0]?.n ?? 0)),
    db.select({ n: count() }).from(a).where(scope).then((r) => Number(r[0]?.n ?? 0)),
    everReached(eq(sd.group, "OFFER")),
    everReached(inArray(sd.code, ["VISA_RECEIVED", "ENROLLED", "JOINED", "DEPLOYED"])),
    everReached(eq(sd.code, "VISA_REJECTED")),
    nowIs(eq(sd.code, "DEFERRED")),
    nowIs(eq(a.feeStatus, "PAID")),
    nowIs(eq(a.feeStatus, "DUE")),
    // Asked for and not settled: still to come in, or in and not yet accepted.
    db
      .select({
        items: count(),
        students: sql<number>`count(distinct ${ci.studentId})::int`,
      })
      .from(ci)
      .innerJoin(s, eq(ci.studentId, s.id))
      .where(and(studentScope, eq(s.archived, false), inArray(ci.state, ["ASKED", "UPLOADED", "IN_REVIEW", "REJECTED"])))
      .then((r) => ({ items: Number(r[0]?.items ?? 0), students: Number(r[0]?.students ?? 0) })),
    waitingOn("BRANCH"),
    waitingOn("SUB_AGENT"),
    money ? revenueInr(user) : Promise.resolve(null),
  ]);

  return {
    money,
    registrations,
    applications,
    offers,
    visaReceived,
    visaRejected,
    deferrals,
    feesPaid,
    feesDue,
    documents,
    fromBranches,
    fromSubAgents,
    revenue,
  };
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
async function revenueInr(user: SessionUser) {
  const rates = fxRates(await getSettings());
  const rows = await db
    .select({
      status: cm.status,
      currency: cm.currency,
      gross: sql<number>`coalesce(sum(${cm.grossAmount}), 0)::int`,
      share: sql<number>`coalesce(sum(coalesce(${cm.partnerAmountInr}, ${cm.partnerAmount})), 0)::int`,
    })
    .from(cm)
    .where(orgScope(user, cm.orgId))
    .groupBy(cm.status, cm.currency);

  let expected = 0;
  let received = 0;
  for (const r of rows) {
    const amount = isStaff(user) ? Math.round(Number(r.gross) * fxToInr(r.currency, rates)) : Number(r.share);
    if (r.status === "EXPECTED" || r.status === "INVOICED") expected += amount;
    if (r.status === "RECEIVED" || r.status === "SETTLED") received += amount;
  }
  return { expected, received };
}
