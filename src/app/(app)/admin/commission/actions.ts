"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { moveCommission } from "@/server/commission-move";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import { notifyUsers, partnerRecipients } from "@/server/notify";
import { accrueMissing, inr } from "@/server/commission";

import type { FormState } from "@/lib/form-state";
export type { FormState };

const optionalText = z.string().trim().max(200).optional().transform((v) => v || null);
const num = (msg: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Number(v)))
    .refine((v) => v === null || (!Number.isNaN(v) && v >= 0), msg);

const ruleShape = z
  .object({
    name: z.string().trim().min(2, "Give the rule a name").max(120),
    countryId: optionalText,
    universityId: optionalText,
    programId: optionalText,
    intakeYear: num("Enter a year"),
    basis: z.enum(schema.commissionBasis.enumValues),
    percentOfTuition: num("Enter a percentage"),
    flatAmount: num("Enter an amount"),
    currency: z.string().trim().length(3).toUpperCase(),
    partnerSharePercent: num("Enter the partner share").refine((v) => v !== null && v <= 100, "Between 0 and 100"),
    notes: optionalText,
  })
  .refine((d) => (d.basis === "FLAT" ? d.flatAmount !== null : d.percentOfTuition !== null), {
    message: "Fill in the amount for the basis you picked",
    path: ["percentOfTuition"],
  });

export async function saveRuleAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = ruleShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!d.countryId && !d.universityId && !d.programId) {
    return { error: "Point the rule at a country, a university or a program." };
  }

  const id = String(formData.get("ruleId") || "");
  const values = {
    name: d.name,
    countryId: d.countryId,
    universityId: d.universityId,
    programId: d.programId,
    intakeYear: d.intakeYear,
    basis: d.basis,
    percentOfTuition: d.basis === "PERCENT_TUITION" ? d.percentOfTuition : null,
    flatAmount: d.basis === "FLAT" ? d.flatAmount : null,
    currency: d.currency,
    partnerSharePercent: d.partnerSharePercent ?? 50,
    notes: d.notes,
  };

  if (id) {
    await db.update(schema.commissionRules).set(values).where(eq(schema.commissionRules.id, id));
    await audit(user.id, "commission.rule_update", "commission_rule", id, { name: d.name });
  } else {
    const [row] = await db.insert(schema.commissionRules).values(values).returning();
    await audit(user.id, "commission.rule_create", "commission_rule", row.id, { name: d.name });
  }
  revalidatePath("/admin/commission");
  return { ok: id ? "Rule updated." : "Rule added." };
}

export async function toggleRuleAction(formData: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(formData.get("ruleId"));
  const rule = await db.query.commissionRules.findFirst({ where: eq(schema.commissionRules.id, id) });
  if (!rule) return;
  await db.update(schema.commissionRules).set({ active: !rule.active }).where(eq(schema.commissionRules.id, id));
  await audit(user.id, "commission.rule_toggle", "commission_rule", id, { active: !rule.active });
  revalidatePath("/admin/commission");
}

export async function accrueMissingAction(): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const { scanned, created } = await accrueMissing();
  await audit(user.id, "commission.accrue_missing", "commission", "*", { scanned, created });
  revalidatePath("/admin/commission");
  return { ok: created ? `${created} commission${created > 1 ? "s" : ""} added from ${scanned} placement${scanned > 1 ? "s" : ""}.` : `Nothing to add. ${scanned} placement${scanned === 1 ? "" : "s"} already have a commission or no rule matches them.` };
}

const moveShape = z.object({
  commissionId: z.string().min(1),
  status: z.enum(schema.commissionStatus.enumValues),
  invoiceRef: z.string().trim().max(60).optional().transform((v) => v || null),
  partnerAmountInr: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? null : Math.round(Number(v))))
    .refine((v) => v === null || (!Number.isNaN(v) && v >= 0), "Enter the rupee amount"),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
});

/**
 * Moves one commission along: invoiced, received from the institution, or
 * settled with the partner. Settling credits the partner's wallet once.
 */
export async function moveCommissionAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = moveShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const commission = await db.query.commissions.findFirst({ where: eq(schema.commissions.id, d.commissionId) });
  if (!commission) return { error: "Commission not found." };
  const problem = await moveCommission(user, commission, d);
  if (problem) return problem === "amount" ? { error: "Enter the rupee amount before paying the partner.", fieldErrors: { partnerAmountInr: ["Required"] } } : { error: problem };
  revalidatePath("/admin/commission");
  revalidatePath("/commission");
  revalidatePath("/wallet");
  return { ok: `Moved to ${d.status.toLowerCase().replace("_", " ")}.` };
}

const adjustShape = z.object({
  orgId: z.string().min(1),
  amountInr: z
    .string()
    .transform((v) => Math.round(Number(v)))
    .refine((v) => !Number.isNaN(v) && v !== 0, "Enter an amount, positive or negative"),
  kind: z.enum(["BONUS", "ADJUSTMENT"]),
  note: z.string().trim().min(3, "Say what this is for").max(300),
});

export async function adjustWalletAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = adjustShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  await db.insert(schema.walletEntries).values({
    orgId: d.orgId,
    kind: d.kind,
    amountInr: d.amountInr,
    note: d.note,
    createdById: user.id,
  });
  await audit(user.id, "wallet.adjust", "organization", d.orgId, { amount: d.amountInr, kind: d.kind });
  await notifyUsers(await partnerRecipients(d.orgId), d.amountInr > 0 ? "Wallet credited" : "Wallet adjusted", d.note, "/wallet");
  revalidatePath("/admin/commission");
  revalidatePath("/wallet");
  return { ok: `${d.amountInr > 0 ? "Credited" : "Debited"} ${inr(Math.abs(d.amountInr))}.` };
}

const decideShape = z.object({
  payoutId: z.string().min(1),
  decision: z.enum(["APPROVED", "PAID", "REJECTED"]),
  reference: z.string().trim().max(80).optional().transform((v) => v || null),
  note: z.string().trim().max(300).optional().transform((v) => v || null),
});

/** Approve, pay or reject a partner's payout request. Paying debits the wallet. */
export async function decidePayoutAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = decideShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const payout = await db.query.payoutRequests.findFirst({ where: eq(schema.payoutRequests.id, d.payoutId) });
  if (!payout) return { error: "Request not found." };
  if (payout.status === "PAID" || payout.status === "REJECTED") return { error: "This request is already closed." };

  await db
    .update(schema.payoutRequests)
    .set({ status: d.decision, decidedById: user.id, decidedAt: new Date(), reference: d.reference ?? payout.reference, note: d.note ?? payout.note })
    .where(eq(schema.payoutRequests.id, payout.id));

  if (d.decision === "PAID") {
    const already = await db.query.walletEntries.findFirst({ where: eq(schema.walletEntries.payoutId, payout.id) });
    if (!already) {
      await db.insert(schema.walletEntries).values({
        orgId: payout.orgId,
        kind: "PAYOUT",
        amountInr: -Math.abs(payout.amountInr),
        payoutId: payout.id,
        reference: d.reference,
        note: "Paid out to the partner",
        createdById: user.id,
      });
    }
  }

  await audit(user.id, "payout.decide", "payout", payout.id, { decision: d.decision, amount: payout.amountInr });
  await notifyUsers(
    await partnerRecipients(payout.orgId),
    d.decision === "PAID" ? "Payout sent" : d.decision === "APPROVED" ? "Payout approved" : "Payout request declined",
    `${inr(payout.amountInr)}${d.note ? ` · ${d.note}` : ""}`,
    "/wallet",
  );
  revalidatePath("/admin/commission");
  revalidatePath("/wallet");
  return { ok: `Request marked ${d.decision.toLowerCase()}.` };
}
