import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { OUTCOME_GROUP, SETTLES_IT, vendorSilence, vendorTurnaround } from "@/lib/desk";
import { fmtMoney } from "@/lib/format";
import { routeApplicationFee, routeCommission, routeOfferTat, termsAge, type RouteLike } from "@/lib/vendors";
import type { DeskStage, VendorOutcome } from "@/db/schema";

const { applications: ap, vendorUpdates: vu, students: st, organizations: og, programs: pg, universities: un, programRoutes: pr, vendors: vn } = schema;

/**
 * Reading the desk's own screens. Kept apart from the actions, so none of this
 * is reachable from a browser without going through a page that has already
 * checked who is asking.
 */

/** The statuses the desk is offered first for one outcome, and the rest after. */
export async function statusesForOutcome(pathway: "DEGREE" | "AUSBILDUNG" | "NURSING", outcome: VendorOutcome) {
  const group = OUTCOME_GROUP[outcome];
  const all = await db
    .select({ id: schema.statusDefinitions.id, label: schema.statusDefinitions.label, group: schema.statusDefinitions.group, requiresReason: schema.statusDefinitions.requiresReason })
    .from(schema.statusDefinitions)
    .where(and(eq(schema.statusDefinitions.pathway, pathway), eq(schema.statusDefinitions.active, true)))
    .orderBy(asc(schema.statusDefinitions.sortOrder));
  return { suggested: group ? all.filter((s) => s.group === group) : [], all };
}

/** Vendor updates on one application, newest first. */
export const updatesFor = (applicationId: string) =>
  db.query.vendorUpdates.findMany({
    where: eq(vu.applicationId, applicationId),
    with: { recordedBy: { columns: { name: true, deskLabel: true } }, toStatus: { columns: { label: true } } },
    orderBy: [desc(vu.happenedOn), desc(vu.createdAt)],
  });

export type DeskRow = {
  id: string;
  ackNo: string;
  studentId: string;
  studentName: string;
  branch: string;
  course: string;
  university: string;
  pathway: "DEGREE" | "AUSBILDUNG" | "NURSING";
  intakeMonth: number;
  intakeYear: number;
  deskStage: DeskStage;
  deskStageAssumed: boolean;
  handedOverAt: Date | null;
  handoverNote: string | null;
  returnReason: string | null;
  submittedToVendorAt: Date | null;
  vendorReference: string | null;
  vendorName: string | null;
  vendorCode: string | null;
  vendorColour: string | null;
  statusLabel: string;
  lastUpdateAt: Date | null;
  lastOutcome: VendorOutcome | null;
  settled: boolean;
  quiet: boolean;
  quietDays: number | null;
};

export type DeskFilters = { stage?: DeskStage; branch?: string; vendor?: string; pathway?: string; quiet?: string };

/**
 * The desk's own queue: every application the branch has handed over and the
 * desk has not finished with, oldest first, because the file that has waited
 * longest is the one a branch is asking about.
 */
export async function deskQueue(filters: DeskFilters = {}, today = new Date()): Promise<DeskRow[]> {
  const last = db
    .select({
      applicationId: vu.applicationId,
      lastAt: sql<Date>`max(${vu.createdAt})`.as("last_at"),
    })
    .from(vu)
    .groupBy(vu.applicationId)
    .as("last");

  const rows = await db
    .select({
      id: ap.id,
      ackNo: ap.ackNo,
      studentId: ap.studentId,
      firstName: st.firstName,
      lastName: st.lastName,
      branch: og.name,
      course: pg.name,
      university: un.name,
      pathway: pg.pathway,
      intakeMonth: ap.intakeMonth,
      intakeYear: ap.intakeYear,
      deskStage: ap.deskStage,
      deskStageAssumed: ap.deskStageAssumed,
      handedOverAt: ap.handedOverAt,
      handoverNote: ap.handoverNote,
      returnReason: ap.returnReason,
      submittedToVendorAt: ap.submittedToVendorAt,
      vendorReference: ap.vendorReference,
      vendorName: vn.name,
      vendorCode: vn.code,
      vendorColour: vn.colour,
      statusLabel: schema.statusDefinitions.label,
      statusGroup: schema.statusDefinitions.group,
      lastUpdateAt: last.lastAt,
    })
    .from(ap)
    .innerJoin(st, eq(st.id, ap.studentId))
    .innerJoin(og, eq(og.id, st.orgId))
    .innerJoin(pg, eq(pg.id, ap.programId))
    .innerJoin(un, eq(un.id, pg.universityId))
    .innerJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, ap.statusId))
    .leftJoin(pr, eq(pr.id, ap.routeId))
    .leftJoin(vn, eq(vn.id, pr.vendorId))
    .leftJoin(last, eq(last.applicationId, ap.id))
    .where(
      and(
        filters.stage ? eq(ap.deskStage, filters.stage) : inArray(ap.deskStage, ["READY", "CHOSEN", "SUBMITTED", "RETURNED"] as const),
        filters.branch ? eq(st.orgId, filters.branch) : undefined,
        filters.vendor ? eq(pr.vendorId, filters.vendor) : undefined,
        filters.pathway ? eq(pg.pathway, filters.pathway as "DEGREE") : undefined,
      ),
    )
    .orderBy(asc(ap.handedOverAt), asc(ap.createdAt))
    .limit(300);

  const latest = await db
    .select({ applicationId: vu.applicationId, outcome: vu.outcome, createdAt: vu.createdAt })
    .from(vu)
    .orderBy(desc(vu.createdAt));
  const lastOutcomeOf = new Map<string, VendorOutcome>();
  const settledSet = new Set<string>();
  for (const u of latest) {
    if (!lastOutcomeOf.has(u.applicationId)) lastOutcomeOf.set(u.applicationId, u.outcome);
    if (SETTLES_IT.includes(u.outcome)) settledSet.add(u.applicationId);
  }

  const mapped = rows.map((r) => {
    const settled = settledSet.has(r.id) || r.statusGroup === "CLOSED" || r.statusGroup === "SUCCESS";
    const silence = vendorSilence({ submittedAt: r.submittedToVendorAt, lastUpdateAt: r.lastUpdateAt ? new Date(r.lastUpdateAt) : null, settled }, today);
    return {
      id: r.id,
      ackNo: r.ackNo,
      studentId: r.studentId,
      studentName: `${r.firstName} ${r.lastName}`,
      branch: r.branch,
      course: r.course,
      university: r.university,
      pathway: r.pathway,
      intakeMonth: r.intakeMonth,
      intakeYear: r.intakeYear,
      deskStage: r.deskStage,
      deskStageAssumed: r.deskStageAssumed,
      handedOverAt: r.handedOverAt,
      handoverNote: r.handoverNote,
      returnReason: r.returnReason,
      submittedToVendorAt: r.submittedToVendorAt,
      vendorReference: r.vendorReference,
      vendorName: r.vendorName,
      vendorCode: r.vendorCode,
      vendorColour: r.vendorColour,
      statusLabel: r.statusLabel,
      lastUpdateAt: r.lastUpdateAt ? new Date(r.lastUpdateAt) : null,
      lastOutcome: lastOutcomeOf.get(r.id) ?? null,
      settled,
      quiet: silence.quiet,
      quietDays: silence.days,
    };
  });
  return filters.quiet === "1" ? mapped.filter((r) => r.quiet) : mapped;
}

/** How many are at each step, for the tabs across the top of the queue. */
export async function deskCounts() {
  const rows = await db
    .select({ stage: ap.deskStage, n: sql<number>`count(*)`.mapWith(Number) })
    .from(ap)
    .groupBy(ap.deskStage);
  const by = Object.fromEntries(rows.map((r) => [r.stage, r.n])) as Record<DeskStage, number | undefined>;
  return {
    READY: by.READY ?? 0,
    CHOSEN: by.CHOSEN ?? 0,
    SUBMITTED: by.SUBMITTED ?? 0,
    RETURNED: by.RETURNED ?? 0,
    PREPARING: by.PREPARING ?? 0,
  };
}

/**
 * What each vendor actually takes, from their own dates rather than their sheet.
 * Only applications lodged and settled count, so the figure is never a guess.
 */
export async function vendorTurnaroundReport() {
  const rows = await db
    .select({
      vendorId: vn.id,
      vendor: vn.name,
      code: vn.code,
      colour: vn.colour,
      submittedAt: ap.submittedToVendorAt,
      outcome: vu.outcome,
      happenedOn: vu.happenedOn,
      promised: pr.offerTatDays,
      programPromised: pg.offerTatDays,
    })
    .from(vu)
    .innerJoin(ap, eq(ap.id, vu.applicationId))
    .innerJoin(pg, eq(pg.id, ap.programId))
    .innerJoin(pr, eq(pr.id, ap.routeId))
    .innerJoin(vn, eq(vn.id, pr.vendorId))
    .where(and(isNotNull(ap.submittedToVendorAt), inArray(vu.outcome, ["OFFER_ISSUED", "REJECTED"] as const)));

  const byVendor = new Map<string, { vendor: string; code: string; colour: string; days: number[]; promised: number | null }>();
  for (const r of rows) {
    const took = vendorTurnaround(r.submittedAt, r.happenedOn);
    if (took == null) continue;
    const held = byVendor.get(r.vendorId) ?? { vendor: r.vendor, code: r.code, colour: r.colour, days: [], promised: r.promised ?? r.programPromised ?? null };
    held.days.push(took);
    byVendor.set(r.vendorId, held);
  }
  return [...byVendor.values()]
    .map((v) => {
      const sorted = [...v.days].sort((a, b) => a - b);
      const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
      return { vendor: v.vendor, code: v.code, colour: v.colour, count: sorted.length, median, slowest: sorted[sorted.length - 1], promised: v.promised };
    })
    .sort((a, b) => a.median - b.median);
}

/** The outcome groups, for the forms. */
export const outcomeGroup = (outcome: VendorOutcome) => OUTCOME_GROUP[outcome];

/**
 * The roads one course can go down, written out as the desk needs to read them:
 * what each pays, how fast each answers, what each charges and what each asks
 * for beyond the university's own list.
 */
export async function routeChoicesFor(programId: string) {
  const program = await db.query.programs.findFirst({
    where: eq(pg.id, programId),
    columns: { tuitionPerYear: true, tuitionTotal: true, applicationFee: true, offerTatDays: true },
    with: { university: { columns: { countryId: true }, with: { country: { columns: { currency: true } } } } },
  });
  if (!program) return [];
  const money = {
    tuitionPerYear: program.tuitionPerYear,
    tuitionTotal: program.tuitionTotal,
    applicationFee: program.applicationFee,
    offerTatDays: program.offerTatDays,
    currency: program.university.country.currency,
  };
  const rows = await db
    .select({ route: pr, vendor: vn })
    .from(pr)
    .innerJoin(vn, eq(vn.id, pr.vendorId))
    .where(and(eq(pr.programId, programId), eq(pr.active, true), eq(vn.active, true)))
    .orderBy(asc(vn.name));
  return rows.map(({ route, vendor }) => {
    const commission = routeCommission(route as RouteLike, money);
    const tat = routeOfferTat(route as RouteLike, money);
    const fee = routeApplicationFee(route as RouteLike, money);
    return {
      id: route.id,
      code: vendor.code,
      name: vendor.name,
      colour: vendor.colour,
      commission: commission.known ? fmtMoney(commission.amount, commission.currency) : null,
      offerIn: tat == null ? "not recorded" : `${tat} day${tat === 1 ? "" : "s"}`,
      applicationFee: fee == null ? "not recorded" : fee === 0 ? "none" : fmtMoney(fee, money.currency),
      asksFor: route.extraDocuments,
      interview: route.interviewRequired,
      stale: termsAge(route.confirmedAt ?? vendor.termsConfirmedAt).stale,
    };
  });
}
