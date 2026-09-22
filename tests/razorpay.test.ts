import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { checkoutSignatureOk, toMinor, webhookSignatureOk } from "../src/lib/razorpay";
import { open, seal } from "../src/lib/secret-box";

test("razorpay: checkout and webhook signatures", () => {
  const sig = createHmac("sha256", "s3cret").update("order_1|pay_1").digest("hex");
  assert.ok(checkoutSignatureOk("order_1", "pay_1", sig, "s3cret"));
  assert.ok(!checkoutSignatureOk("order_1", "pay_2", sig, "s3cret"));
  assert.ok(!checkoutSignatureOk("order_1", "pay_1", sig.slice(0, 10), "s3cret"));
  const body = '{"event":"payment.captured"}';
  const wsig = createHmac("sha256", "hook").update(body).digest("hex");
  assert.ok(webhookSignatureOk(body, wsig, "hook"));
  assert.ok(!webhookSignatureOk(body + " ", wsig, "hook"));
  assert.equal(toMinor(150), 15000);
  assert.equal(toMinor(19.99), 1999);
});

test("secret box: sealed secrets open only with the same AUTH_SECRET and purpose", () => {
  const before = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "x".repeat(40);
  const sealed = seal("rzp_secret_value", "razorpay");
  assert.ok(!sealed.includes("rzp_secret_value"));
  assert.equal(open(sealed, "razorpay"), "rzp_secret_value");
  assert.equal(open(sealed, "other"), null);
  process.env.AUTH_SECRET = "y".repeat(40);
  assert.equal(open(sealed, "razorpay"), null);
  process.env.AUTH_SECRET = before;
});
