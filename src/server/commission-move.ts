import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { inr } from "@/lib/money";
import { notifyUsers, partnerRecipients } from "@/server/notify";

export type CommissionMove = { status: (typeof schema.commissionStatus.enumValues)[number]; invoiceRef: string | null; partnerAmountInr: number | null; note: string | null };

/**
 * Moves one commission along: invoiced, received from the institution, or
 * settled with the partner. Settling credits the partner's wallet once.
 * Returns a problem to show, "amount" when a settlement lacks the rupee
 * figure, or null when it moved.
 */
export async function moveCommission(user: SessionUser, commission: typeof schema.commissions.$inferSelect, d: CommissionMove): Promise<string | null> {
  if (commission.status === d.status) return `Already ${d.status.toLowerCase().replace("_", " ")}.`;

  const now = new Date();
  const partnerInr = d.partnerAmountInr ?? commission.partnerAmountInr ?? (commission.currency === "INR" ? commission.partnerAmount : null);
  if (d.status === "SETTLED" && !partnerInr) {
    return "amount";
  }

  await db
    .update(schema.commissions)
    .set({
      status: d.status,
      invoiceRef: d.invoiceRef ?? commission.invoiceRef,
      partnerAmountInr: partnerInr,
      note: d.note ?? commission.note,
      invoicedAt: d.status === "INVOICED" ? now : commission.invoicedAt,
      receivedAt: d.status === "RECEIVED" ? now : commission.receivedAt,
      settledAt: d.status === "SETTLED" ? now : commission.settledAt,
      updatedAt: now,
    })
    .where(eq(schema.commissions.id, commission.id));

  if (d.status === "SETTLED") {
    const already = await db.query.walletEntries.findFirst({
      where: eq(schema.walletEntries.commissionId, commission.id),
    });
    if (!already && partnerInr) {
      await db.insert(schema.walletEntries).values({
        orgId: commission.orgId,
        kind: "COMMISSION",
        amountInr: partnerInr,
        commissionId: commission.id,
        reference: d.invoiceRef ?? commission.invoiceRef,
        note: "Commission share credited",
        createdById: user.id,
      });
      await notifyUsers(
        await partnerRecipients(commission.orgId),
        "Commission credited to your wallet",
        `${inr(partnerInr)} is now available`,
        "/wallet",
      );
    }
  }

  await audit(user.id, "commission.status", "commission", commission.id, { from: commission.status, to: d.status });
  return null;
}
