import { webhookSignatureOk } from "@/lib/razorpay";
import { markOrderFailed, markOrderPaid, razorpayConfig } from "@/server/razorpay";
import { markPaymentLinkPaid } from "@/server/student-fees";

export const dynamic = "force-dynamic";

type Hook = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; error_description?: string; amount?: number } };
    order?: { entity?: { id?: string } };
    payment_link?: { entity?: { id?: string; amount_paid?: number } };
  };
};

/**
 * Razorpay's webhook, set in the Razorpay dashboard to send payment.captured,
 * order.paid, payment.failed and payment_link.paid (a student's fee paid
 * through a payment link). Signed with the webhook secret; anything
 * unsigned is refused. Answers 200 to events it does not use, so Razorpay
 * does not keep retrying them.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const cfg = await razorpayConfig();
  if (!cfg?.webhookSecret) return new Response("Webhook not configured", { status: 503 });
  const sig = request.headers.get("x-razorpay-signature") ?? "";
  if (!sig || !webhookSignatureOk(raw, sig, cfg.webhookSecret)) return new Response("Bad signature", { status: 401 });
  let hook: Hook;
  try {
    hook = JSON.parse(raw) as Hook;
  } catch {
    return new Response("Bad body", { status: 400 });
  }
  const payment = hook.payload?.payment?.entity;
  const link = hook.payload?.payment_link?.entity;
  if (hook.event === "payment_link.paid" && link?.id && payment?.id) {
    await markPaymentLinkPaid(link.id, payment.id, payment.amount ?? link.amount_paid ?? 0);
    return new Response("ok");
  }
  const orderId = hook.payload?.order?.entity?.id ?? payment?.order_id;
  if (orderId && payment?.id && (hook.event === "payment.captured" || hook.event === "order.paid")) {
    await markOrderPaid(orderId, payment.id, null);
  } else if (orderId && hook.event === "payment.failed") {
    await markOrderFailed(orderId, payment?.error_description ?? "Payment failed");
  }
  return new Response("ok");
}
