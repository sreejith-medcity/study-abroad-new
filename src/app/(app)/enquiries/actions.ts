"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES, isStaff } from "@/lib/permissions";
import { notifyUsers } from "@/server/notify";
import { getEnquiryForUser, STAGE_LABEL } from "@/server/enquiries";

import type { FormState } from "@/lib/form-state";
export type { FormState };

const ROLES = ["PARTNER", "COUNSELLOR", ...ADMIN_ROLES] as const;

const optionalText = z.string().trim().max(200).optional().transform((v) => v || null);
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? new Date(v) : null))
  .refine((v) => v === null || !Number.isNaN(v.getTime()), "Enter a valid date");

const enquiryShape = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  phone: z.string().trim().regex(/^\+?[\d\s-]{8,16}$/, "Enter a valid mobile number with country code"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")).transform((v) => v || null),
  city: optionalText,
  source: z.enum(schema.enquirySource.enumValues),
  interestCountry: optionalText,
  interestPathway: z.enum(schema.pathway.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  intakeMonth: z.string().optional().transform((v) => (v ? Number(v) : null)),
  intakeYear: z.string().optional().transform((v) => (v ? Number(v) : null)),
  budgetLakhs: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || (!Number.isNaN(v) && v >= 0 && v < 1000), "Enter the budget in lakhs"),
  assignedToId: optionalText,
  nextFollowUpAt: optionalDate,
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
});

async function assertAssignee(orgId: string, assignedToId: string | null) {
  if (!assignedToId) return true;
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, assignedToId) });
  return !!user && user.orgId === orgId;
}

export async function createEnquiryAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ROLES]);
  const parsed = enquiryShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const orgId = isStaff(user) ? String(formData.get("orgId") || user.orgId) : user.orgId;
  if (!(await assertAssignee(orgId, d.assignedToId))) return { error: "Pick someone from that organisation." };

  // Same number, same branch, still open: treat it as the existing enquiry.
  const duplicate = await db.query.enquiries.findFirst({
    where: and(eq(schema.enquiries.orgId, orgId), eq(schema.enquiries.phone, d.phone)),
  });
  if (duplicate && duplicate.stage !== "LOST" && duplicate.stage !== "CONVERTED") {
    return { error: `${duplicate.name} is already on the list with this number. Open that enquiry and log a follow-up instead.` };
  }

  const [row] = await db
    .insert(schema.enquiries)
    .values({
      orgId,
      createdById: user.id,
      assignedToId: d.assignedToId ?? (user.role === "COUNSELLOR" ? user.id : null),
      name: d.name,
      phone: d.phone,
      email: d.email,
      city: d.city,
      source: d.source,
      interestCountry: d.interestCountry,
      interestPathway: d.interestPathway,
      intakeMonth: d.intakeMonth,
      intakeYear: d.intakeYear,
      budgetLakhs: d.budgetLakhs,
      nextFollowUpAt: d.nextFollowUpAt,
      notes: d.notes,
    })
    .returning();

  if (d.notes) {
    await db.insert(schema.enquiryNotes).values({ enquiryId: row.id, authorId: user.id, body: d.notes });
  }
  await audit(user.id, "enquiry.create", "enquiry", row.id, { source: d.source });
  if (row.assignedToId && row.assignedToId !== user.id) {
    await notifyUsers([row.assignedToId], "New enquiry assigned to you", `${row.name} · ${row.phone}`, `/enquiries/${row.id}`);
  }
  redirect(`/enquiries/${row.id}`);
}

export async function updateEnquiryAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ROLES]);
  const id = String(formData.get("enquiryId"));
  const existing = await getEnquiryForUser(user, id);
  const parsed = enquiryShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  if (!(await assertAssignee(existing.orgId, d.assignedToId))) return { error: "Pick someone from that organisation." };

  await db
    .update(schema.enquiries)
    .set({
      name: d.name,
      phone: d.phone,
      email: d.email,
      city: d.city,
      source: d.source,
      interestCountry: d.interestCountry,
      interestPathway: d.interestPathway,
      intakeMonth: d.intakeMonth,
      intakeYear: d.intakeYear,
      budgetLakhs: d.budgetLakhs,
      assignedToId: d.assignedToId,
      nextFollowUpAt: d.nextFollowUpAt,
      notes: d.notes,
      updatedAt: new Date(),
    })
    .where(eq(schema.enquiries.id, id));
  await audit(user.id, "enquiry.update", "enquiry", id);
  revalidatePath(`/enquiries/${id}`);
  return { ok: "Saved." };
}

const followUpShape = z.object({
  enquiryId: z.string().min(1),
  body: z.string().trim().min(2, "Write what happened").max(2000),
  stage: z.enum(schema.enquiryStage.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  nextFollowUpAt: optionalDate,
});

/** One contact attempt: what was said, the stage after it, and when to call again. */
export async function logFollowUpAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ROLES]);
  const parsed = followUpShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const enquiry = await getEnquiryForUser(user, d.enquiryId);
  if (enquiry.stage === "CONVERTED") return { error: "This enquiry is already a student." };

  const stage = d.stage ?? (enquiry.stage === "NEW" ? "CONTACTED" : enquiry.stage);
  await db.insert(schema.enquiryNotes).values({ enquiryId: enquiry.id, authorId: user.id, body: d.body, stageAfter: stage });
  await db
    .update(schema.enquiries)
    .set({
      stage,
      lastContactedAt: new Date(),
      nextFollowUpAt: d.nextFollowUpAt ?? (stage === "LOST" ? null : enquiry.nextFollowUpAt),
      updatedAt: new Date(),
    })
    .where(eq(schema.enquiries.id, enquiry.id));
  await audit(user.id, "enquiry.follow_up", "enquiry", enquiry.id, { stage });
  revalidatePath(`/enquiries/${enquiry.id}`);
  revalidatePath("/enquiries");
  return { ok: `Logged. Stage is now ${STAGE_LABEL[stage]}.` };
}

export async function setEnquiryStageAction(formData: FormData) {
  const user = await requireUser([...ROLES]);
  const id = String(formData.get("enquiryId"));
  const stage = String(formData.get("stage")) as schema.EnquiryStage;
  if (!schema.enquiryStage.enumValues.includes(stage)) return;
  const enquiry = await getEnquiryForUser(user, id);
  if (enquiry.stage === stage) return;
  await db
    .update(schema.enquiries)
    .set({ stage, updatedAt: new Date(), ...(stage === "LOST" ? { nextFollowUpAt: null } : {}) })
    .where(eq(schema.enquiries.id, id));
  await db.insert(schema.enquiryNotes).values({
    enquiryId: id,
    authorId: user.id,
    body: `Stage moved from ${STAGE_LABEL[enquiry.stage]} to ${STAGE_LABEL[stage]}.`,
    stageAfter: stage,
  });
  await audit(user.id, "enquiry.stage", "enquiry", id, { from: enquiry.stage, to: stage });
  revalidatePath(`/enquiries/${id}`);
  revalidatePath("/enquiries");
}

const lostShape = z.object({
  enquiryId: z.string().min(1),
  lostReason: z.string().trim().min(3, "Say why, so the branch can learn from it").max(300),
});

export async function markEnquiryLostAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser([...ROLES]);
  const parsed = lostShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const enquiry = await getEnquiryForUser(user, parsed.data.enquiryId);
  await db
    .update(schema.enquiries)
    .set({ stage: "LOST", lostReason: parsed.data.lostReason, nextFollowUpAt: null, updatedAt: new Date() })
    .where(eq(schema.enquiries.id, enquiry.id));
  await db.insert(schema.enquiryNotes).values({
    enquiryId: enquiry.id,
    authorId: user.id,
    body: `Closed as lost: ${parsed.data.lostReason}`,
    stageAfter: "LOST",
  });
  await audit(user.id, "enquiry.lost", "enquiry", enquiry.id, { reason: parsed.data.lostReason });
  revalidatePath(`/enquiries/${enquiry.id}`);
  return { ok: "Closed as lost." };
}

export async function claimEnquiryAction(formData: FormData) {
  const user = await requireUser([...ROLES]);
  const id = String(formData.get("enquiryId"));
  const enquiry = await getEnquiryForUser(user, id);
  await db
    .update(schema.enquiries)
    .set({ assignedToId: user.id, updatedAt: new Date() })
    .where(and(eq(schema.enquiries.id, enquiry.id), or(isNull(schema.enquiries.assignedToId), eq(schema.enquiries.assignedToId, enquiry.assignedToId ?? ""))));
  await audit(user.id, "enquiry.assign", "enquiry", id, { to: user.id });
  revalidatePath(`/enquiries/${id}`);
  revalidatePath("/enquiries");
}
