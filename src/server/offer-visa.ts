import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { partnerRecipients, notifyUsers } from "@/server/notify";

const isoDate = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date")]).transform((v) => v || null);
export const offerVisa = z
  .object({
    applicationId: z.string().min(1),
    offerType: z.union([z.literal(""), z.enum(["CONDITIONAL", "UNCONDITIONAL"])]).transform((v) => v || null),
    offerDate: isoDate,
    offerConditions: z.string().trim().max(2000).transform((v) => v || null),
    offerAcceptBy: isoDate,
    depositAmount: z.union([z.literal(""), z.coerce.number().int("Whole number").min(0)]).transform((v) => (v === "" ? null : v)),
    depositPaidOn: isoDate,
    confirmationNumber: z.string().trim().max(60).transform((v) => v || null),
    confirmationIssuedOn: isoDate,
    visaLodgedOn: isoDate,
    visaDecision: z.union([z.literal(""), z.enum(["GRANTED", "REFUSED"])]).transform((v) => v || null),
    visaDecisionOn: isoDate,
  })
  .superRefine((v, ctx) => {
    if (v.offerType && !v.offerDate) ctx.addIssue({ code: "custom", path: ["offerDate"], message: "When was the offer issued?" });
    if (!v.offerType && (v.offerDate || v.offerAcceptBy || v.offerConditions)) ctx.addIssue({ code: "custom", path: ["offerType"], message: "Say which kind of offer it is" });
    if (v.offerDate && v.offerAcceptBy && v.offerAcceptBy < v.offerDate) ctx.addIssue({ code: "custom", path: ["offerAcceptBy"], message: "Before the offer date" });
    if (v.depositPaidOn && v.depositAmount == null) ctx.addIssue({ code: "custom", path: ["depositAmount"], message: "How much was paid?" });
    if (v.visaDecision && !v.visaDecisionOn) ctx.addIssue({ code: "custom", path: ["visaDecisionOn"], message: "When was the decision?" });
    if (v.visaDecisionOn && !v.visaDecision) ctx.addIssue({ code: "custom", path: ["visaDecision"], message: "Granted or refused?" });
    if (v.visaLodgedOn && v.visaDecisionOn && v.visaDecisionOn < v.visaLodgedOn) ctx.addIssue({ code: "custom", path: ["visaDecisionOn"], message: "Before the visa was lodged" });
  });

export type OfferVisaValues = Omit<z.infer<typeof offerVisa>, "applicationId">;

/**
 * Saves the offer and visa facts on one application, tells the branch what
 * changed, and keeps the offer's accept-by date as a deadline. Returns the
 * names of the fields that changed.
 */
export async function saveOfferVisa(user: SessionUser, app: typeof schema.applications.$inferSelect, values: OfferVisaValues) {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(values)) {
    const before = app[k as keyof typeof app] ?? null;
    if (String(before ?? "") !== String(v ?? "")) changed[k] = { from: before, to: v };
  }
  if (!Object.keys(changed).length) return [];
  await db.update(schema.applications).set({ ...values, updatedAt: new Date() }).where(eq(schema.applications.id, app.id));
  await audit(user.id, "application.offer_visa", "application", app.id, { changed });
  // An accept-by date is a deadline like any other, so it shows on dashboards.
  if (changed.offerAcceptBy) {
    const d = schema.applicationDeadlines;
    await db.delete(d).where(and(eq(d.applicationId, app.id), eq(d.type, "OFFER_ACCEPTANCE"), isNull(d.doneAt)));
    if (values.offerAcceptBy) await db.insert(d).values({ applicationId: app.id, type: "OFFER_ACCEPTANCE", dueOn: values.offerAcceptBy, note: "From the offer", createdById: user.id });
  }
  const student = await db.query.students.findFirst({ where: eq(schema.students.id, app.studentId), columns: { assignedToId: true } });
  const headline = changed.visaDecision
    ? `Visa ${values.visaDecision === "GRANTED" ? "granted" : "refused"}`
    : changed.offerType
      ? `${values.offerType === "UNCONDITIONAL" ? "Unconditional" : "Conditional"} offer recorded`
      : "Offer and visa details updated";
  await notifyUsers(await partnerRecipients(app.orgId, student?.assignedToId), `${app.ackNo}: ${headline}`, Object.keys(changed).join(", "), `/students/${app.studentId}/applications?app=${app.id}`);
  return Object.keys(changed);
}
