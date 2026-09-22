"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { canManageSettings } from "@/lib/permissions";
import { seal } from "@/lib/secret-box";

const quota = z.coerce.number().int().min(0).max(100000);
const shape = z.object({
  apiKey: z.string().trim().max(300).refine((v) => v === "" || /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(v), "An Anthropic key starts sk-ant-"),
  model: z.string().trim().regex(/^claude-[a-z0-9.-]{3,60}$/, "A Claude model id, such as claude-sonnet-4-5"),
  enabled: z.string().optional().transform((v) => v === "on"),
  assistant: z.string().optional().transform((v) => v === "on"),
  interview: z.string().optional().transform((v) => v === "on"),
  autofill: z.string().optional().transform((v) => v === "on"),
  SILVER: quota,
  GOLD: quota,
  ELITE: quota,
  PLATINUM: quota,
});

/** The owner's AI switch, key, model, features and monthly allowances. A blank key box keeps the key on file. */
export async function saveAiSettingsAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canManageSettings(user)) return { error: "Only the platform owner can change AI settings." };
  const parsed = shape.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, error: "Check the highlighted fields." };
  const d = parsed.data;
  const current = await db.query.aiSettings.findFirst({ where: eq(schema.aiSettings.id, "app") });
  const apiKeyEnc = d.apiKey ? seal(d.apiKey, "anthropic-key") : (current?.apiKeyEnc ?? null);
  if (d.enabled && !apiKeyEnc && !process.env.ANTHROPIC_API_KEY) return { fieldErrors: { apiKey: ["Enter the key before switching AI on"] }, error: "Check the highlighted fields." };
  const set = {
    enabled: d.enabled,
    apiKeyEnc,
    model: d.model,
    assistant: d.assistant,
    interview: d.interview,
    autofill: d.autofill,
    monthlyQuota: { SILVER: d.SILVER, GOLD: d.GOLD, ELITE: d.ELITE, PLATINUM: d.PLATINUM },
    updatedById: user.id,
    updatedAt: new Date(),
  };
  await db.insert(schema.aiSettings).values({ id: "app", ...set }).onConflictDoUpdate({ target: schema.aiSettings.id, set });
  await audit(user.id, "settings.ai", "settings", "ai", { enabled: d.enabled, model: d.model, keyChanged: !!d.apiKey, features: { assistant: d.assistant, interview: d.interview, autofill: d.autofill } });
  revalidatePath("/settings/platform");
  return { ok: d.enabled ? "Saved. AI features are on." : "Saved. AI features are off." };
}
