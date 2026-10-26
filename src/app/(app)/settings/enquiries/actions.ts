"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { PARTNER_ROLES } from "@/lib/permissions";
import { isHeadOffice, mayEditRuleFor, mayManageRouting } from "@/lib/enquiry-routing";
import type { FormState } from "@/lib/form-state";

const PAGE = "/settings/enquiries";

const ruleShape = z.object({
  ruleId: z.string().optional().transform((v) => v || null),
  name: z.string().trim().min(2, "Name the rule").max(80),
  orgId: z.string().optional().transform((v) => v || null),
  source: z.enum(schema.enquirySource.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  pathway: z.enum(schema.pathway.enumValues).optional().or(z.literal("")).transform((v) => v || null),
  method: z.enum(["ROUND_ROBIN", "PERSON"]),
  assignToId: z.string().optional().transform((v) => v || null),
  priority: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 100))
    .refine((v) => Number.isInteger(v) && v >= 1 && v <= 999, "A whole number from 1 to 999"),
  active: z.string().optional(),
});

/**
 * Adding or changing a routing rule. A branch head's rules are always their
 * own branch's, whatever the form sends; only the head office sets a rule for
 * every branch. A rule naming a person names somebody active at that branch.
 */
export async function saveRoutingRuleAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!mayManageRouting(user)) return { error: "Only the head office and branch heads set routing rules." };
  const parsed = ruleShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const orgId = isHeadOffice(user) ? d.orgId : user.orgId;
  if (!mayEditRuleFor(user, orgId)) return { error: "You can set rules for your own branch only." };
  if (orgId) {
    const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, orgId), columns: { id: true } });
    if (!org) return { fieldErrors: { orgId: ["Pick a branch"] }, error: "That branch could not be found." };
  }

  let assignToId: string | null = null;
  if (d.method === "PERSON") {
    if (!orgId) return { fieldErrors: { orgId: ["Pick the branch the person works at"] }, error: "A rule that names a person is for that person's branch. Pick the branch." };
    if (!d.assignToId) return { fieldErrors: { assignToId: ["Pick who gets these"] }, error: "Pick the person these enquiries go to." };
    const person = await db.query.users.findFirst({
      where: and(eq(schema.users.id, d.assignToId), eq(schema.users.orgId, orgId), eq(schema.users.active, true), inArray(schema.users.role, [...PARTNER_ROLES])),
      columns: { id: true },
    });
    if (!person) return { fieldErrors: { assignToId: ["Somebody active at that branch"] }, error: "Pick somebody active at that branch." };
    assignToId = person.id;
  }

  const values = {
    name: d.name,
    orgId,
    source: d.source,
    pathway: d.pathway,
    method: d.method,
    assignToId,
    priority: d.priority,
    active: d.active === "on",
    updatedAt: new Date(),
  };
  if (d.ruleId) {
    const existing = await db.query.enquiryRoutingRules.findFirst({ where: eq(schema.enquiryRoutingRules.id, d.ruleId) });
    if (!existing || !mayEditRuleFor(user, existing.orgId)) return { error: "That rule could not be found." };
    await db.update(schema.enquiryRoutingRules).set(values).where(eq(schema.enquiryRoutingRules.id, d.ruleId));
    await audit(user.id, "routing.update", "routing_rule", d.ruleId, { ...values, updatedAt: undefined, before: { ...existing, createdAt: undefined, updatedAt: undefined } });
  } else {
    const [row] = await db.insert(schema.enquiryRoutingRules).values({ ...values, createdById: user.id }).returning({ id: schema.enquiryRoutingRules.id });
    await audit(user.id, "routing.create", "routing_rule", row.id, { ...values, updatedAt: undefined });
  }
  revalidatePath(PAGE);
  return { ok: "Rule saved.", redirectTo: PAGE };
}

export async function deleteRoutingRuleAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("ruleId") ?? "");
  const existing = await db.query.enquiryRoutingRules.findFirst({ where: eq(schema.enquiryRoutingRules.id, id) });
  if (!existing || !mayEditRuleFor(user, existing.orgId)) return;
  await db.delete(schema.enquiryRoutingRules).where(eq(schema.enquiryRoutingRules.id, id));
  await audit(user.id, "routing.delete", "routing_rule", id, { name: existing.name, orgId: existing.orgId, method: existing.method, assignToId: existing.assignToId });
  revalidatePath(PAGE);
}

// ---------- Lost reasons ----------

const reasonShape = z.object({
  reasonId: z.string().optional().transform((v) => v || null),
  label: z.string().trim().min(2, "Name the reason").max(60),
  sortOrder: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 100))
    .refine((v) => Number.isInteger(v) && v >= 0 && v <= 9999, "A whole number"),
});

/** Adding a reason to the list, or renaming one. The head office keeps the list. */
export async function saveLostReasonAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!isHeadOffice(user)) return { error: "The head office keeps the lost reasons list." };
  const parsed = reasonShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const clash = await db.query.lostReasons.findFirst({
    where: and(sql`lower(${schema.lostReasons.label}) = ${d.label.toLowerCase()}`, d.reasonId ? ne(schema.lostReasons.id, d.reasonId) : undefined),
  });
  if (clash) return { fieldErrors: { label: ["Already on the list"] }, error: `"${clash.label}" is already on the list.` };
  if (d.reasonId) {
    const before = await db.query.lostReasons.findFirst({ where: eq(schema.lostReasons.id, d.reasonId) });
    if (!before) return { error: "That reason could not be found." };
    await db.update(schema.lostReasons).set({ label: d.label, sortOrder: d.sortOrder }).where(eq(schema.lostReasons.id, d.reasonId));
    await audit(user.id, "lost_reason.update", "lost_reason", d.reasonId, { from: before.label, to: d.label, sortOrder: d.sortOrder });
  } else {
    const [row] = await db.insert(schema.lostReasons).values({ label: d.label, sortOrder: d.sortOrder, createdById: user.id }).returning({ id: schema.lostReasons.id });
    await audit(user.id, "lost_reason.create", "lost_reason", row.id, { label: d.label });
  }
  revalidatePath(PAGE);
  return { ok: "Saved.", redirectTo: PAGE };
}

/** A reason is switched off rather than removed, so the enquiries that carry it still read. */
export async function toggleLostReasonAction(formData: FormData) {
  const user = await requireUser();
  if (!isHeadOffice(user)) return;
  const id = String(formData.get("reasonId") ?? "");
  const reason = await db.query.lostReasons.findFirst({ where: eq(schema.lostReasons.id, id) });
  if (!reason) return;
  await db.update(schema.lostReasons).set({ active: !reason.active }).where(eq(schema.lostReasons.id, id));
  await audit(user.id, reason.active ? "lost_reason.off" : "lost_reason.on", "lost_reason", id, { label: reason.label });
  revalidatePath(PAGE);
}
