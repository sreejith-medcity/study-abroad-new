import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { financialYear, fmtMoney } from "@/lib/format";
import { ageOf, invoiceableOn, invoiceNumber, invoiceTotals, numberSuffix, taxFor, type AgeBucket } from "@/lib/invoicing";
import { routeTerms } from "@/lib/vendors";
import type { InvoiceState } from "@/db/schema";

const { incomeLines: il, vendorInvoices: vi, vendorInvoiceLines: vil, vendors: vn, students: st, applications: ap, programs: pg, universities: un, organizations: og } = schema;

export type QueueLine = {
  incomeLineId: string;
  studentId: string;
  studentName: string;
  branch: string;
  orgId: string;
  applicationId: string | null;
  ackNo: string | null;
  course: string | null;
  university: string | null;
  vendorId: string;
  vendorName: string;
  vendorCode: string;
  vendorColour: string;
  vendorIsIndian: boolean;
  currency: string;
  amount: number | null;
  /** The milestone this vendor pays on, and the day it happened. */
  payableWhen: string;
  readyOn: string | null;
  daysToPay: number;
};

/**
 * What can be invoiced, and what cannot yet.
 *
 * A commission is invoiceable once the milestone the vendor's own terms name has
 * actually happened and has a date on it. Nothing is assumed from a status:
 * a vendor asked to pay on a visa will ask which day it was granted, and if
 * nobody recorded it the line waits rather than going out on a guess.
 */
export async function invoiceQueue(filters: { vendorId?: string; orgId?: string; ready?: boolean } = {}) {
  const rows = await db
    .select({
      line: il,
      studentFirst: st.firstName,
      studentLast: st.lastName,
      branch: og.name,
      ackNo: ap.ackNo,
      course: pg.name,
      university: un.name,
      offerAcceptBy: ap.offerAcceptBy,
      offerDate: ap.offerDate,
      depositPaidOn: ap.depositPaidOn,
      visaDecision: ap.visaDecision,
      visaDecisionOn: ap.visaDecisionOn,
      confirmationIssuedOn: ap.confirmationIssuedOn,
      statusGroup: schema.statusDefinitions.group,
      vendorId: vn.id,
      vendorName: vn.name,
      vendorCode: vn.code,
      vendorColour: vn.colour,
      vendorCurrency: vn.currency,
      vendorPayableOn: vn.payableOn,
      vendorDaysToPay: vn.daysToPay,
      vendorIsDirect: vn.isDirect,
      vendorBilling: vn.billingAddress,
      routePayableOn: schema.programRoutes.payableOn,
      routeDaysToPay: schema.programRoutes.daysToPay,
      commissionGross: schema.commissions.grossAmount,
      commissionCurrency: schema.commissions.currency,
    })
    .from(il)
    .innerJoin(st, eq(st.id, il.studentId))
    .innerJoin(og, eq(og.id, il.orgId))
    .leftJoin(ap, eq(ap.id, il.applicationId))
    .leftJoin(pg, eq(pg.id, ap.programId))
    .leftJoin(un, eq(un.id, pg.universityId))
    .leftJoin(schema.statusDefinitions, eq(schema.statusDefinitions.id, ap.statusId))
    .leftJoin(schema.programRoutes, eq(schema.programRoutes.id, ap.routeId))
    .innerJoin(vn, eq(vn.id, sql`coalesce(${il.vendorId}, ${schema.programRoutes.vendorId})`))
    .leftJoin(schema.commissions, eq(schema.commissions.id, il.commissionId))
    .where(
      and(
        isNull(il.invoiceId),
        inArray(il.payer, ["VENDOR", "UNIVERSITY", "PROVIDER"] as const),
        inArray(il.state, ["EXPECTED", "INVOICED"] as const),
        filters.vendorId ? eq(vn.id, filters.vendorId) : undefined,
        filters.orgId ? eq(il.orgId, filters.orgId) : undefined,
      ),
    )
    .orderBy(asc(vn.name), asc(st.firstName))
    .limit(500);

  const mapped: QueueLine[] = rows.map((r) => {
    const terms = routeTerms(
      {
        basis: "PERCENT_TUITION",
        percentOfTuition: null,
        flatAmount: null,
        currency: null,
        payableOn: r.routePayableOn,
        daysToPay: r.routeDaysToPay,
        applicationFee: null,
        offerTatDays: null,
        active: true,
      },
      { payableOn: r.vendorPayableOn, daysToPay: r.vendorDaysToPay },
    );
    const ready = invoiceableOn({
      payableOn: terms.payableOn,
      offerAcceptedOn: r.offerDate,
      feePaidOn: r.depositPaidOn,
      visaGrantedOn: r.visaDecision === "GRANTED" ? r.visaDecisionOn : null,
      enrolledOn: r.statusGroup === "SUCCESS" ? r.confirmationIssuedOn : null,
    });
    return {
      incomeLineId: r.line.id,
      studentId: r.line.studentId,
      studentName: `${r.studentFirst} ${r.studentLast}`,
      branch: r.branch,
      orgId: r.line.orgId,
      applicationId: r.line.applicationId,
      ackNo: r.ackNo,
      course: r.course,
      university: r.university,
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      vendorCode: r.vendorCode,
      vendorColour: r.vendorColour,
      // An Indian vendor's invoice carries tax; one abroad is an export.
      vendorIsIndian: r.vendorIsDirect || (r.vendorCurrency ?? "INR") === "INR",
      currency: r.line.kind === "COMMISSION" ? (r.commissionCurrency ?? r.line.currency) : r.line.currency,
      amount: r.line.kind === "COMMISSION" ? r.commissionGross : (r.line.expectedAmount ?? null),
      payableWhen: ready.waitingFor,
      readyOn: ready.on,
      daysToPay: terms.daysToPay,
    };
  });
  return filters.ready === undefined ? mapped : mapped.filter((m) => (filters.ready ? m.readyOn != null : m.readyOn == null));
}

/** The queue gathered per vendor, which is how an invoice is actually raised. */
export async function queueByVendor(filters: { orgId?: string } = {}) {
  const lines = await invoiceQueue(filters);
  const byVendor = new Map<string, { vendorId: string; name: string; code: string; colour: string; isIndian: boolean; ready: QueueLine[]; waiting: QueueLine[]; unpriced: QueueLine[] }>();
  for (const line of lines) {
    const held =
      byVendor.get(line.vendorId) ??
      { vendorId: line.vendorId, name: line.vendorName, code: line.vendorCode, colour: line.vendorColour, isIndian: line.vendorIsIndian, ready: [], waiting: [], unpriced: [] };
    if (line.amount == null) held.unpriced.push(line);
    else if (line.readyOn) held.ready.push(line);
    else held.waiting.push(line);
    byVendor.set(line.vendorId, held);
  }
  return [...byVendor.values()].sort((a, b) => b.ready.length - a.ready.length || a.name.localeCompare(b.name));
}

/** The next number in this financial year. The unique index is the final word. */
export async function nextInvoiceNumber(): Promise<string> {
  const year = financialYear();
  const rows = await db
    .select({ number: vi.number })
    .from(vi)
    .where(sql`${vi.number} like ${`MIO/${year}/%`}`)
    .orderBy(desc(vi.number));
  const highest = rows.map((r) => numberSuffix(r.number) ?? 0).reduce((a, b) => Math.max(a, b), 0);
  return invoiceNumber(year, highest + 1);
}

export type InvoiceFull = NonNullable<Awaited<ReturnType<typeof loadInvoice>>>;

/** One invoice with everything the screen and the document need. */
export async function loadInvoice(id: string) {
  const invoice = await db.query.vendorInvoices.findFirst({
    where: eq(vi.id, id),
    with: {
      vendor: true,
      billingCompany: true,
      createdBy: { columns: { name: true, deskLabel: true } },
      sentBy: { columns: { name: true, deskLabel: true } },
      payments: { with: { recordedBy: { columns: { name: true, deskLabel: true } } }, orderBy: desc(schema.invoicePayments.receivedOn) },
      lines: {
        with: {
          incomeLine: {
            with: {
              student: { columns: { id: true, firstName: true, lastName: true } },
              application: { columns: { ackNo: true, intakeMonth: true, intakeYear: true }, with: { program: { columns: { name: true }, with: { university: { columns: { name: true } } } } } },
            },
          },
        },
      },
    },
  });
  if (!invoice) return null;
  const tax = taxFor(
    invoice.billingCompany
      ? { gstin: invoice.billingCompany.gstin, lutNumber: invoice.billingCompany.lutNumber, lutValidUntil: invoice.billingCompany.lutValidUntil }
      : null,
    (invoice.vendor.currency ?? "INR") === "INR" || invoice.vendor.isDirect,
    invoice.raisedOn ? new Date(`${invoice.raisedOn}T00:00:00Z`) : new Date(),
  );
  const money = invoiceTotals(invoice.lines, invoice.payments, { percent: invoice.taxPercent ?? tax.percent });
  const age = ageOf(invoice.dueOn);
  return { ...invoice, tax, money, age };
}

export type InvoiceRow = {
  id: string;
  number: string;
  vendor: string;
  vendorCode: string;
  vendorColour: string;
  currency: string;
  total: number;
  received: number;
  outstanding: number;
  state: InvoiceState;
  raisedOn: string | null;
  dueOn: string | null;
  students: number;
  bucket: AgeBucket;
  lateDays: number | null;
};

/** Every invoice, for the list and the ageing report. */
export async function invoiceList(filters: { vendorId?: string; state?: string } = {}, today = new Date()): Promise<InvoiceRow[]> {
  const rows = await db
    .select({
      invoice: vi,
      vendor: vn.name,
      vendorCode: vn.code,
      vendorColour: vn.colour,
      students: sql<number>`(select count(*) from ${vil} l where l.invoice_id = ${vi.id})`.mapWith(Number),
    })
    .from(vi)
    .innerJoin(vn, eq(vn.id, vi.vendorId))
    .where(and(filters.vendorId ? eq(vi.vendorId, filters.vendorId) : undefined, filters.state ? eq(vi.state, filters.state as InvoiceState) : undefined))
    .orderBy(desc(vi.createdAt))
    .limit(300);
  return rows.map(({ invoice, ...r }) => {
    const age = ageOf(invoice.dueOn, today);
    return {
      id: invoice.id,
      number: invoice.number,
      vendor: r.vendor,
      vendorCode: r.vendorCode,
      vendorColour: r.vendorColour,
      currency: invoice.currency,
      total: invoice.total,
      received: invoice.receivedAmount,
      outstanding: Math.max(0, invoice.total - invoice.receivedAmount),
      state: invoice.state,
      raisedOn: invoice.raisedOn,
      dueOn: invoice.dueOn,
      students: r.students,
      bucket: age.bucket,
      lateDays: age.days,
    };
  });
}

/** What is owed, by how late it is, which is the only cut a finance meeting wants. */
export async function ageing(today = new Date()) {
  const rows = await invoiceList({}, today);
  const live = rows.filter((r) => r.state !== "PAID" && r.state !== "WRITTEN_OFF" && r.state !== "DRAFT");
  const buckets = new Map<AgeBucket, { count: number; amounts: Record<string, number> }>();
  for (const r of live) {
    const held = buckets.get(r.bucket) ?? { count: 0, amounts: {} };
    held.count += 1;
    held.amounts[r.currency] = (held.amounts[r.currency] ?? 0) + r.outstanding;
    buckets.set(r.bucket, held);
  }
  const byVendor = new Map<string, { vendor: string; code: string; colour: string; count: number; amounts: Record<string, number>; worst: AgeBucket }>();
  for (const r of live) {
    const held = byVendor.get(r.vendorCode) ?? { vendor: r.vendor, code: r.vendorCode, colour: r.vendorColour, count: 0, amounts: {}, worst: "NOT_DUE" as AgeBucket };
    held.count += 1;
    held.amounts[r.currency] = (held.amounts[r.currency] ?? 0) + r.outstanding;
    const order: AgeBucket[] = ["NOT_DUE", "DUE", "LATE_30", "LATE_60", "LATE_90"];
    if (order.indexOf(r.bucket) > order.indexOf(held.worst)) held.worst = r.bucket;
    byVendor.set(r.vendorCode, held);
  }
  return { buckets, byVendor: [...byVendor.values()].sort((a, b) => b.count - a.count), invoices: live };
}

/** A line on the invoice document, in the words a vendor can match to their own file. */
export function describeLine(line: {
  incomeLine: {
    kind: string;
    student: { firstName: string; lastName: string };
    application: { ackNo: string; intakeMonth: number; intakeYear: number; program: { name: string; university: { name: string } } } | null;
  };
}) {
  const s = line.incomeLine.student;
  const a = line.incomeLine.application;
  if (!a) return `${s.firstName} ${s.lastName}`;
  return `${s.firstName} ${s.lastName} · ${a.program.name}, ${a.program.university.name} · ${a.ackNo}`;
}

/** What one invoice is worth in words, for a notice or a toast. */
export const invoiceWorth = (invoice: { total: number; currency: string }) => fmtMoney(invoice.total, invoice.currency);
