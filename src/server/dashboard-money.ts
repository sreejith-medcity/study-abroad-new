import "server-only";
import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fxToInr } from "@/lib/money";
import { fxRates, getSettings } from "./settings";
import { ageing, queueByVendor } from "./invoicing";
import { lastTwelve } from "./dashboard-tiles";
import type { Lens } from "./dashboard-lens";

const { commissions: cm, invoicePayments: ip, vendorInvoices: vi, vendors: vn, payoutRequests: po, creditNotes: cn } = schema;

/**
 * The finance desk's dashboard: what has been earned and not yet invoiced,
 * what is ready to invoice, what has gone out and not come back, how late it
 * is, and what has come in.
 *
 * Vendors pay in their own currency. Each amount is turned into rupees at the
 * rates kept in platform settings, a currency at a time, the way the revenue
 * figure on every other dashboard already is, so the headline can be one
 * number; the invoice screens keep every figure in the currency it was raised
 * in. Money that reached the bank with its own rupee figure recorded is read
 * at that figure rather than the rate.
 */
export async function moneyFigures(lens: Lens) {
  const rates = fxRates(await getSettings());
  const toInr = (amount: number, currency: string) => Math.round(amount * fxToInr(currency, rates));
  const inPeriod = (f: Date | null, t: Date | null) =>
    and(f ? gte(ip.receivedOn, f.toISOString().slice(0, 10)) : undefined, t ? lt(ip.receivedOn, t.toISOString().slice(0, 10)) : undefined);
  const paid = (f: Date | null, t: Date | null) =>
    db
      .select({ currency: ip.currency, amount: sql<number>`coalesce(sum(${ip.amount}), 0)::bigint`.mapWith(Number), rupees: sql<number>`coalesce(sum(${ip.rupeeAmount}), 0)::bigint`.mapWith(Number), noRupees: sql<number>`coalesce(sum(${ip.amount}) filter (where ${ip.rupeeAmount} is null), 0)::bigint`.mapWith(Number) })
      .from(ip)
      .where(inPeriod(f, t))
      .groupBy(ip.currency);
  const sumPaid = (rows: { currency: string; rupees: number; noRupees: number }[]) => rows.reduce((n, r) => n + r.rupees + toInr(r.noRupees, r.currency), 0);

  const yearAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1);
  const [earned, vendors, aged, now, before, perMonth, latest, payouts, disputed, drafts, credits] = await Promise.all([
    db
      .select({ status: cm.status, currency: cm.currency, gross: sql<number>`coalesce(sum(${cm.grossAmount}), 0)::bigint`.mapWith(Number) })
      .from(cm)
      .groupBy(cm.status, cm.currency),
    queueByVendor(),
    ageing(),
    paid(lens.from, null),
    lens.prevFrom ? paid(lens.prevFrom, lens.prevTo) : Promise.resolve(null),
    db
      .select({
        m: sql<string>`to_char(date_trunc('month', ${ip.receivedOn}), 'YYYY-MM')`,
        currency: ip.currency,
        amount: sql<number>`coalesce(sum(${ip.amount}) filter (where ${ip.rupeeAmount} is null), 0)::bigint`.mapWith(Number),
        rupees: sql<number>`coalesce(sum(${ip.rupeeAmount}), 0)::bigint`.mapWith(Number),
      })
      .from(ip)
      .where(gte(ip.receivedOn, yearAgo.toISOString().slice(0, 10)))
      .groupBy(sql`1`, ip.currency),
    db
      .select({ id: ip.id, amount: ip.amount, currency: ip.currency, rupees: ip.rupeeAmount, on: ip.receivedOn, invoiceId: vi.id, number: vi.number, vendor: vn.name })
      .from(ip)
      .innerJoin(vi, eq(ip.invoiceId, vi.id))
      .innerJoin(vn, eq(vi.vendorId, vn.id))
      .orderBy(desc(ip.receivedOn), desc(ip.createdAt))
      .limit(6),
    db
      .select({ n: count(), amount: sql<number>`coalesce(sum(${po.amountInr}), 0)::bigint`.mapWith(Number) })
      .from(po)
      .where(inArray(po.status, ["REQUESTED", "APPROVED"])),
    db.select({ n: count() }).from(vi).where(eq(vi.state, "DISPUTED")),
    db.select({ n: count() }).from(vi).where(eq(vi.state, "DRAFT")),
    db
      .select({ n: count() })
      .from(cn)
      .where(lens.from ? gte(cn.issuedOn, lens.from.toISOString().slice(0, 10)) : undefined),
  ]);

  // Earned and not yet invoiced is commission still expected; once an invoice
  // carries it, it is counted under what is outstanding instead.
  const expected = earned.filter((r) => r.status === "EXPECTED").reduce((n, r) => n + toInr(r.gross, r.currency), 0);
  const ready = vendors.flatMap((v) => v.ready);
  const readyInr = ready.reduce((n, l) => n + toInr(l.amount ?? 0, l.currency), 0);
  const waiting = vendors.reduce((n, v) => n + v.waiting.length, 0);
  const unpriced = vendors.reduce((n, v) => n + v.unpriced.length, 0);

  const outstanding = aged.invoices.reduce((n, r) => n + toInr(r.outstanding, r.currency), 0);
  const late = aged.invoices.filter((r) => r.bucket !== "NOT_DUE" && r.bucket !== "DUE" && r.outstanding > 0);
  const lateInr = late.reduce((n, r) => n + toInr(r.outstanding, r.currency), 0);
  const buckets = (["NOT_DUE", "DUE", "LATE_30", "LATE_60", "LATE_90"] as const).map((b) => {
    const rows = aged.invoices.filter((r) => r.bucket === b);
    return { bucket: b, count: rows.length, inr: rows.reduce((n, r) => n + toInr(r.outstanding, r.currency), 0) };
  });

  const months = lastTwelve();
  const byMonth = new Map<string, number>();
  for (const r of perMonth) byMonth.set(r.m, (byMonth.get(r.m) ?? 0) + r.rupees + toInr(r.amount, r.currency));

  return {
    expected,
    ready: { lines: ready.length, inr: readyInr, waiting, unpriced },
    outstanding: { invoices: aged.invoices.filter((r) => r.outstanding > 0).length, inr: outstanding },
    late: { invoices: late.length, inr: lateInr },
    received: { inr: sumPaid(now), before: before ? sumPaid(before) : null },
    buckets,
    months: months.map((m) => ({ key: m, value: byMonth.get(m) ?? 0 })),
    latest: latest.map((r) => ({ ...r, inr: r.rupees ?? toInr(r.amount, r.currency) })),
    payouts: { n: Number(payouts[0]?.n ?? 0), inr: Number(payouts[0]?.amount ?? 0) },
    disputed: Number(disputed[0]?.n ?? 0),
    drafts: Number(drafts[0]?.n ?? 0),
    credits: Number(credits[0]?.n ?? 0),
  };
}
