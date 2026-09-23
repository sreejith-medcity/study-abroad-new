"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { canManageSettings, PROCESSING_ROLES } from "@/lib/permissions";
import { RAZORPAY_CURRENCIES, checkoutSignatureOk, toMinor } from "@/lib/razorpay";
import { seal } from "@/lib/secret-box";
import { getApplicationForUser } from "@/server/queries";
import { createRazorpayOrder, markOrderPaid, razorpayConfig } from "@/server/razorpay";

const settingsShape = z.object({
  razorpayKeyId: z.string().trim().refine((v) => v === "" || /^rzp_(test|live)_[A-Za-z0-9]{8,}$/.test(v), "A key id starts rzp_test_ or rzp_live_"),
  keySecret: z.string().trim().max(200),
  webhookSecret: z.string().trim().max(200),
  enabled: z.string().optional().transform((v) => v === "on"),
});

/** The platform owner's Razorpay keys. Secrets are sealed; a blank box keeps the one on file. */
export async function savePaymentSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canManageSettings(user)) return { error: "Only the platform owner can change payment settings." };
  const parsed = settingsShape.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const current = await db.query.paymentSettings.findFirst({ where: eq(schema.paymentSettings.id, "app") });
  const set = {
    enabled: d.enabled,
    razorpayKeyId: d.razorpayKeyId || null,
    razorpayKeySecretEnc: d.keySecret ? seal(d.keySecret, "razorpay-key") : (current?.razorpayKeySecretEnc ?? null),
    razorpayWebhookSecretEnc: d.webhookSecret ? seal(d.webhookSecret, "razorpay-webhook") : (current?.razorpayWebhookSecretEnc ?? null),
    updatedById: user.id,
    updatedAt: new Date(),
  };
  const envKeys = !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  if (d.enabled && !envKeys && (!set.razorpayKeyId || !set.razorpayKeySecretEnc)) {
    return { fieldErrors: { razorpayKeyId: ["Enter the key id and secret before switching payments on"] }, error: "Check the highlighted fields." };
  }
  await db.insert(schema.paymentSettings).values({ id: "app", ...set }).onConflictDoUpdate({ target: schema.paymentSettings.id, set });
  await audit(user.id, "settings.payments", "settings", "payments", { enabled: d.enabled, keyId: set.razorpayKeyId, secretChanged: !!d.keySecret, webhookChanged: !!d.webhookSecret });
  revalidatePath("/settings/platform");
  return { ok: d.enabled ? "Saved. Online payments are on." : "Saved. Online payments are off." };
}

export type CheckoutStart = { ok: true; keyId: string; orderId: string; amountMinor: number; currency: string; description: string; name: string; email: string; phone: string } | { ok: false; error: string };

/** Opens a Razorpay order for an application's fee, at the fee and currency the program records. */
export async function startFeePaymentAction(applicationId: string): Promise<CheckoutStart> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const base = await getApplicationForUser(user, applicationId);
  const app = await db.query.applications.findFirst({
    where: eq(schema.applications.id, base.id),
    with: { student: true, program: { with: { university: { with: { country: true } } } } },
  });
  if (!app) return { ok: false, error: "That application could not be found." };
  const cfg = await razorpayConfig();
  if (!cfg?.enabled) return { ok: false, error: "Online payments are not switched on." };
  if (app.feeStatus !== "DUE") return { ok: false, error: "This fee is not due." };
  const fee = app.program.applicationFee;
  const currency = app.program.university.country.currency;
  if (fee == null || fee <= 0) return { ok: false, error: "The fee is not recorded, so it cannot be paid online. Ask the Overseas team." };
  if (!(RAZORPAY_CURRENCIES as readonly string[]).includes(currency)) return { ok: false, error: `Fees in ${currency} are paid the usual way.` };
  const amountMinor = toMinor(fee);
  let orderId: string;
  try {
    orderId = await createRazorpayOrder(cfg, amountMinor, currency, app.ackNo, { application: app.id, ack: app.ackNo });
  } catch (e) {
    return { ok: false, error: `Razorpay could not start the payment: ${(e as Error).message}` };
  }
  const [row] = await db
    .insert(schema.payments)
    .values({ orgId: app.orgId, applicationId: app.id, purpose: "APPLICATION_FEE", amountMinor, currency, razorpayOrderId: orderId, createdById: user.id })
    .returning({ id: schema.payments.id });
  await audit(user.id, "payment.start", "payment", row.id, { orderId, amountMinor, currency, applicationId: app.id });
  return {
    ok: true,
    keyId: cfg.keyId,
    orderId,
    amountMinor,
    currency,
    description: `Application fee, ${app.program.university.name} (${app.ackNo})`,
    name: `${app.student.firstName} ${app.student.lastName}`,
    email: app.student.email ?? "",
    phone: app.student.phone,
  };
}

/** Checkout's success callback. The signature proves Razorpay sent it; the webhook confirms it again. */
export async function confirmPaymentAction(input: { orderId: string; paymentId: string; signature: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser(["PARTNER", "COUNSELLOR", ...PROCESSING_ROLES]);
  const cfg = await razorpayConfig();
  if (!cfg) return { ok: false, error: "Online payments are not set up." };
  const pay = await db.query.payments.findFirst({ where: eq(schema.payments.razorpayOrderId, String(input.orderId)) });
  if (!pay || (pay.applicationId && !(await getApplicationForUser(user, pay.applicationId).catch(() => null)))) return { ok: false, error: "That payment is not yours." };
  if (!checkoutSignatureOk(String(input.orderId), String(input.paymentId), String(input.signature), cfg.keySecret)) {
    await audit(user.id, "payment.bad_signature", "payment", pay.id, { orderId: input.orderId });
    return { ok: false, error: "The payment could not be verified. If money left the account, the team will see it from Razorpay." };
  }
  await markOrderPaid(String(input.orderId), String(input.paymentId), user.id);
  if (pay.applicationId) {
    const app = await db.query.applications.findFirst({ where: eq(schema.applications.id, pay.applicationId) });
    if (app) revalidatePath(`/students/${app.studentId}/applications`);
  }
  return { ok: true };
}
