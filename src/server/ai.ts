import "server-only";
import { cache } from "react";
import { and, count, eq, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { isStaff } from "@/lib/permissions";
import { open } from "@/lib/secret-box";

export type AiFeature = "assistant" | "interview" | "autofill";
export type AiConfig = { key: string; model: string; enabled: boolean; features: Record<AiFeature, boolean>; quota: Record<string, number> };

/** The AI setup, or null when there is no key. ANTHROPIC_API_KEY wins over the stored key. */
export const aiConfig = cache(async (): Promise<AiConfig | null> => {
  const row = await db.query.aiSettings.findFirst({ where: eq(schema.aiSettings.id, "app") });
  const key = process.env.ANTHROPIC_API_KEY || (row?.apiKeyEnc ? open(row.apiKeyEnc, "anthropic-key") : null);
  if (!key) return null;
  return {
    key,
    model: row?.model ?? "claude-sonnet-4-5",
    enabled: row?.enabled ?? false,
    features: { assistant: row?.assistant ?? true, interview: row?.interview ?? true, autofill: row?.autofill ?? true },
    quota: row?.monthlyQuota ?? { SILVER: 100, GOLD: 250, ELITE: 500, PLATINUM: 1000 },
  };
});

/** Whether a feature is usable at all: a key, the main switch and the feature's own switch. */
export async function aiFeatureOn(feature: AiFeature) {
  const cfg = await aiConfig();
  return !!cfg && cfg.enabled && cfg.features[feature];
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

/** This month's allowance for the user's branch. The Overseas team is not counted against one. */
export async function aiAllowance(user: Pick<SessionUser, "orgId" | "role" | "orgType">, cfg: AiConfig) {
  const [{ used }] = await db.select({ used: count() }).from(schema.aiUsage).where(and(eq(schema.aiUsage.orgId, user.orgId), gte(schema.aiUsage.createdAt, monthStart())));
  if (isStaff(user as SessionUser)) return { used, limit: null as number | null, left: Infinity };
  const org = await db.query.organizations.findFirst({ where: eq(schema.organizations.id, user.orgId), columns: { tier: true } });
  const limit = cfg.quota[org?.tier ?? "SILVER"] ?? 0;
  return { used, limit, left: Math.max(0, limit - used) };
}

export async function recordAiUsage(user: Pick<SessionUser, "id" | "orgId">, feature: AiFeature, usage: { input_tokens?: number; output_tokens?: number } | undefined) {
  await db.insert(schema.aiUsage).values({ orgId: user.orgId, userId: user.id, feature, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 });
}

export type ClaudeContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };
export type ClaudeMessage = { role: "user" | "assistant"; content: string | ClaudeContent[] };
export type ClaudeTool = { name: string; description: string; input_schema: Record<string, unknown> };
export type ClaudeReply = { content: ClaudeContent[]; stop_reason: string; usage?: { input_tokens?: number; output_tokens?: number } };

const apiBase = () => (process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com").replace(/\/$/, "");

/** One call to the Messages API. Throws with the API's own message when it refuses. */
export async function callClaude(cfg: AiConfig, opts: { system: string; messages: ClaudeMessage[]; tools?: ClaudeTool[]; maxTokens?: number }): Promise<ClaudeReply> {
  const res = await fetch(`${apiBase()}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: cfg.model, max_tokens: opts.maxTokens ?? 1024, system: opts.system, messages: opts.messages, ...(opts.tools ? { tools: opts.tools } : {}) }),
    signal: AbortSignal.timeout(60000),
  });
  const body = (await res.json().catch(() => ({}))) as ClaudeReply & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `The AI service answered ${res.status}`);
  return body;
}

export const replyText = (r: ClaudeReply) => r.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("\n").trim();
