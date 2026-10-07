"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { APP_ROLES } from "@/lib/permissions";
import { can } from "@/server/capabilities";
import { audit } from "@/lib/audit";
import { GSTIN_RE, IFSC_RE, MAX_BILLING_COMPANIES, PAN_RE, gstinMatchesPan } from "@/lib/billing";
import type { FormState } from "@/lib/form-state";

const upper = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");
const company = z
  .object({
    legalName: z.string().trim().min(2, "Enter the company's legal name").max(160),
    address: z.string().trim().min(5, "Enter the registered address").max(400),
    state: z.string().trim().min(2, "Enter the state").max(60),
    pan: z.string().transform(upper).refine((v) => PAN_RE.test(v), "A PAN is five letters, four digits and a letter"),
    gstin: z.string().optional().transform((v) => (v ? upper(v) : null)).refine((v) => v === null || GSTIN_RE.test(v), "A GSTIN is 15 characters, like 32ABCDE1234F1Z5"),
    lutNumber: z.string().trim().max(40).optional().transform((v) => v || null),
    lutValidUntil: z.string().optional().transform((v) => v || null).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a date"),
    bankAccountName: z.string().trim().min(2, "Enter the name on the account").max(160),
    bankAccountNumber: z.string().transform((v) => v.replace(/\s/g, "")).refine((v) => /^\d{9,18}$/.test(v), "An account number is 9 to 18 digits"),
    ifsc: z.string().transform(upper).refine((v) => IFSC_RE.test(v), "An IFSC is 11 characters, like SBIN0001234"),
  })
  .superRefine((c, ctx) => {
    if (c.gstin && !gstinMatchesPan(c.gstin, c.pan)) ctx.addIssue({ code: "custom", path: ["gstin"], message: "This GSTIN belongs to a different PAN" });
    if (c.lutNumber && !c.lutValidUntil) ctx.addIssue({ code: "custom", path: ["lutValidUntil"], message: "Enter the date the LUT runs to" });
  });

/**
 * Whose billing companies these are, and where the screen for them lives.
 *
 * A branch bills Medcity Overseas for its payouts; Medcity Overseas bills the
 * vendors. Both are the same record and the same form, so the question is only
 * which organisation the row belongs to: a branch owner's own, or the head
 * office's for whoever raises the invoices.
 */
async function billingScope(): Promise<{ user: SessionUser; orgId: string; back: string } | { error: string }> {
  const user = await requireUser([...APP_ROLES]);
  if (user.role === "PARTNER") return { user, orgId: user.orgId, back: "/settings/branch" };
  if (await can(user, "RAISE_INVOICES")) {
    const hq = await db.query.organizations.findFirst({ where: eq(schema.organizations.type, "HQ"), columns: { id: true } });
    if (!hq) return { error: "No head office organisation on record." };
    return { user, orgId: hq.id, back: "/admin/billing" };
  }
  return { error: "Only a branch owner, or whoever raises the invoices, can change a billing company." };
}

/** Adds a billing company, or updates one when an id is sent. */
export async function saveBillingCompanyAction(_: FormState, fd: FormData): Promise<FormState> {
  const scope = await billingScope();
  if ("error" in scope) return { error: scope.error };
  const { user, orgId, back } = scope;
  const id = String(fd.get("id") ?? "");
  const bc = schema.billingCompanies;
  const existing = id ? await db.query.billingCompanies.findFirst({ where: and(eq(bc.id, id), eq(bc.orgId, orgId)) }) : null;
  if (id && !existing) return { error: "That company is not on this organisation." };
  const input = Object.fromEntries(fd) as Record<string, string>;
  // On an edit, a blank account number keeps the one on file; it is never sent to the browser.
  if (existing && !String(input.bankAccountNumber ?? "").trim()) input.bankAccountNumber = existing.bankAccountNumber;
  const parsed = company.safeParse(input);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  if (id) {
    await db.update(bc).set(parsed.data).where(eq(bc.id, id));
    await audit(user.id, "billing_company.update", "billing_company", id, { legalName: parsed.data.legalName });
  } else {
    const [{ n }] = await db.select({ n: count() }).from(bc).where(eq(bc.orgId, orgId));
    if (n >= MAX_BILLING_COMPANIES) return { error: `Up to ${MAX_BILLING_COMPANIES} companies. Remove one first.` };
    const [row] = await db.insert(bc).values({ ...parsed.data, orgId, isDefault: n === 0 }).returning({ id: bc.id });
    await audit(user.id, "billing_company.create", "billing_company", row.id, { legalName: parsed.data.legalName });
  }
  revalidatePath(back);
  return { ok: id ? "Company updated." : "Company added.", redirectTo: back };
}

export async function setDefaultBillingCompanyAction(fd: FormData) {
  const scope = await billingScope();
  if ("error" in scope) return;
  const { user, orgId, back } = scope;
  const bc = schema.billingCompanies;
  const id = String(fd.get("id") ?? "");
  const row = await db.query.billingCompanies.findFirst({ where: and(eq(bc.id, id), eq(bc.orgId, orgId)) });
  if (!row) return;
  await db.transaction(async (tx) => {
    await tx.update(bc).set({ isDefault: false }).where(and(eq(bc.orgId, orgId), ne(bc.id, id)));
    await tx.update(bc).set({ isDefault: true }).where(eq(bc.id, id));
  });
  await audit(user.id, "billing_company.default", "billing_company", id, {});
  revalidatePath(back);
}

export async function deleteBillingCompanyAction(_: FormState, fd: FormData): Promise<FormState> {
  const scope = await billingScope();
  if ("error" in scope) return { error: scope.error };
  const { user, orgId, back } = scope;
  const bc = schema.billingCompanies;
  const id = String(fd.get("id") ?? "");
  const row = await db.query.billingCompanies.findFirst({ where: and(eq(bc.id, id), eq(bc.orgId, orgId)) });
  if (!row) return { error: "That company is not on this organisation." };
  const [{ used }] = await db.select({ used: count() }).from(schema.payoutRequests).where(eq(schema.payoutRequests.billingCompanyId, id));
  if (used > 0) return { error: `${row.legalName} is on ${used} payout${used === 1 ? "" : "s"}, so it stays for the record. Edit its details instead.` };
  // An invoice already raised from it is the same argument, and the stronger one.
  const [{ raised }] = await db.select({ raised: count() }).from(schema.vendorInvoices).where(eq(schema.vendorInvoices.billingCompanyId, id));
  if (raised > 0) return { error: `${row.legalName} has raised ${raised} invoice${raised === 1 ? "" : "s"}, so it stays for the record. Edit its details instead.` };
  await db.delete(bc).where(eq(bc.id, id));
  // Keep one default while any company is left.
  if (row.isDefault) {
    const next = await db.query.billingCompanies.findFirst({ where: eq(bc.orgId, orgId) });
    if (next) await db.update(bc).set({ isDefault: true }).where(eq(bc.id, next.id));
  }
  await audit(user.id, "billing_company.delete", "billing_company", id, { legalName: row.legalName });
  revalidatePath(back);
  return { ok: `${row.legalName} removed.` };
}

/** Owner's switch: may counsellors see commission figures, the commission pages and the wallet? */
export async function setCounsellorCommissionAction(fd: FormData) {
  const user = await requireUser(["PARTNER"]);
  const on = fd.get("on") === "1";
  await db.update(schema.organizations).set({ counsellorsSeeCommission: on }).where(eq(schema.organizations.id, user.orgId));
  await audit(user.id, "org.counsellor_commission", "organization", user.orgId, { on });
  revalidatePath("/", "layout");
}
