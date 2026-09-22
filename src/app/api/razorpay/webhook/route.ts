import { webhookSignatureOk } from "@/lib/razorpay";
import { markOrderFailed, markOrderPaid, razorpayConfig } from "@/server/razorpay";

export const dynamic = "force-dynamic";

type Hook = {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; error_description?: string } };
    order?: { entity?: { id?: string } };
  };
};

/**
 * Razorpay's webhook, set in the Razorpay dashboard to send payment.captured,
 * order.paid and payment.failed. Signed with the webhook secret; anything
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
  const orderId = hook.payload?.order?.entity?.id ?? payment?.order_id;
  if (orderId && payment?.id && (hook.event === "payment.captured" || hook.event === "order.paid")) {
    await markOrderPaid(orderId, payment.id, null);
  } else if (orderId && hook.event === "payment.failed") {
    await markOrderFailed(orderId, payment?.error_description ?? "Payment failed");
  }
  return new Response("ok");
}
