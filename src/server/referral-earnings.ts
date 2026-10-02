import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { earningFrom } from "@/lib/agents";
import { effectiveRate } from "@/server/agents";
import { getSettings } from "@/server/settings";
import { inr } from "@/lib/money";
import { notifyUsers, partnerRecipients } from "@/server/notify";

/**
 * What a sub-agent earns for a student they referred, and when it becomes money
 * they can withdraw.
 *
 * Two rules hold throughout. A figure nobody can work out stays null and reads
 * as "Not recorded" rather than becoming nought, and an earning only reaches
 * PAYABLE once Medcity has actually been paid for that student, so nothing in a
 * sub-agent's balance is money the company is still waiting for.
 */

/**
 * Opens the earning when a referred student is registered.
 *
 * Created with no amount on purpose: the rate may not be set yet, and there is
 * certainly no commission to take a share of. The sub-agent sees the row from
 * the first day, which is the point, with "Not yet earned" against it.
 */
export async function openReferralEarning(studentId: string, referredByOrgId: string) {
  const already = await db.query.referralEarnings.findFirst({ where: eq(schema.referralEarnings.studentId, studentId) });
  if (already) return already;
  const [row] = await db
    .insert(schema.referralEarnings)
    .values({ orgId: referredByOrgId, studentId, state: "PENDING" })
    .onConflictDoNothing({ target: schema.referralEarnings.studentId })
    .returning();
  return row ?? (await db.query.referralEarnings.findFirst({ where: eq(schema.referralEarnings.studentId, studentId) })) ?? null;
}

/** The rupee value of a commission's gross, or null where no rate converts it. */
async function grossInRupees(commission: { grossAmount: number; currency: string }) {
  if (commission.currency === "INR") return { amount: Math.round(commission.grossAmount), rateUsed: 1 };
  const rates = (await getSettings()).fxRates as Record<string, number>;
  const rate = rates[commission.currency];
  if (!rate) return { amount: null, rateUsed: null };
  return { amount: Math.round(commission.grossAmount * rate), rateUsed: rate };
}

/**
 * Settles the referral behind one commission, if there is one.
 *
 * Called at the moment Medcity's own money lands: a commission marked received
 * or settled, or a vendor invoice paid. It prices the earning from the rate in
 * force on the day the money came in, moves it to PAYABLE and credits the
 * sub-agent's wallet, which is the same balance the withdrawal screen reads.
 *
 * Everything is guarded, because both of those moments can happen twice: an
 * earning already credited is left exactly as it is.
 */
export async function settleReferralForCommission(commissionId: string, actorId: string | null): Promise<{ credited: number } | null> {
  const commission = await db.query.commissions.findFirst({
    where: eq(schema.commissions.id, commissionId),
    with: { application: { columns: { id: true, studentId: true } } },
  });
  if (!commission?.application) return null;

  const student = await db.query.students.findFirst({ where: eq(schema.students.id, commission.application.studentId) });
  if (!student?.referredByOrgId) return null;

  const earning = await openReferralEarning(student.id, student.referredByOrgId);
  if (!earning || earning.state === "PAID" || earning.state === "CANCELLED") return null;
  // Already credited: nothing more to do, whichever path got here first.
  if (earning.walletEntryId) return null;

  const rate = await effectiveRate(student.referredByOrgId);
  const gross = await grossInRupees(commission);
  const amount = earningFrom(rate, gross.amount);

  // Priced or not, the earning is payable the moment the money is in: a figure
  // the desk has yet to set must not quietly stop a partner being paid, and the
  // unpriced list on the desk's screen is there so somebody sets it.
  const note =
    rate == null
      ? "No referral rate was set when this became payable"
      : rate.kind === "SHARE_OF_COMMISSION"
        ? gross.amount == null
          ? `A share of a commission in ${commission.currency}, which has no exchange rate on file`
          : `${rate.percent}% of ${inr(gross.amount)}${gross.rateUsed && gross.rateUsed !== 1 ? ` (at ${gross.rateUsed} to the ${commission.currency})` : ""}`
        : "A fixed amount per enrolment";

  await db
    .update(schema.referralEarnings)
    .set({
      applicationId: commission.application.id,
      commissionId: commission.id,
      kind: rate?.kind ?? null,
      rateId: rate?.id ?? null,
      amountInr: amount,
      state: "PAYABLE",
      payableAt: new Date(),
      note,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.referralEarnings.id, earning.id), eq(schema.referralEarnings.state, "PENDING")));

  if (amount == null || amount <= 0) return { credited: 0 };

  const [entry] = await db
    .insert(schema.walletEntries)
    .values({
      orgId: student.referredByOrgId,
      kind: "REFERRAL",
      amountInr: amount,
      reference: student.medcityId,
      note: `Referral fee for ${student.firstName} ${student.lastName}`,
      createdById: actorId,
    })
    .returning();
  await db.update(schema.referralEarnings).set({ walletEntryId: entry.id, updatedAt: new Date() }).where(eq(schema.referralEarnings.id, earning.id));
  await notifyUsers(
    await partnerRecipients(student.referredByOrgId),
    "Referral fee credited to your wallet",
    `${inr(amount)} for ${student.firstName} ${student.lastName}`,
    "/wallet",
  );
  return { credited: amount };
}

/** Every commission on one invoice, settled in turn. */
export async function settleReferralsForCommissions(commissionIds: string[], actorId: string | null) {
  let credited = 0;
  for (const id of commissionIds) {
    const done = await settleReferralForCommission(id, actorId);
    credited += done?.credited ?? 0;
  }
  return credited;
}

/**
 * Marks the earnings behind a paid withdrawal as paid.
 *
 * The wallet is the balance; this is bookkeeping on top of it, so a sub-agent
 * looking at one referral can see that the money for it has gone out. Oldest
 * payable first, up to the amount of the payout, which is how a part withdrawal
 * is attributed without inventing a split inside one earning.
 */
export async function markEarningsPaid(orgId: string, amountInr: number) {
  const payable = await db.query.referralEarnings.findMany({
    where: and(eq(schema.referralEarnings.orgId, orgId), eq(schema.referralEarnings.state, "PAYABLE")),
    orderBy: (t, { asc }) => [asc(t.payableAt), asc(t.createdAt)],
  });
  let left = amountInr;
  const paid: string[] = [];
  for (const e of payable) {
    const value = e.amountInr ?? 0;
    if (value <= 0 || value > left) continue;
    paid.push(e.id);
    left -= value;
  }
  if (paid.length) {
    await db.update(schema.referralEarnings).set({ state: "PAID", updatedAt: new Date() }).where(inArray(schema.referralEarnings.id, paid));
  }
  return paid.length;
}
