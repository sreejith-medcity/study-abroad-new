"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ADMIN_ROLES } from "@/lib/permissions";
import { CODE_RE, isColour, PAYABLE_ON, tidyCode } from "@/lib/vendors";
import type { FormState } from "@/lib/form-state";

const optional = (max = 200) => z.string().trim().max(max).optional().transform((x) => x || null);

const vendorSchema = z.object({
  name: z.string().trim().min(2, "Name the vendor").max(120),
  code: z.string().trim().transform(tidyCode).refine((v) => CODE_RE.test(v), "Two to four letters, such as KC"),
  colour: z.string().refine(isColour, "Pick a colour from the list"),
  isDirect: z.string().optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "A three-letter currency, such as GBP"),
  payableOn: z.enum(Object.keys(PAYABLE_ON) as [keyof typeof PAYABLE_ON, ...(keyof typeof PAYABLE_ON)[]]),
  daysToPay: z.coerce.number().int().min(0, "Days cannot be negative").max(365, "A year at most"),
  contactName: optional(120),
  contactEmail: z.string().trim().toLowerCase().max(160).optional().transform((x) => x || null).refine((x) => x === null || z.string().email().safeParse(x).success, "Enter a valid email"),
  contactPhone: optional(30),
  portalUrl: z.string().trim().max(300).optional().transform((x) => x || null).refine((x) => x === null || /^https?:\/\//.test(x), "A full link, starting https://"),
  billingName: optional(160),
  billingAddress: z.string().trim().max(400).optional().transform((x) => x || null),
  gstin: optional(20),
  notes: z.string().trim().max(500).optional().transform((x) => x || null),
});

/** Adds a vendor, or changes one. The code and the colour are what the screens read. */
export async function saveVendorAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("vendorId") ?? "");
  const parsed = vendorSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const values = {
    name: d.name,
    code: d.code,
    colour: d.colour,
    isDirect: fd.get("isDirect") === "on",
    currency: d.currency,
    payableOn: d.payableOn,
    daysToPay: d.daysToPay,
    contactName: d.contactName,
    contactEmail: d.contactEmail,
    contactPhone: d.contactPhone,
    portalUrl: d.portalUrl,
    billingName: d.billingName,
    billingAddress: d.billingAddress,
    gstin: d.gstin,
    notes: d.notes,
    updatedAt: new Date(),
  };
  const clashName = await db.query.vendors.findFirst({ where: and(eq(schema.vendors.name, d.name), id ? ne(schema.vendors.id, id) : undefined) });
  if (clashName) return { fieldErrors: { name: ["Already used by another vendor"] }, error: "Check the highlighted fields." };
  const clashCode = await db.query.vendors.findFirst({ where: and(eq(schema.vendors.code, d.code), id ? ne(schema.vendors.id, id) : undefined) });
  if (clashCode) return { fieldErrors: { code: ["Already used by another vendor"] }, error: "Check the highlighted fields." };

  if (id) {
    await db.update(schema.vendors).set(values).where(eq(schema.vendors.id, id));
    await audit(user.id, "vendor.update", "vendor", id, values);
  } else {
    const [made] = await db.insert(schema.vendors).values(values).returning({ id: schema.vendors.id });
    await audit(user.id, "vendor.create", "vendor", made.id, values);
  }
  revalidatePath("/admin/vendors");
  return { ok: id ? `${d.name} saved.` : `${d.name} added. Courses reach it through their routes.` };
}

/** Pausing a vendor takes its routes out of search without losing what was recorded. */
export async function setVendorActiveAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("vendorId") ?? "");
  const active = fd.get("active") === "1";
  const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, id) });
  if (!vendor) return;
  await db.update(schema.vendors).set({ active, updatedAt: new Date() }).where(eq(schema.vendors.id, id));
  await audit(user.id, active ? "vendor.activate" : "vendor.pause", "vendor", id, { name: vendor.name });
  revalidatePath("/admin/vendors");
}

/** "I have checked these terms against their sheet today." */
export async function confirmVendorTermsAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("vendorId") ?? "");
  await db.update(schema.vendors).set({ termsConfirmedAt: new Date(), termsConfirmedById: user.id, updatedAt: new Date() }).where(eq(schema.vendors.id, id));
  await audit(user.id, "vendor.terms_confirmed", "vendor", id, {});
  revalidatePath("/admin/vendors");
}

const routeSchema = z.object({
  programId: z.string().min(1),
  vendorId: z.string().min(1, "Choose a vendor"),
  basis: z.enum(["PERCENT_TUITION", "FLAT"]),
  percentOfTuition: z.string().optional(),
  flatAmount: z.string().optional(),
  currency: z.string().trim().toUpperCase().optional(),
  payableOn: z.string().optional(),
  daysToPay: z.string().optional(),
  applicationFee: z.string().optional(),
  offerTatDays: z.string().optional(),
  vendorCourseCode: optional(60),
  extraDocuments: z.string().trim().max(400).optional().transform((x) => x || null),
});

const numberOrNull = (v: string | undefined, errors: Record<string, string[]>, field: string, opts: { int?: boolean; min?: number; max?: number } = {}) => {
  const t = (v ?? "").trim();
  if (!t) return null;
  const n = Number(t);
  if (Number.isNaN(n) || (opts.int && !Number.isInteger(n)) || (opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) {
    errors[field] = ["Enter a number" + (opts.max != null ? ` between ${opts.min ?? 0} and ${opts.max}` : "")];
    return null;
  }
  return n;
};

/** Adds or changes one road to one course. */
export async function saveRouteAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser([...ADMIN_ROLES]);
  const parsed = routeSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const errors: Record<string, string[]> = {};
  const percent = numberOrNull(d.percentOfTuition, errors, "percentOfTuition", { min: 0, max: 100 });
  const flat = numberOrNull(d.flatAmount, errors, "flatAmount", { int: true, min: 0 });
  const daysToPay = numberOrNull(d.daysToPay, errors, "daysToPay", { int: true, min: 0, max: 365 });
  const applicationFee = numberOrNull(d.applicationFee, errors, "applicationFee", { int: true, min: 0 });
  const offerTatDays = numberOrNull(d.offerTatDays, errors, "offerTatDays", { int: true, min: 0, max: 365 });
  if (d.basis === "PERCENT_TUITION" && percent == null && !errors.percentOfTuition) errors.percentOfTuition = ["Give the rate, or record the route with a flat fee instead"];
  if (d.basis === "FLAT" && flat == null && !errors.flatAmount) errors.flatAmount = ["Give the fee"];
  if (d.basis === "FLAT" && flat != null && !/^[A-Z]{3}$/.test(d.currency ?? "")) errors.currency = ["A three-letter currency, such as GBP"];
  const payableOn = d.payableOn && d.payableOn in PAYABLE_ON ? (d.payableOn as keyof typeof PAYABLE_ON) : null;
  if (Object.keys(errors).length) return { fieldErrors: errors, error: "Check the highlighted fields." };

  const program = await db.query.programs.findFirst({ where: eq(schema.programs.id, d.programId) });
  const vendor = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, d.vendorId) });
  if (!program || !vendor) return { error: "That course or vendor no longer exists." };

  const values = {
    programId: d.programId,
    vendorId: d.vendorId,
    basis: d.basis,
    percentOfTuition: d.basis === "PERCENT_TUITION" ? percent : null,
    flatAmount: d.basis === "FLAT" ? flat : null,
    currency: d.basis === "FLAT" ? (d.currency ?? null) : null,
    payableOn,
    daysToPay,
    applicationFee,
    offerTatDays,
    vendorCourseCode: d.vendorCourseCode,
    extraDocuments: d.extraDocuments,
    interviewRequired: fd.get("interviewRequired") === "on",
    active: fd.get("active") !== "off",
    confirmedAt: new Date(),
    confirmedById: user.id,
    updatedAt: new Date(),
  };
  await db
    .insert(schema.programRoutes)
    .values(values)
    .onConflictDoUpdate({ target: [schema.programRoutes.programId, schema.programRoutes.vendorId], set: values });
  await audit(user.id, "route.save", "program", d.programId, { vendor: vendor.name, basis: d.basis, percent, flat });
  revalidatePath(`/programs/${d.programId}`);
  revalidatePath(`/admin/programs/${d.programId}`);
  return { ok: `${vendor.name} recorded as a route to ${program.name}.` };
}

/** Takes one road out of use without losing what it paid. */
export async function setRouteActiveAction(fd: FormData) {
  const user = await requireUser([...ADMIN_ROLES]);
  const id = String(fd.get("routeId") ?? "");
  const active = fd.get("active") === "1";
  const route = await db.query.programRoutes.findFirst({ where: eq(schema.programRoutes.id, id) });
  if (!route) return;
  await db.update(schema.programRoutes).set({ active, updatedAt: new Date() }).where(eq(schema.programRoutes.id, id));
  await audit(user.id, active ? "route.activate" : "route.pause", "program", route.programId, { routeId: id });
  revalidatePath(`/programs/${route.programId}`);
  revalidatePath(`/admin/programs/${route.programId}`);
}
