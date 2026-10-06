"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, isSuperAdmin } from "@/lib/permissions";
import { creditAllowed, dueOn as dueDateFrom, invoiceTotals, stateAfterSettlement, taxFor } from "@/lib/invoicing";
import { fmtMoney } from "@/lib/format";
import { invoiceQueue, loadInvoice, nextCreditNoteNumber, nextInvoiceNumber } from "@/server/invoicing";
import { getSettings } from "@/server/settings";
import { notifyUsers, partnerRecipients } from "@/server/notify";
import type { FormState } from "@/lib/form-state";
import { settleReferralsForCommissions } from "@/server/referral-earnings";
import { sendMoneyEvent } from "@/server/crm-out";

const { incomeLines: il, vendorInvoices: vi, vendorInvoiceLines: vil, invoicePayments: ip } = schema;

const dateOnly = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const whole = (v: unknown) => {
  const t = String(v ?? "").trim().replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

const raiseSchema = z.object({
  vendorId: z.string().min(1),
  billingCompanyId: z.string().min(1, "Choose the company that raises it"),
  raisedOn: z.string().optional(),
  note: z.string().trim().max(400).optional(),
});

/**
 * Raises one invoice over everything ticked.
 *
 * The total is the sum of the lines, never a typed figure. The number comes from
 * this financial year's running count and the unique index on it is the final
 * word, so two people raising at once cannot land on the same number.
 */
export async function raiseInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = raiseSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const chosen = fd.getAll("incomeLineIds").map(String).filter(Boolean);
  if (!chosen.length) return { error: "Tick the students this invoice covers." };

  const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, d.vendorId) });
  if (!vendor) return { error: "That vendor no longer exists." };
  const company = await db.query.billingCompanies.findFirst({ where: eq(schema.billingCompanies.id, d.billingCompanyId) });
  if (!company) return { fieldErrors: { billingCompanyId: ["That company is gone"] }, error: "Check the highlighted fields." };

  // Only lines the queue itself says are ready: the milestone has happened, it
  // has a date, and the amount is on record.
  const queue = await invoiceQueue({ vendorId: d.vendorId, ready: true });
  const usable = queue.filter((q) => chosen.includes(q.incomeLineId) && q.amount != null);
  if (!usable.length) return { error: "None of those are ready to invoice yet." };
  const currencies = [...new Set(usable.map((q) => q.currency))];
  if (currencies.length > 1) return { error: `One invoice, one currency. These lines are in ${currencies.join(" and ")}, so raise them separately.` };

  const raisedOn = dateOnly(d.raisedOn) ?? new Date().toISOString().slice(0, 10);
  const tax = taxFor(company, (vendor.currency ?? "INR") === "INR" || vendor.isDirect, new Date(`${raisedOn}T00:00:00Z`));
  const money = invoiceTotals(usable.map((q) => ({ amount: q.amount as number })), [], tax);
  const rates = (await getSettings()).fxRates as Record<string, number>;
  const rate = currencies[0] === "INR" ? 1 : rates[currencies[0]];

  const number = await nextInvoiceNumber();
  const [invoice] = await db
    .insert(vi)
    .values({
      number,
      vendorId: d.vendorId,
      billingCompanyId: company.id,
      currency: currencies[0],
      total: money.total,
      rupeeTotal: rate ? Math.round(money.total * rate) : null,
      rateUsed: rate ?? null,
      taxTreatment: tax.treatment,
      taxPercent: tax.percent,
      taxAmount: money.taxAmount,
      state: "RAISED",
      raisedOn,
      dueOn: dueDateFrom(raisedOn, usable[0].daysToPay),
      note: d.note || null,
      createdById: user.id,
    })
    .returning();

  await db.insert(vil).values(
    usable.map((q) => ({
      invoiceId: invoice.id,
      incomeLineId: q.incomeLineId,
      amount: q.amount as number,
      description: [q.studentName, q.course, q.university, q.ackNo].filter(Boolean).join(" · "),
    })),
  );
  await db
    .update(il)
    .set({ invoiceId: invoice.id, invoicedAmount: sql`coalesce(${il.expectedAmount}, ${il.invoicedAmount})`, state: "INVOICED", updatedAt: new Date() })
    .where(inArray(il.id, usable.map((q) => q.incomeLineId)));
  // A commission that has been invoiced says so on the placement too, so the
  // commission screen and this one cannot disagree.
  const commissionIds = (
    await db.select({ id: il.commissionId }).from(il).where(and(inArray(il.id, usable.map((q) => q.incomeLineId)), sql`${il.commissionId} is not null`))
  )
    .map((r) => r.id)
    .filter((x): x is string => !!x);
  if (commissionIds.length) {
    await db.update(schema.commissions).set({ status: "INVOICED", invoicedAt: new Date() }).where(inArray(schema.commissions.id, commissionIds));
  }
  await audit(user.id, "invoice.raise", "invoice", invoice.id, { number, vendor: vendor.name, lines: usable.length, total: money.total, currency: currencies[0], tax: tax.treatment });
  revalidatePath("/admin/invoices");
  // The invoice itself says what was raised: an action that moves the page cannot
  // rely on a toast, because the shell it would appear in is replaced on the way.
  return { redirectTo: `/admin/invoices/${invoice.id}?raised=1` };
}

/** Records that the invoice has gone to the vendor, and to whom. */
export async function sendInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("invoiceId") ?? "");
  const to = String(fd.get("sentTo") ?? "").trim().slice(0, 200) || null;
  const invoice = await db.query.vendorInvoices.findFirst({ where: eq(vi.id, id), with: { vendor: { columns: { name: true, contactEmail: true } } } });
  if (!invoice) return { error: "That invoice is gone." };
  if (invoice.state === "DRAFT") return { error: "Raise it first, so it has a number." };
  await db.update(vi).set({ state: invoice.state === "RAISED" ? "SENT" : invoice.state, sentAt: new Date(), sentById: user.id, sentTo: to ?? invoice.vendor.contactEmail, updatedAt: new Date() }).where(eq(vi.id, id));
  await audit(user.id, "invoice.sent", "invoice", id, { to: to ?? invoice.vendor.contactEmail });
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
  return { ok: `${invoice.number} marked as sent${to ? ` to ${to}` : ""}. The portal does not email it: attach the document yourself.` };
}

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.string().min(1, "How much came in"),
  receivedOn: z.string().min(1, "The day it arrived"),
  reference: z.string().trim().max(120).optional(),
  rupeeAmount: z.string().optional(),
  note: z.string().trim().max(300).optional(),
});

/**
 * Money against an invoice. Vendors pay in instalments and short, so a payment
 * is a row rather than a flag: the invoice is part paid until the whole of it
 * has arrived, and what came in is never overwritten.
 */
export async function recordInvoicePaymentAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = paymentSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const amount = whole(d.amount);
  const rupees = whole(d.rupeeAmount);
  const on = dateOnly(d.receivedOn);
  if (amount == null || Number.isNaN(amount) || amount === 0) return { fieldErrors: { amount: ["A whole amount above nought"] }, error: "Check the highlighted fields." };
  if (Number.isNaN(rupees)) return { fieldErrors: { rupeeAmount: ["A whole amount, or leave it empty"] }, error: "Check the highlighted fields." };
  if (!on) return { fieldErrors: { receivedOn: ["The day it arrived"] }, error: "Check the highlighted fields." };

  const invoice = await loadInvoice(d.invoiceId);
  if (!invoice) return { error: "That invoice is gone." };
  if (invoice.state === "WRITTEN_OFF") return { error: "This was written off. Reopen it before recording money against it." };

  await db.insert(ip).values({
    invoiceId: invoice.id,
    amount,
    currency: invoice.currency,
    rupeeAmount: rupees ?? (invoice.currency === "INR" ? amount : null),
    rateUsed: rupees && invoice.currency !== "INR" ? Math.round((rupees / amount) * 1000) / 1000 : invoice.currency === "INR" ? 1 : null,
    receivedOn: on,
    reference: d.reference || null,
    note: d.note || null,
    recordedById: user.id,
  });

  const received = invoice.money.received + amount;
  // What has stopped being owed, by either route: a part payment on an invoice
  // already half credited settles it.
  const state = stateAfterSettlement(invoice.money.total, received + invoice.money.credited, invoice.state);
  await db
    .update(vi)
    .set({ receivedAmount: received, state, paidAt: state === "PAID" ? new Date() : null, updatedAt: new Date() })
    .where(eq(vi.id, invoice.id));

  // The lines it covered are received only when the whole invoice is, because a
  // part payment cannot be attributed to one student without inventing a split.
  if (state === "PAID") {
    const lineIds = invoice.lines.map((l) => l.incomeLineId);
    await db.update(il).set({ state: "RECEIVED", receivedAmount: sql`${il.invoicedAmount}`, receivedOn: on, updatedAt: new Date() }).where(inArray(il.id, lineIds));
    const commissionIds = (await db.select({ id: il.commissionId }).from(il).where(and(inArray(il.id, lineIds), sql`${il.commissionId} is not null`)))
      .map((r) => r.id)
      .filter((x): x is string => !!x);
    if (commissionIds.length) {
      await db.update(schema.commissions).set({ status: "RECEIVED", receivedAt: new Date() }).where(inArray(schema.commissions.id, commissionIds));
      // A sub-agent who referred one of these students is owed as soon as the
      // vendor's money is in, on the same rule as the branch's own share.
      await settleReferralsForCommissions(commissionIds, user.id);
      // The branch's own share becomes a wallet credit the moment the money is
      // ours, which is what a branch owner is actually waiting for.
      const earned = await db
        .select({ id: schema.commissions.id, orgId: schema.commissions.orgId, partnerAmount: schema.commissions.partnerAmount, currency: schema.commissions.currency })
        .from(schema.commissions)
        .where(inArray(schema.commissions.id, commissionIds));
      const rates = (await getSettings()).fxRates as Record<string, number>;
      for (const c of earned) {
        const alreadyCredited = await db.query.walletEntries.findFirst({ where: and(eq(schema.walletEntries.commissionId, c.id), eq(schema.walletEntries.kind, "COMMISSION")) });
        if (alreadyCredited) continue;
        const rate = c.currency === "INR" ? 1 : rates[c.currency];
        if (!rate) continue;
        await db.insert(schema.walletEntries).values({
          orgId: c.orgId,
          kind: "COMMISSION",
          amountInr: Math.round(c.partnerAmount * rate),
          commissionId: c.id,
          reference: invoice.number,
          note: `Credited when ${invoice.number} was paid`,
          createdById: user.id,
        });
        await notifyUsers(
          await partnerRecipients(c.orgId, null),
          "Commission credited to your wallet",
          `${fmtMoney(Math.round(c.partnerAmount * rate), "INR")} against ${invoice.number}.`,
          "/wallet",
        );
      }
    }
  }
  await audit(user.id, "invoice.payment", "invoice", invoice.id, { amount, on, reference: d.reference ?? null, state });
  await sendMoneyEvent(invoice.id, {
    what: "vendor invoice payment",
    invoiceNumber: invoice.number,
    vendorId: invoice.vendorId,
    currency: invoice.currency,
    amount,
    receivedOn: on,
    invoiceState: state,
  });
  revalidatePath(`/admin/invoices/${invoice.id}`);
  revalidatePath("/admin/invoices");
  return {
    ok:
      state === "PAID"
        ? `${invoice.number} is settled in full. The students' lines are marked received and the branches' shares are in their wallets.`
        : `Part payment recorded. ${fmtMoney(Math.max(0, invoice.money.total - received), invoice.currency)} still owed.`,
  };
}

const disputeSchema = z.object({ invoiceId: z.string().min(1), reason: z.string().trim().min(5, "What the vendor is questioning").max(500) });

/** The vendor has questioned it. A state, not a failure: it is worked out and carries on. */
export async function disputeInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = disputeSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say what the vendor is questioning." };
  const invoice = await db.query.vendorInvoices.findFirst({ where: eq(vi.id, parsed.data.invoiceId) });
  if (!invoice) return { error: "That invoice is gone." };
  await db.update(vi).set({ state: "DISPUTED", disputeReason: parsed.data.reason, disputedAt: new Date(), updatedAt: new Date() }).where(eq(vi.id, invoice.id));
  await audit(user.id, "invoice.disputed", "invoice", invoice.id, { reason: parsed.data.reason });
  revalidatePath(`/admin/invoices/${invoice.id}`);
  revalidatePath("/admin/invoices");
  return { ok: `${invoice.number} marked as disputed. It stays on the ageing report until it is settled.` };
}

/** Puts a disputed invoice back in play once it has been worked out. */
export async function resolveDisputeAction(fd: FormData): Promise<void> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("invoiceId") ?? "");
  const invoice = await db.query.vendorInvoices.findFirst({ where: eq(vi.id, id) });
  if (!invoice || invoice.state !== "DISPUTED") return;
  const state = invoice.receivedAmount >= invoice.total && invoice.total > 0 ? "PAID" : invoice.receivedAmount > 0 ? "PART_PAID" : invoice.sentAt ? "SENT" : "RAISED";
  await db.update(vi).set({ state, updatedAt: new Date() }).where(eq(vi.id, id));
  await audit(user.id, "invoice.dispute_resolved", "invoice", id, { reason: invoice.disputeReason, to: state });
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin/invoices");
}

const offSchema = z.object({ invoiceId: z.string().min(1), reason: z.string().trim().min(5, "Say why it will never be paid").max(500) });

/**
 * Money that stops being owed should never be quiet, so this is a super admin's
 * doing, needs a reason, and leaves the invoice on the record saying so.
 */
export async function writeOffInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!isSuperAdmin(user)) return { error: "Only a super admin can write an invoice off." };
  const parsed = offSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Say why it will never be paid." };
  const invoice = await db.query.vendorInvoices.findFirst({ where: eq(vi.id, parsed.data.invoiceId), with: { lines: true } });
  if (!invoice) return { error: "That invoice is gone." };
  await db.update(vi).set({ state: "WRITTEN_OFF", writtenOffReason: parsed.data.reason, writtenOffById: user.id, updatedAt: new Date() }).where(eq(vi.id, invoice.id));
  await db
    .update(il)
    .set({ state: "WRITTEN_OFF", writtenOffReason: `On ${invoice.number}: ${parsed.data.reason}`, writtenOffById: user.id, updatedAt: new Date() })
    .where(inArray(il.id, invoice.lines.map((l) => l.incomeLineId)));
  await audit(user.id, "invoice.write_off", "invoice", invoice.id, { reason: parsed.data.reason, total: invoice.total, currency: invoice.currency, students: invoice.lines.length });
  revalidatePath(`/admin/invoices/${invoice.id}`);
  revalidatePath("/admin/invoices");
  return { ok: `${invoice.number} written off. Every student's line on it says so, and it is in the audit log.` };
}

/** Takes a line off an invoice that has not been sent, for one put on in error. */
export async function removeInvoiceLineAction(fd: FormData): Promise<void> {
  const user = await requireUser([...ADMIN_ROLES]);
  const lineId = String(fd.get("lineId") ?? "");
  const line = await db.query.vendorInvoiceLines.findFirst({ where: eq(vil.id, lineId), with: { invoice: true } });
  if (!line) return;
  if (line.invoice.state !== "RAISED" && line.invoice.state !== "DRAFT") return;
  await db.delete(vil).where(eq(vil.id, lineId));
  await db.update(il).set({ invoiceId: null, state: "EXPECTED", invoicedAmount: null, updatedAt: new Date() }).where(eq(il.id, line.incomeLineId));
  const rest = await db.select({ amount: vil.amount }).from(vil).where(eq(vil.invoiceId, line.invoiceId));
  const net = rest.reduce((sum, r) => sum + r.amount, 0);
  const taxAmount = Math.round((net * (line.invoice.taxPercent ?? 0)) / 100);
  await db.update(vi).set({ total: net + taxAmount, taxAmount, updatedAt: new Date() }).where(eq(vi.id, line.invoiceId));
  await audit(user.id, "invoice.line_removed", "invoice", line.invoiceId, { incomeLineId: line.incomeLineId, amount: line.amount });
  revalidatePath(`/admin/invoices/${line.invoiceId}`);
}

// ---------- Credit notes ----------

const creditSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.string().optional(),
  reason: z.string().trim().min(5, "Say what is being credited and why").max(500),
  issuedOn: z.string().optional(),
  note: z.string().trim().max(400).optional(),
});

/**
 * Takes money back off an invoice that has already gone out.
 *
 * A write-off says the invoice will never be paid; this says part of it was
 * never owed, which is the ordinary case when a student defers after enrolment
 * or a rate turns out to have been wrong. The vendor gets a numbered document
 * for their own books, the ageing report stops chasing the credited part, and
 * the students it covers are named so nobody has to reconstruct a year later
 * which placement the money came off.
 */
export async function creditInvoiceAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = creditSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const invoice = await loadInvoice(d.invoiceId);
  if (!invoice) return { error: "That invoice is gone." };
  if (invoice.state === "DRAFT") return { error: "This has not gone out yet. Take the line off the draft instead; a credit note against a draft is a document nobody needs." };
  if (invoice.state === "WRITTEN_OFF") return { error: "This was written off whole. Reopen it before crediting part of it." };

  const lineIds = fd.getAll("line").map(String).filter(Boolean);
  const covered = invoice.lines.filter((l) => lineIds.includes(l.id));
  if (lineIds.length && covered.length !== lineIds.length) return { error: "One of those students is no longer on this invoice. Open it again." };

  // The lines decide the amount when any are named, because a credit that does
  // not add up to the students it names is the thing an argument starts over.
  const typed = whole(d.amount);
  if (Number.isNaN(typed)) return { fieldErrors: { amount: ["A whole amount, or tick the students instead"] }, error: "Check the highlighted fields." };
  const amount = covered.length ? covered.reduce((sum, l) => sum + l.amount, 0) : typed;
  if (amount == null) return { fieldErrors: { amount: ["Give an amount, or tick the students it covers"] }, error: "Check the highlighted fields." };
  const allowed = creditAllowed(invoice.money, amount);
  if (!allowed.ok) return { fieldErrors: { amount: [allowed.says] }, error: allowed.says };

  const issuedOn = dateOnly(d.issuedOn) ?? new Date().toISOString().slice(0, 10);
  const number = await nextCreditNoteNumber();
  const [note] = await db
    .insert(schema.creditNotes)
    .values({ number, invoiceId: invoice.id, currency: invoice.currency, amount, reason: d.reason, issuedOn, note: d.note || null, createdById: user.id })
    .returning({ id: schema.creditNotes.id });
  if (covered.length) {
    await db.insert(schema.creditNoteLines).values(covered.map((l) => ({ creditNoteId: note.id, invoiceLineId: l.id, amount: l.amount })));
    // A student's line that has been credited back is not income any more. It
    // carries the credit note's number so the reason is on the student's own
    // file, not only on the invoice.
    await db
      .update(il)
      .set({ state: "WRITTEN_OFF", writtenOffReason: `Credited on ${number}: ${d.reason}`, writtenOffById: user.id, updatedAt: new Date() })
      .where(inArray(il.id, covered.map((l) => l.incomeLineId)));
  }

  const state = stateAfterSettlement(invoice.money.total, invoice.money.received + invoice.money.credited + amount, invoice.state);
  await db.update(vi).set({ state, updatedAt: new Date() }).where(eq(vi.id, invoice.id));
  await audit(user.id, "invoice.credit_note", "invoice", invoice.id, {
    number,
    amount,
    currency: invoice.currency,
    reason: d.reason,
    students: covered.length,
    state,
  });
  revalidatePath(`/admin/invoices/${invoice.id}`);
  revalidatePath("/admin/invoices");
  const left = Math.max(0, invoice.money.outstanding - amount);
  return {
    ok:
      left === 0
        ? `${number} raised for ${fmtMoney(amount, invoice.currency)}. ${invoice.number} is settled and off the ageing report.`
        : `${number} raised for ${fmtMoney(amount, invoice.currency)}. ${fmtMoney(left, invoice.currency)} still owed on ${invoice.number}.`,
  };
}
