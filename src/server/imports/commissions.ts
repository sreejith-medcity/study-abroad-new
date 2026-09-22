import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { num, oneOf, text, type Problems } from "@/lib/import-values";
import { moveCommission } from "@/server/commission-move";
import { emptyResult, lineOf, type ImportResult } from "./common";

export const COMMISSION_COLUMNS = ["ack_no", "status", "invoice_ref", "partner_amount_inr", "note"] as const;
export const COMMISSION_EXAMPLE = ["144408/26-27", "RECEIVED", "INV-2026-114", "", "Paid by the university on 18 Sep"];

/**
 * Commission moves from a settlement sheet, by application acknowledgement
 * number: invoiced, received, settled (credits the branch wallet once, and
 * needs the rupee figure) or written off. Each row goes through the same step
 * as the Commission screen.
 */
export async function importCommissionPayments(user: SessionUser, rows: Record<string, string>[], commit: boolean): Promise<ImportResult> {
  const out = emptyResult();
  const acks = rows.map((r) => (r.ack_no ?? "").trim()).filter(Boolean);
  const found = acks.length
    ? await db
        .select({ ack: schema.applications.ackNo, commission: schema.commissions })
        .from(schema.commissions)
        .innerJoin(schema.applications, eq(schema.commissions.applicationId, schema.applications.id))
        .where(inArray(schema.applications.ackNo, acks))
    : [];
  const byAck = new Map(found.map((f) => [f.ack, f.commission]));
  const seen = new Set<string>();
  for (const [i, r] of rows.entries()) {
    const line = lineOf(i);
    const p: Problems = [];
    const ack = (r.ack_no ?? "").trim();
    const c = byAck.get(ack);
    if (!ack) p.push("ack_no is required");
    else if (!c) p.push(`${ack} has no commission yet: the application has not reached a paying milestone, or no commission rule matches it`);
    if (ack && seen.has(ack)) p.push(`${ack} is in the file twice`);
    seen.add(ack);
    const status = oneOf(r.status, "status", schema.commissionStatus.enumValues, p, { paid: "SETTLED", settled: "SETTLED", "paid to partner": "SETTLED", received: "RECEIVED", invoiced: "INVOICED", "written off": "WRITTEN_OFF" });
    if (!text(r.status)) p.push("status is required");
    const amount = num(r.partner_amount_inr, "partner_amount_inr", p, { int: true, min: 0 });
    if (status === "SETTLED" && c && amount == null && c.partnerAmountInr == null && c.currency !== "INR") p.push("partner_amount_inr is needed to pay the branch");
    if (p.length || !c || !status) {
      out.errors.push({ line, message: p.join("; ") });
      continue;
    }
    if (c.status === status) {
      out.unchanged++;
      continue;
    }
    out.updated++;
    if (out.sample.length < 8) out.sample.push(`${ack}: ${c.status.toLowerCase().replace("_", " ")} to ${status.toLowerCase().replace("_", " ")}${amount != null ? `, ₹${amount.toLocaleString("en-IN")}` : ""}`);
    if (!commit) continue;
    const problem = await moveCommission(user, c, { status, invoiceRef: text(r.invoice_ref, 60), partnerAmountInr: amount, note: text(r.note, 300) });
    if (problem) {
      out.updated--;
      out.errors.push({ line, message: problem === "amount" ? "partner_amount_inr is needed to pay the branch" : problem });
    }
  }
  return out;
}
