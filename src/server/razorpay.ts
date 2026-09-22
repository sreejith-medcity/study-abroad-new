import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { open } from "@/lib/secret-box";
import { adminIds, notifyUsers, partnerRecipients } from "@/server/notify";

export type RazorpayConfig = { keyId: string; keySecret: string; webhookSecret: string | null; enabled: boolean; source: "env" | "settings" };

/** Keys from the environment when set there, otherwise from Settings. Online payments also need the owner's switch. */
export async function razorpayConfig(): Promise<RazorpayConfig | null> {
  const row = await db.query.paymentSettings.findFirst({ where: eq(schema.paymentSettings.id, "app") });
  const enabled = row?.enabled ?? false;
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return { keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? null, enabled, source: "env" };
  }
  if (!row?.razorpayKeyId || !row.razorpayKeySecretEnc) return null;
  const keySecret = open(row.razorpayKeySecretEnc, "razorpay-key");
  if (!keySecret) return null;
  const webhookSecret = row.razorpayWebhookSecretEnc ? open(row.razorpayWebhookSecretEnc, "razorpay-webhook") : null;
  return { keyId: row.razorpayKeyId, keySecret, webhookSecret, enabled, source: "settings" };
}

const apiBase = () => (process.env.RAZORPAY_API_BASE ?? "https://api.razorpay.com").replace(/\/$/, "");

/** Creates an order at Razorpay. Throws with Razorpay's own message when it refuses. */
export async function createRazorpayOrder(cfg: RazorpayConfig, amountMinor: number, currency: string, receipt: string, notes: Record<string, string>) {
  const res = await fetch(`${apiBase()}/v1/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}` },
    body: JSON.stringify({ amount: amountMinor, currency, receipt: receipt.slice(0, 40), notes }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { description?: string } };
  if (!res.ok || !body.id) throw new Error(body.error?.description ?? `Razorpay answered ${res.status}`);
  return body.id;
}

/** Marks an order paid, once, and settles what it was for. Safe to call from both checkout and the webhook. */
export async function markOrderPaid(orderId: string, paymentId: string, actorId: string | null) {
  const p = schema.payments;
  const [row] = await db
    .update(p)
    .set({ status: "PAID", razorpayPaymentId: paymentId, paidAt: new Date(), failureReason: null })
    .where(and(eq(p.razorpayOrderId, orderId), ne(p.status, "PAID")))
    .returning();
  if (!row) return false;
  if (row.purpose === "APPLICATION_FEE" && row.applicationId) {
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, row.applicationId), with: { student: true } });
    await db.update(schema.applications).set({ feeStatus: "PAID" }).where(eq(schema.applications.id, row.applicationId));
    if (app) {
      const href = `/students/${app.studentId}/applications?app=${app.id}`;
      await notifyUsers([...(await partnerRecipients(app.orgId, app.student.assignedToId)), ...(await adminIds())], `${app.ackNo}: application fee paid online`, `${row.currency} ${(row.amountMinor / 100).toFixed(2)}`, href);
    }
  }
  await audit(actorId, "payment.paid", "payment", row.id, { orderId, paymentId, amountMinor: row.amountMinor, currency: row.currency });
  return true;
}

export async function markOrderFailed(orderId: string, reason: string) {
  const p = schema.payments;
  const [row] = await db
    .update(p)
    .set({ status: "FAILED", failureReason: reason.slice(0, 300) })
    .where(and(eq(p.razorpayOrderId, orderId), eq(p.status, "CREATED")))
    .returning();
  if (row) await audit(null, "payment.failed", "payment", row.id, { orderId, reason });
  return !!row;
}
