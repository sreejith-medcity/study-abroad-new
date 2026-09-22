import { createHmac, timingSafeEqual } from "node:crypto";

/** Currencies taken online, all with two decimal places. Others are paid the usual way. */
export const RAZORPAY_CURRENCIES = ["INR", "GBP", "EUR", "USD", "AUD", "CAD", "NZD", "SGD", "CHF"] as const;

export const toMinor = (amount: number) => Math.round(amount * 100);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Checkout's signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export function checkoutSignatureOk(orderId: string, paymentId: string, signature: string, keySecret: string) {
  const expected = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

/** A webhook's signature: HMAC-SHA256 of the raw body with the webhook secret. */
export function webhookSignatureOk(rawBody: string, signature: string, webhookSecret: string) {
  const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}
