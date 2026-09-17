import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { orgScope } from "@/lib/permissions";
import type { CommissionStatus } from "@/db/schema";

const {
  commissions: cm,
  commissionRules: cr,
  applications: a,
  students: st,
  programs: pr,
  universities: un,
  countries: co,
  statusDefinitions: sd,
  organizations: og,
  walletEntries: we,
  payoutRequests: pq,
} = schema;

export const STATUS_LABEL: Record<CommissionStatus, string> = {
  EXPECTED: "Expected",
  INVOICED: "Invoiced",
  RECEIVED: "Received",
  SETTLED: "Paid to partner",
  WRITTEN_OFF: "Written off",
};

export const STATUS_TONE: Record<CommissionStatus, "neutral" | "info" | "warn" | "ok" | "bad"> = {
  EXPECTED: "neutral",
  INVOICED: "info",
  RECEIVED: "warn",
  SETTLED: "ok",
  WRITTEN_OFF: "bad",
};

/** Statuses that earn the milestone: the placement actually happened. */
export const EARNING_CODES = ["VISA_RECEIVED", "ENROLLED", "JOINED", "DEPLOYED"];

/**
 * Indicative rates so every commission carries a rupee figure from the start.
 * The real amount is entered when the partner's share is settled, which
 * overwrites this estimate. Override through COMMISSION_FX, for example
 * COMMISSION_FX="GBP:115,EUR:98".
 */
const DEFAULT_FX: Record<string, number> = { INR: 1, GBP: 112, EUR: 96, AUD: 58, CAD: 62, USD: 88 };

export function fxToInr(currency: string) {
  const overrides = (process.env.COMMISSION_FX ?? "")
    .split(",")
    .map((pair) => pair.split(":"))
    .filter((parts) => parts.length === 2);
  for (const [code, rate] of overrides) {
    const value = Number(rate);
    if (code && !Number.isNaN(value) && value > 0) DEFAULT_FX[code.trim().toUpperCase()] = value;
  }
  return DEFAULT_FX[currency.toUpperCase()] ?? 1;
}

/**
 * The rule that applies to one application: the most specific live rule wins,
 * program first, then university, then country, and a rule pinned to the
 * intake year beats one that is not.
 */
export async function findRule(programId: string, universityId: string, countryId: string, intakeYear: number) {
  const rules = await db
    .select()
    .from(cr)
    .where(
      and(
        eq(cr.active, true),
        or(eq(cr.programId, programId), eq(cr.universityId, universityId), eq(cr.countryId, countryId)),
        or(isNull(cr.intakeYear), eq(cr.intakeYear, intakeYear)),
      ),
    );
  if (rules.length === 0) return null;
  const score = (r: typeof rules[number]) =>
    (r.programId === programId ? 100 : r.universityId === universityId ? 50 : r.countryId === countryId ? 20 : 0) +
    (r.intakeYear === intakeYear ? 5 : 0);
  return rules.sort((x, y) => score(y) - score(x))[0];
}

export function amountsFor(rule: { basis: string; percentOfTuition: number | null; flatAmount: number | null; partnerSharePercent: number }, tuition: number | null) {
  const gross =
    rule.basis === "FLAT"
      ? Math.round(rule.flatAmount ?? 0)
      : Math.round(((tuition ?? 0) * (rule.percentOfTuition ?? 0)) / 100);
  const partner = Math.round((gross * rule.partnerSharePercent) / 100);
  return { gross, partner };
}

/**
 * Creates the commission row for an application that just reached a paying
 * milestone. Safe to call again: one commission per application.
 */
export async function accrueCommission(applicationId: string) {
  const existing = await db.query.commissions.findFirst({ where: eq(cm.applicationId, applicationId) });
  if (existing) return existing;

  const [row] = await db
    .select({
      id: a.id,
      orgId: a.orgId,
      intakeYear: a.intakeYear,
      programId: pr.id,
      universityId: un.id,
      countryId: co.id,
      tuition: pr.tuitionPerYear,
      currency: co.currency,
      code: sd.code,
    })
    .from(a)
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .innerJoin(sd, eq(a.statusId, sd.id))
    .where(eq(a.id, applicationId));
  if (!row || !EARNING_CODES.includes(row.code)) return null;

  const rule = await findRule(row.programId, row.universityId, row.countryId, row.intakeYear);
  if (!rule) return null;
  const { gross, partner } = amountsFor(rule, row.tuition);
  if (gross <= 0) return null;
  const currency = rule.basis === "FLAT" ? rule.currency : row.currency;

  const [created] = await db
    .insert(cm)
    .values({
      applicationId: row.id,
      orgId: row.orgId,
      ruleId: rule.id,
      currency,
      grossAmount: gross,
      partnerAmount: partner,
      // An estimate until the real transfer amount is entered at settlement.
      partnerAmountInr: Math.round(partner * fxToInr(currency)),
      status: "EXPECTED",
    })
    .returning();
  return created;
}

/** Backfill for applications that passed the milestone before a rule existed. */
export async function accrueMissing() {
  const rows = await db
    .select({ id: a.id })
    .from(a)
    .innerJoin(sd, eq(a.statusId, sd.id))
    .leftJoin(cm, eq(cm.applicationId, a.id))
    .where(and(inArray(sd.code, EARNING_CODES), isNull(cm.id)));
  let created = 0;
  for (const r of rows) {
    const made = await accrueCommission(r.id);
    if (made) created++;
  }
  return { scanned: rows.length, created };
}

export type CommissionFilters = { status?: string; org?: string; year?: string; country?: string; q?: string };

export function readCommissionFilters(sp: Record<string, string | string[] | undefined>): CommissionFilters {
  const out: Record<string, string> = {};
  for (const k of ["status", "org", "year", "country", "q"]) {
    const v = sp[k];
    const val = Array.isArray(v) ? v[0] : v;
    if (val) out[k] = val;
  }
  return out as CommissionFilters;
}

export function commissionWhere(user: SessionUser, f: CommissionFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [orgScope(user, cm.orgId)];
  if (f.status) conds.push(eq(cm.status, f.status as CommissionStatus));
  if (f.org) conds.push(eq(cm.orgId, f.org));
  if (f.year) conds.push(eq(a.intakeYear, Number(f.year)));
  if (f.country) conds.push(eq(co.code, f.country));
  if (f.q) conds.push(sql`(${st.firstName} || ' ' || ${st.lastName}) ilike ${`%${f.q}%`} or ${a.ackNo} ilike ${`%${f.q}%`}`);
  return and(...conds.filter(Boolean));
}

export function commissionBase() {
  return db
    .select({
      id: cm.id,
      status: cm.status,
      currency: cm.currency,
      grossAmount: cm.grossAmount,
      partnerAmount: cm.partnerAmount,
      partnerAmountInr: cm.partnerAmountInr,
      invoiceRef: cm.invoiceRef,
      invoicedAt: cm.invoicedAt,
      receivedAt: cm.receivedAt,
      settledAt: cm.settledAt,
      createdAt: cm.createdAt,
      applicationId: cm.applicationId,
      ackNo: a.ackNo,
      intakeMonth: a.intakeMonth,
      intakeYear: a.intakeYear,
      studentId: st.id,
      firstName: st.firstName,
      lastName: st.lastName,
      programName: pr.name,
      universityName: un.name,
      countryName: co.name,
      orgId: cm.orgId,
      orgName: og.name,
      ruleName: cr.name,
    })
    .from(cm)
    .innerJoin(a, eq(cm.applicationId, a.id))
    .innerJoin(st, eq(a.studentId, st.id))
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .innerJoin(og, eq(cm.orgId, og.id))
    .leftJoin(cr, eq(cm.ruleId, cr.id))
    .$dynamic();
}

/** Totals per status, in rupees for the partner share. */
export async function commissionTotals(user: SessionUser, f: CommissionFilters = {}) {
  const rows = await db
    .select({
      status: cm.status,
      n: sql<number>`count(*)::int`,
      partner: sql<number>`coalesce(sum(coalesce(${cm.partnerAmountInr}, ${cm.partnerAmount})), 0)::int`,
    })
    .from(cm)
    .innerJoin(a, eq(cm.applicationId, a.id))
    .innerJoin(st, eq(a.studentId, st.id))
    .innerJoin(pr, eq(a.programId, pr.id))
    .innerJoin(un, eq(pr.universityId, un.id))
    .innerJoin(co, eq(un.countryId, co.id))
    .where(commissionWhere(user, f))
    .groupBy(cm.status);
  const out: Record<string, { n: number; partner: number }> = {};
  for (const s of schema.commissionStatus.enumValues) out[s] = { n: 0, partner: 0 };
  for (const r of rows) out[r.status] = { n: Number(r.n), partner: Number(r.partner) };
  return out;
}

/** Wallet balance in rupees: credits minus payouts. */
export async function walletBalance(orgId: string) {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${we.amountInr}), 0)::int`,
      credited: sql<number>`coalesce(sum(${we.amountInr}) filter (where ${we.amountInr} > 0), 0)::int`,
      paidOut: sql<number>`coalesce(-sum(${we.amountInr}) filter (where ${we.amountInr} < 0), 0)::int`,
    })
    .from(we)
    .where(eq(we.orgId, orgId));
  return { balance: Number(row?.balance ?? 0), credited: Number(row?.credited ?? 0), paidOut: Number(row?.paidOut ?? 0) };
}

export async function walletLedger(orgId: string, limit = 50) {
  return db
    .select({
      id: we.id,
      kind: we.kind,
      amountInr: we.amountInr,
      reference: we.reference,
      note: we.note,
      createdAt: we.createdAt,
      commissionId: we.commissionId,
    })
    .from(we)
    .where(eq(we.orgId, orgId))
    .orderBy(desc(we.createdAt))
    .limit(limit);
}

export async function payoutList(orgId?: string, limit = 25) {
  return db
    .select({
      id: pq.id,
      orgId: pq.orgId,
      orgName: og.name,
      amountInr: pq.amountInr,
      status: pq.status,
      reference: pq.reference,
      note: pq.note,
      createdAt: pq.createdAt,
      decidedAt: pq.decidedAt,
    })
    .from(pq)
    .innerJoin(og, eq(pq.orgId, og.id))
    .where(orgId ? eq(pq.orgId, orgId) : undefined)
    .orderBy(desc(pq.createdAt))
    .limit(limit);
}

export async function rulesWithScope() {
  return db
    .select({
      id: cr.id,
      name: cr.name,
      basis: cr.basis,
      percentOfTuition: cr.percentOfTuition,
      flatAmount: cr.flatAmount,
      currency: cr.currency,
      partnerSharePercent: cr.partnerSharePercent,
      intakeYear: cr.intakeYear,
      active: cr.active,
      notes: cr.notes,
      countryName: co.name,
      universityName: un.name,
      programName: pr.name,
      used: sql<number>`(select count(*) from commissions c where c.rule_id = commission_rules.id)::int`,
    })
    .from(cr)
    .leftJoin(co, eq(cr.countryId, co.id))
    .leftJoin(un, eq(cr.universityId, un.id))
    .leftJoin(pr, eq(cr.programId, pr.id))
    .orderBy(desc(cr.active), asc(cr.name));
}

/** Rupees, no decimals: every amount in this module is a whole unit. */
export function inr(amount: number | null | undefined) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount ?? 0);
}

export function money(amount: number | null | undefined, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount ?? 0);
}
