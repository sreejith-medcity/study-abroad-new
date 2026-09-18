"use server";

import { revalidatePath } from "next/cache";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { hashPassword, issueSession, requireUser, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isLocale } from "@/lib/i18n";
import { canManageSettings, isPartner, isSuperAdmin } from "@/lib/permissions";
import { getSettings } from "@/server/settings";
import { UploadError, deleteUpload, saveBrandImage } from "@/server/storage";
import { passwordProblem } from "@/lib/password";

import type { FormState } from "@/lib/form-state";
export type { FormState };

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

/* ---------------- Personal ---------------- */

const profileShape = z.object({
  name: z.string().trim().min(2, "Your name is required").max(120),
  phone: optional(20),
  deskLabel: optional(60),
  locale: z.string().optional(),
});

export async function saveProfileAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = profileShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  await db
    .update(schema.users)
    .set({
      name: d.name,
      phone: d.phone,
      // Only Medcity Overseas staff carry a desk label; a partner's is set by the team.
      ...(isPartner(user) ? {} : { deskLabel: d.deskLabel }),
      ...(isLocale(d.locale) ? { locale: d.locale } : {}),
    })
    .where(eq(schema.users.id, user.id));
  await audit(user.id, "user.profile", "user", user.id, {});
  revalidatePath("/settings");
  return { ok: "Saved." };
}

const passwordShape = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(1, "Enter a new password"),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "The two passwords do not match", path: ["confirmPassword"] });

export async function changeOwnPasswordAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = passwordShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  const problem = passwordProblem(d.newPassword, [user.email, user.name]);
  if (problem) return { error: problem, fieldErrors: { newPassword: [problem] } };

  const row = await db.query.users.findFirst({ where: eq(schema.users.id, user.id) });
  if (!row || !(await verifyPassword(d.currentPassword, row.passwordHash))) {
    return { error: "Your current password is not right.", fieldErrors: { currentPassword: ["Incorrect"] } };
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(d.newPassword), mustChangePassword: false, passwordUpdatedAt: new Date() })
    .where(eq(schema.users.id, user.id));
  await audit(user.id, "user.password_change", "user", user.id, {});
  revalidatePath("/settings/security");
  return { ok: "Password changed." };
}

/**
 * Ends every other signed-in session for this account. Bumping the stored version
 * strands every token that carries an older one, so this browser is handed a fresh
 * token straight away and keeps working.
 */
export async function signOutEverywhereAction(): Promise<FormState> {
  const user = await requireUser();
  const [row] = await db
    .update(schema.users)
    .set({ sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, user.id))
    .returning({ sessionVersion: schema.users.sessionVersion });
  await issueSession(user.id, row?.sessionVersion);
  await audit(user.id, "user.sessions_revoked", "user", user.id, {});
  revalidatePath("/settings/security");
  return { ok: "Every other device has been signed out. This one stays signed in." };
}

/* ---------------- Branch ---------------- */

const branchShape = z.object({
  city: optional(80),
  addressLine: optional(200),
  contactPhone: optional(20),
  contactEmail: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")).transform((v) => v || null),
});

export async function saveBranchAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(["PARTNER"]);
  const parsed = branchShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };

  await db.update(schema.organizations).set(parsed.data).where(eq(schema.organizations.id, user.orgId));
  await audit(user.id, "organization.update", "organization", user.orgId, { via: "settings" });
  revalidatePath("/settings/branch");
  return { ok: "Saved." };
}

/* ---------------- Platform ---------------- */

const int = (min: number, max: number, message: string) =>
  z
    .string()
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v) && v >= min && v <= max, message);

const platformShape = z.object({
  portalName: z.string().trim().min(2, "The portal needs a name").max(60),
  organisationName: z.string().trim().min(2, "The organisation needs a name").max(120),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #c01f53"),
  deepColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #631a33"),
  accentColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #f7ec22"),
  infoColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #0466af"),
  signInHeadline: z.string().trim().min(5, "Write a line for the sign-in page").max(160),
  signInPoints: z.string().optional().transform((v) => (v ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 5)),
  slaNewDays: int(1, 90, "Between 1 and 90 days"),
  slaPendingPartnerDays: int(1, 90, "Between 1 and 90 days"),
  slaInProgressDays: int(1, 180, "Between 1 and 180 days"),
  slaOfferDays: int(1, 180, "Between 1 and 180 days"),
  slaHoldDays: int(1, 365, "Between 1 and 365 days"),
  tierSilver: int(1, 5000, "A whole number"),
  tierGold: int(1, 5000, "A whole number"),
  tierElite: int(1, 5000, "A whole number"),
  tierPlatinum: int(1, 5000, "A whole number"),
  followUpDays: int(0, 30, "Between 0 and 30 days"),
  enquiryStaleDays: int(1, 365, "Between 1 and 365 days"),
  fxRates: z.string().optional(),
  supportEmail: z.string().trim().toLowerCase().email("Enter a valid email").optional().or(z.literal("")).transform((v) => v || null),
  supportPhone: optional(20),
  supportHours: optional(80),
});

export async function savePlatformAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canManageSettings(user)) return { error: "Only a super admin can change platform settings." };
  const parsed = platformShape.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;

  // "GBP 112" or "GBP:112" per line, so the box is forgiving.
  const rates: Record<string, number> = {};
  for (const line of (d.fxRates ?? "").split("\n")) {
    const match = line.trim().match(/^([A-Za-z]{3})\s*[:=\s]\s*([\d.]+)$/);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isNaN(value) && value > 0) rates[match[1].toUpperCase()] = value;
  }

  await db
    .update(schema.appSettings)
    .set({
      portalName: d.portalName,
      organisationName: d.organisationName,
      brandColor: d.brandColor.toLowerCase(),
      deepColor: d.deepColor.toLowerCase(),
      accentColor: d.accentColor.toLowerCase(),
      infoColor: d.infoColor.toLowerCase(),
      signInHeadline: d.signInHeadline,
      signInPoints: d.signInPoints,
      slaNewDays: d.slaNewDays,
      slaPendingPartnerDays: d.slaPendingPartnerDays,
      slaInProgressDays: d.slaInProgressDays,
      slaOfferDays: d.slaOfferDays,
      slaHoldDays: d.slaHoldDays,
      tierTargets: { SILVER: d.tierSilver, GOLD: d.tierGold, ELITE: d.tierElite, PLATINUM: d.tierPlatinum },
      followUpDays: d.followUpDays,
      enquiryStaleDays: d.enquiryStaleDays,
      ...(Object.keys(rates).length > 0 ? { fxRates: rates } : {}),
      supportEmail: d.supportEmail,
      supportPhone: d.supportPhone,
      supportHours: d.supportHours,
      updatedById: user.id,
      updatedAt: new Date(),
    })
    .where(eq(schema.appSettings.id, "app"));

  await audit(user.id, "settings.update", "settings", "app", {
    portalName: d.portalName,
    brandColor: d.brandColor,
    sla: { NEW: d.slaNewDays, PENDING_PARTNER: d.slaPendingPartnerDays, IN_PROGRESS: d.slaInProgressDays, OFFER: d.slaOfferDays },
  });
  // Settings shape every screen, so refresh the whole app shell.
  revalidatePath("/", "layout");
  return { ok: isSuperAdmin(user) ? "Saved. Every screen follows these from now on." : "Saved." };
}

/* ---------------- Brand artwork ---------------- */

/**
 * Replaces the logo or the favicon. The previous file is removed once the new
 * one is recorded, so the bucket does not fill up with every attempt.
 */
export async function uploadBrandImageAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canManageSettings(user)) return { error: "Only a super admin can change the artwork." };

  const kind = String(formData.get("kind"));
  if (kind !== "logo" && kind !== "favicon") return { error: "Unknown artwork." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file first.", fieldErrors: { file: ["Required"] } };

  const settings = await getSettings();
  const previous = kind === "logo" ? settings.logoKey : settings.faviconKey;

  let saved;
  try {
    saved = await saveBrandImage(file, kind);
  } catch (error) {
    return { error: error instanceof UploadError ? error.message : "That file could not be saved." };
  }

  await db
    .update(schema.appSettings)
    .set(
      kind === "logo"
        ? { logoKey: saved.storageKey, logoMimeType: saved.mimeType, updatedById: user.id, updatedAt: new Date() }
        : { faviconKey: saved.storageKey, faviconMimeType: saved.mimeType, updatedById: user.id, updatedAt: new Date() },
    )
    .where(eq(schema.appSettings.id, "app"));

  if (previous) await deleteUpload(previous).catch(() => {});
  await audit(user.id, "settings.artwork", "settings", "app", { kind, mimeType: saved.mimeType, bytes: saved.sizeBytes });
  revalidatePath("/", "layout");
  return { ok: kind === "logo" ? "Logo updated." : "Favicon updated." };
}

/** Puts the drawn mark back. */
export async function clearBrandImageAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canManageSettings(user)) return { error: "Only a super admin can change the artwork." };
  const kind = String(formData.get("kind"));
  if (kind !== "logo" && kind !== "favicon") return { error: "Unknown artwork." };

  const settings = await getSettings();
  const previous = kind === "logo" ? settings.logoKey : settings.faviconKey;

  await db
    .update(schema.appSettings)
    .set(
      kind === "logo"
        ? { logoKey: null, logoMimeType: null, updatedById: user.id, updatedAt: new Date() }
        : { faviconKey: null, faviconMimeType: null, updatedById: user.id, updatedAt: new Date() },
    )
    .where(eq(schema.appSettings.id, "app"));

  if (previous) await deleteUpload(previous).catch(() => {});
  await audit(user.id, "settings.artwork", "settings", "app", { kind, cleared: true });
  revalidatePath("/", "layout");
  return { ok: kind === "logo" ? "Logo removed. The drawn mark is back." : "Favicon removed." };
}
