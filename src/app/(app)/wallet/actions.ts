"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { adminIds, notifyUsers } from "@/server/notify";
import { inr, walletBalance } from "@/server/commission";

import type { FormState } from "@/lib/form-state";
export type { FormState };

const requestShape = z.object({
  amountInr: z
    .string()
    .transform((v) => Math.round(Number(v)))
    .refine((v) => !Number.isNaN(v) && v > 0, "Enter how much you want to withdraw"),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
});

/** A partner asks Medcity to pay out part of the balance. */
export async function requestPayoutAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER"]);
  const parsed = requestShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const { amountInr, note } = parsed.data;

  const { balance } = await walletBalance(user.orgId);
  const pending = await db.query.payoutRequests.findFirst({
    where: and(eq(schema.payoutRequests.orgId, user.orgId), eq(schema.payoutRequests.status, "REQUESTED")),
  });
  if (pending) return { error: `A request for ${inr(pending.amountInr)} is already with the Overseas team.` };
  if (amountInr > balance) return { error: `Your balance is ${inr(balance)}.`, fieldErrors: { amountInr: ["More than the balance"] } };

  const [row] = await db
    .insert(schema.payoutRequests)
    .values({ orgId: user.orgId, amountInr, requestedById: user.id, note })
    .returning();
  await audit(user.id, "payout.request", "payout", row.id, { amount: amountInr });
  await notifyUsers(await adminIds(), "Payout requested", `${user.orgName}: ${inr(amountInr)}`, "/admin/commission?tab=payouts");
  revalidatePath("/wallet");
  return { ok: `Requested ${inr(amountInr)}. The Overseas team will confirm.` };
}

export async function cancelPayoutAction(formData: FormData) {
  const user = await requireUser(["PARTNER"]);
  const id = String(formData.get("payoutId"));
  const payout = await db.query.payoutRequests.findFirst({ where: eq(schema.payoutRequests.id, id) });
  if (!payout || payout.orgId !== user.orgId || payout.status !== "REQUESTED") return;
  await db
    .update(schema.payoutRequests)
    .set({ status: "REJECTED", decidedById: user.id, decidedAt: new Date(), note: "Withdrawn by the partner" })
    .where(eq(schema.payoutRequests.id, id));
  await audit(user.id, "payout.cancel", "payout", id, { amount: payout.amountInr });
  revalidatePath("/wallet");
}
