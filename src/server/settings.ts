import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AppSettings } from "@/db/schema";

const DEFAULT_POINTS = [
  "Register students and apply to universities, Ausbildung and nursing routes in one place",
  "See exactly what each application is waiting on, and who has it",
  "Talk to the Medcity Overseas team and to students on one thread",
];

/**
 * What the portal falls back to when the settings row cannot be read: during the
 * short window between a deploy and its migration, or a database hiccup. Every
 * screen reads settings, so failing here would take the whole portal down over
 * what are only defaults.
 */
const FALLBACK: AppSettings = {
  id: "app",
  portalName: "Medcity Overseas",
  organisationName: "Medcity International Overseas Corporation",
  brandColor: "#c01f53",
  deepColor: "#631a33",
  accentColor: "#f7ec22",
  infoColor: "#0466af",
  logoKey: null,
  logoMimeType: null,
  faviconKey: null,
  faviconMimeType: null,
  signInHeadline: "The workspace behind every Medcity student going abroad.",
  signInPoints: DEFAULT_POINTS,
  slaNewDays: 2,
  slaPendingPartnerDays: 5,
  slaInProgressDays: 7,
  slaOfferDays: 10,
  slaHoldDays: 60,
  tierTargets: { SILVER: 10, GOLD: 20, ELITE: 50, PLATINUM: 50 },
  followUpDays: 1,
  enquiryStaleDays: 30,
  fxRates: { GBP: 112, EUR: 96, AUD: 58, CAD: 62, USD: 88 },
  supportEmail: null,
  supportPhone: null,
  supportHours: null,
  updatedById: null,
  updatedAt: new Date(0),
};

/**
 * The single settings row, created on first read so a fresh install works
 * without a seed. Cached per request: a page that reads settings five times
 * still hits the database once.
 */
export const getSettings = cache(async (): Promise<AppSettings> => {
  try {
    const existing = await db.query.appSettings.findFirst({ where: eq(schema.appSettings.id, "app") });
    if (existing) return existing;
    const [created] = await db
      .insert(schema.appSettings)
      .values({ id: "app", signInPoints: DEFAULT_POINTS })
      .onConflictDoNothing()
      .returning();
    return created ?? (await db.query.appSettings.findFirst({ where: eq(schema.appSettings.id, "app") })) ?? FALLBACK;
  } catch (error) {
    console.error("[settings] falling back to defaults:", error instanceof Error ? error.message : error);
    return FALLBACK;
  }
});

/** Service levels per lane, in days, as the work queue and dashboards read them. */
export function slaDays(settings: AppSettings): Record<string, number> {
  return {
    NEW: settings.slaNewDays,
    PENDING_PARTNER: settings.slaPendingPartnerDays,
    IN_PROGRESS: settings.slaInProgressDays,
    OFFER: settings.slaOfferDays,
    HOLD: settings.slaHoldDays,
    SUCCESS: 9999,
    CLOSED: 9999,
  };
}

export type TierTargets = Record<"SILVER" | "GOLD" | "ELITE" | "PLATINUM", number>;

export function tierTargets(settings: AppSettings): TierTargets {
  const raw = (settings.tierTargets ?? {}) as Partial<TierTargets>;
  return {
    SILVER: Number(raw.SILVER ?? 10),
    GOLD: Number(raw.GOLD ?? 20),
    ELITE: Number(raw.ELITE ?? 50),
    PLATINUM: Number(raw.PLATINUM ?? 50),
  };
}

export function fxRates(settings: AppSettings): Record<string, number> {
  const raw = (settings.fxRates ?? {}) as Record<string, unknown>;
  const out: Record<string, number> = { INR: 1 };
  for (const [code, value] of Object.entries(raw)) {
    const rate = Number(value);
    if (!Number.isNaN(rate) && rate > 0) out[code.toUpperCase()] = rate;
  }
  return out;
}

/**
 * Brand colours as CSS custom properties. The palette is derived from one
 * colour with color-mix, so a branch of the brand ramp never has to be hand
 * picked, and the whole portal follows whatever is set here.
 */
export function brandStyle(settings: AppSettings) {
  const brand = settings.brandColor;
  const accent = settings.accentColor;
  const deep = settings.deepColor;
  const info = settings.infoColor;
  // Mirrors the hand-picked ramp in globals.css, so a portal left on the Medcity
  // colours looks the same whether it reads the stylesheet or these overrides.
  return `:root{
    --color-brand-50: color-mix(in oklab, ${brand} 7%, white);
    --color-brand-100: color-mix(in oklab, ${brand} 15%, white);
    --color-brand-200: color-mix(in oklab, ${brand} 28%, white);
    --color-brand-300: color-mix(in oklab, ${brand} 46%, white);
    --color-brand-400: color-mix(in oklab, ${brand} 72%, white);
    --color-brand-500: color-mix(in oklab, ${brand} 90%, white);
    --color-brand-600: ${brand};
    --color-brand-700: color-mix(in oklab, ${brand} 55%, ${deep});
    --color-brand-800: color-mix(in oklab, ${brand} 25%, ${deep});
    --color-brand-900: ${deep};
    --color-gold-300: color-mix(in oklab, ${accent} 62%, white);
    --color-gold-400: ${accent};
    --color-gold-500: color-mix(in oklab, ${accent} 78%, black);
    --color-info-50: color-mix(in oklab, ${info} 9%, white);
    --color-info-500: ${info};
    --color-info-700: color-mix(in oklab, ${info} 72%, black);
  }`;
}

export function signInPoints(settings: AppSettings) {
  return settings.signInPoints.length > 0 ? settings.signInPoints : DEFAULT_POINTS;
}
