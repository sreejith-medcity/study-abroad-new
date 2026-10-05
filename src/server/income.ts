import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { DEPARTURE_KINDS, leakage, outstanding, rateFor, totals, type LineLike, type RateLike } from "@/lib/income";
import { intakeStart } from "@/db/documentation-sync";
import type { IncomeKind } from "@/db/schema";

const { incomeLines: il, rateCards: rc, students: st, organizations: og, applications: ap, programs: pg, universities: un, vendors: vn } = schema;

export type IncomeRow = typeof schema.incomeLines.$inferSelect & {
  vendorName: string | null;
  vendorCode: string | null;
  /** So a line reads the same colour here as on the invoice queue. */
  vendorColour: string | null;
  ackNo: string | null;
  course: string | null;
  /** The commission figure, read from the commission row rather than copied. */
  commissionGross: number | null;
  commissionPartner: number | null;
  commissionCurrency: string | null;
  commissionStatus: string | null;
  rateNote: string | null;
  /** The invoice this line went on, where it has been invoiced. */
  invoiceNumber: string | null;
  invoiceState: string | null;
};

/** One student's lines, newest first within each kind. */
export async function studentIncome(studentId: string): Promise<IncomeRow[]> {
  const rows = await db
    .select({
      line: il,
      vendorName: vn.name,
      vendorCode: vn.code,
      vendorColour: vn.colour,
      ackNo: ap.ackNo,
      course: pg.name,
      commissionGross: schema.commissions.grossAmount,
      commissionPartner: schema.commissions.partnerAmount,
      commissionCurrency: schema.commissions.currency,
      commissionStatus: schema.commissions.status,
      rateNote: rc.note,
      invoiceNumber: schema.vendorInvoices.number,
      invoiceState: schema.vendorInvoices.state,
    })
    .from(il)
    .leftJoin(vn, eq(vn.id, il.vendorId))
    .leftJoin(ap, eq(ap.id, il.applicationId))
    .leftJoin(pg, eq(pg.id, ap.programId))
    .leftJoin(schema.commissions, eq(schema.commissions.id, il.commissionId))
    .leftJoin(rc, eq(rc.id, il.rateCardId))
    .leftJoin(schema.vendorInvoices, eq(schema.vendorInvoices.id, il.invoiceId))
    .where(eq(il.studentId, studentId))
    .orderBy(asc(il.kind), desc(il.createdAt));
  return rows.map((r) => ({
    ...r.line,
    vendorName: r.vendorName,
    vendorColour: r.vendorColour,
    vendorCode: r.vendorCode,
    ackNo: r.ackNo,
    course: r.course,
    commissionGross: r.commissionGross,
    commissionPartner: r.commissionPartner,
    commissionCurrency: r.commissionCurrency,
    commissionStatus: r.commissionStatus,
    rateNote: r.rateNote,
    invoiceNumber: r.invoiceNumber,
    invoiceState: r.invoiceState,
  }));
}

/**
 * A line's figures, with commission read from the commission row. A commission
 * line holds no amount of its own, so the sheet and the commission screen can
 * never disagree about what a placement earned.
 */
export function readLine(row: IncomeRow): LineLike & { known: boolean; sourced: string | null } {
  if (row.kind === "COMMISSION" && row.commissionId) {
    return {
      kind: row.kind,
      currency: row.commissionCurrency ?? row.currency,
      expectedAmount: row.commissionGross,
      invoicedAmount: row.commissionStatus === "INVOICED" || row.commissionStatus === "RECEIVED" || row.commissionStatus === "PAID_TO_PARTNER" ? row.commissionGross : null,
      receivedAmount: row.commissionStatus === "RECEIVED" || row.commissionStatus === "PAID_TO_PARTNER" ? row.commissionGross : null,
      state: row.commissionStatus === "RECEIVED" || row.commissionStatus === "PAID_TO_PARTNER" ? "RECEIVED" : row.commissionStatus === "INVOICED" ? "INVOICED" : row.state,
      branchSharePercent: row.commissionPartner != null && row.commissionGross ? Math.round((row.commissionPartner / row.commissionGross) * 1000) / 10 : row.branchSharePercent,
      known: row.commissionGross != null,
      sourced: "Read from the commission on the placement",
    };
  }
  return {
    kind: row.kind,
    currency: row.currency,
    expectedAmount: row.expectedAmount,
    invoicedAmount: row.invoicedAmount,
    receivedAmount: row.receivedAmount,
    state: row.state,
    branchSharePercent: row.branchSharePercent,
    known: row.expectedAmount != null || row.invoicedAmount != null || row.receivedAmount != null,
    sourced: row.rateCardId ? "Worked out from the rate card" : null,
  };
}

/** One student's sheet: the lines, the totals and what is still to come in. */
export async function incomeSheet(studentId: string) {
  const rows = await studentIncome(studentId);
  const read = rows.map((r) => ({ row: r, ...readLine(r) }));
  return { rows: read, totals: totals(read), outstanding: outstanding(read) };
}

/** Every rate card, platform and branch, newest first. */
export const allRates = () =>
  db
    .select({ rate: rc, branch: og.name, setBy: schema.users.name })
    .from(rc)
    .leftJoin(og, eq(og.id, rc.orgId))
    .leftJoin(schema.users, eq(schema.users.id, rc.setById))
    .orderBy(asc(rc.kind), desc(rc.activeFrom));

/** The rates that apply to one branch today, by kind. */
export async function ratesForOrg(orgId: string, on = new Date()) {
  const rows = await db
    .select()
    .from(rc)
    .where(or(isNull(rc.orgId), eq(rc.orgId, orgId)));
  const usable = rows.map((r) => ({ ...r, activeFrom: r.activeFrom })) as unknown as RateLike[];
  const out = new Map<IncomeKind, RateLike | null>();
  for (const kind of schema.incomeKind.enumValues) out.set(kind, rateFor(usable, kind, orgId, on));
  return out;
}

export type DepartureRow = {
  studentId: string;
  name: string;
  branch: string;
  orgId: string;
  course: string;
  university: string;
  intakeMonth: number;
  intakeYear: number;
  startsOn: Date;
  booked: IncomeKind[];
  missing: IncomeKind[];
  visaDecided: boolean;
};

/**
 * Students who are actually going, soonest first, with what they have not
 * bought beside them.
 *
 * Only a granted visa, or a confirmation that the course is on, counts: a
 * shortlist is not a missed sale, and chasing a student who has no visa for a
 * forex card is how a branch loses their trust.
 */
export async function departureBoard(opts: { orgId?: string; withinDays?: number } = {}, today = new Date()): Promise<DepartureRow[]> {
  const rows = await db
    .select({
      studentId: st.id,
      firstName: st.firstName,
      lastName: st.lastName,
      branch: og.name,
      orgId: st.orgId,
      course: pg.name,
      university: un.name,
      intakeMonth: ap.intakeMonth,
      intakeYear: ap.intakeYear,
      visaDecision: ap.visaDecision,
      stage: st.journeyStage,
    })
    .from(ap)
    .innerJoin(st, eq(st.id, ap.studentId))
    .innerJoin(og, eq(og.id, st.orgId))
    .innerJoin(pg, eq(pg.id, ap.programId))
    .innerJoin(un, eq(un.id, pg.universityId))
    .where(and(eq(st.archived, false), opts.orgId ? eq(st.orgId, opts.orgId) : undefined, or(eq(ap.visaDecision, "GRANTED"), inArray(st.journeyStage, ["DEPARTURE", "ARRIVED"] as const))))
    .limit(500);

  const ids = [...new Set(rows.map((r) => r.studentId))];
  const booked = new Map<string, IncomeKind[]>();
  if (ids.length) {
    for (const line of await db.select({ studentId: il.studentId, kind: il.kind }).from(il).where(and(inArray(il.studentId, ids), inArray(il.kind, DEPARTURE_KINDS)))) {
      booked.set(line.studentId, [...(booked.get(line.studentId) ?? []), line.kind]);
    }
  }
  const within = opts.withinDays ?? 180;
  const seen = new Set<string>();
  return rows
    .map((r) => {
      const mine = booked.get(r.studentId) ?? [];
      return {
        studentId: r.studentId,
        name: `${r.firstName} ${r.lastName}`,
        branch: r.branch,
        orgId: r.orgId,
        course: r.course,
        university: r.university,
        intakeMonth: r.intakeMonth,
        intakeYear: r.intakeYear,
        startsOn: intakeStart(r.intakeMonth, r.intakeYear),
        booked: mine,
        missing: DEPARTURE_KINDS.filter((k) => !mine.includes(k)),
        visaDecided: r.visaDecision === "GRANTED",
      };
    })
    .filter((r) => {
      if (seen.has(r.studentId)) return false;
      seen.add(r.studentId);
      const days = (r.startsOn.getTime() - today.getTime()) / 86_400_000;
      return days <= within;
    })
    .sort((a, b) => a.startsOn.getTime() - b.startsOn.getTime());
}

/** What was left on the table, per branch and altogether. */
export async function leakageReport(opts: { orgId?: string } = {}, today = new Date()) {
  const board = await departureBoard({ orgId: opts.orgId, withinDays: 365 }, today);
  const overall = leakage(board.map((b) => ({ studentId: b.studentId, kinds: b.booked })));
  const byBranch = new Map<string, { branch: string; students: number; missed: number }>();
  for (const b of board) {
    const held = byBranch.get(b.orgId) ?? { branch: b.branch, students: 0, missed: 0 };
    held.students += 1;
    held.missed += b.missing.length;
    byBranch.set(b.orgId, held);
  }
  return { overall, byBranch: [...byBranch.values()].sort((a, b) => b.missed - a.missed), students: board.length };
}

/** What one branch has earned and is still owed, for the money screens. */
export async function branchIncome(orgId: string) {
  const rows = await db.select().from(il).where(eq(il.orgId, orgId));
  const lines = rows.map((r) => ({
    kind: r.kind,
    currency: r.currency,
    expectedAmount: r.expectedAmount,
    invoicedAmount: r.invoicedAmount,
    receivedAmount: r.receivedAmount,
    state: r.state,
    branchSharePercent: r.branchSharePercent,
  }));
  return { totals: totals(lines), outstanding: outstanding(lines), lines: rows.length };
}

/** Lines with no amount on them at all, which is what somebody has to go and fill in. */
export const unpricedLines = (orgId?: string) =>
  db
    .select({ id: il.id, kind: il.kind, studentId: il.studentId, firstName: st.firstName, lastName: st.lastName, branch: og.name })
    .from(il)
    .innerJoin(st, eq(st.id, il.studentId))
    .innerJoin(og, eq(og.id, il.orgId))
    .where(and(isNull(il.expectedAmount), isNull(il.invoicedAmount), isNull(il.receivedAmount), isNull(il.commissionId), orgId ? eq(il.orgId, orgId) : undefined))
    .orderBy(asc(st.firstName))
    .limit(200);

/** Every line across the portal, for the team's own list. */
export const allLines = (filters: { orgId?: string; kind?: string; state?: string } = {}) =>
  db
    .select({
      line: il,
      firstName: st.firstName,
      lastName: st.lastName,
      branch: og.name,
      vendorName: vn.name,
      commissionGross: schema.commissions.grossAmount,
      commissionCurrency: schema.commissions.currency,
      commissionStatus: schema.commissions.status,
    })
    .from(il)
    .innerJoin(st, eq(st.id, il.studentId))
    .innerJoin(og, eq(og.id, il.orgId))
    .leftJoin(vn, eq(vn.id, il.vendorId))
    .leftJoin(schema.commissions, eq(schema.commissions.id, il.commissionId))
    .where(
      and(
        filters.orgId ? eq(il.orgId, filters.orgId) : undefined,
        filters.kind ? eq(il.kind, filters.kind as IncomeKind) : undefined,
        filters.state ? eq(il.state, filters.state as "EXPECTED") : undefined,
      ),
    )
    .orderBy(desc(il.updatedAt))
    .limit(400);

/** Whether this student has a line of one kind already, so nothing is added twice. */
export async function kindsOnFile(studentId: string) {
  const rows = await db.select({ kind: il.kind }).from(il).where(eq(il.studentId, studentId));
  return new Set(rows.map((r) => r.kind));
}

/** Placements whose commission has no income line yet, for the one-click fill. */
export const commissionsWithoutLines = (orgId?: string) =>
  db
    .select({ commissionId: schema.commissions.id, applicationId: schema.commissions.applicationId, orgId: schema.commissions.orgId, studentId: ap.studentId })
    .from(schema.commissions)
    .innerJoin(ap, eq(ap.id, schema.commissions.applicationId))
    .where(and(orgId ? eq(schema.commissions.orgId, orgId) : undefined, sql`not exists (select 1 from ${il} l where l.commission_id = ${schema.commissions.id})`, isNotNull(ap.studentId)))
    .limit(500);
