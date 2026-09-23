"use server";

import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { APP_ROLES } from "@/lib/permissions";
import { parseBrief, type Brief } from "@/lib/brief";
import { LEVELS, QUICK } from "@/server/program-search";
import { destinationCounts, studyFields } from "@/server/finder";
import { aiAllowance, aiConfig, callClaude, recordAiUsage, replyText } from "@/server/ai";

export type BriefRead = Brief & { byAi: boolean; left: number | null };

const AE_NUMBERS = ["ae_ielts", "ae_pte", "ae_toefl", "ae_duolingo", "ae_gre", "ae_gmat", "ae_12", "ae_ug", "ae_backlogs", "ae_gap", "budget"];

/**
 * Reads a counsellor's description of a student into the finder's filters.
 *
 * The rules-based reader runs first and always: it is what works without an
 * AI key, and it is the one that reads scores and marks, where a wrong figure
 * would matter. The AI, when it is switched on, is asked only to pick from
 * lists the portal itself supplies, and it may fill in what the reader left
 * empty; it never overwrites a figure and never invents one.
 */
export async function readBriefAction(text: string): Promise<BriefRead> {
  const user = await requireUser([...APP_ROLES]);
  const input = String(text ?? "").slice(0, 2000);
  const [countries, fields] = await Promise.all([destinationCounts(), studyFields()]);
  const vocab = { countries: countries.map((c) => ({ code: c.code, name: c.name })), fields: fields.map((f) => f.field) };
  const base = parseBrief(input, vocab);
  if (!input.trim()) return { ...base, byAi: false, left: null };

  const cfg = await aiConfig();
  if (!cfg?.enabled || !cfg.features.assistant) return { ...base, byAi: false, left: null };
  const allowance = await aiAllowance(user, cfg);
  if (allowance.left <= 0) return { ...base, byAi: false, left: 0, notes: [...base.notes, `Your branch has used this month's ${allowance.limit} AI requests, so the description was read by the portal's own rules.`] };

  const system = `You turn an education counsellor's description of a student into filters for a program catalogue.
Answer with JSON only, no other words: an object whose keys come from this list and nothing else.
- country: one or more of ${vocab.countries.map((c) => `${c.code} (${c.name})`).join(", ")}, comma separated.
- level: one of ${LEVELS.map(([k]) => k).join(", ")}.
- season: one or more of spring, summer, fall, comma separated.
- field: exactly one of ${vocab.fields.join(" | ") || "(none available)"}.
- ${QUICK.map((q) => q.key).join(", ")}: "1" when the description asks for it.
Rules: leave a key out when the description does not say. Never include a test score, a mark, a budget or any other number. Never invent a destination or a field that is not in the lists above.`;

  try {
    const reply = await callClaude(cfg, { system, messages: [{ role: "user", content: input }], maxTokens: 300 });
    await recordAiUsage(user, "assistant", reply.usage);
    const parsed = safeJson(replyText(reply));
    const params = { ...base.params };
    const read = [...base.read];
    for (const [k, v] of Object.entries(parsed)) {
      if (AE_NUMBERS.includes(k)) continue;
      const clean = clamp(k, String(v), vocab);
      if (!clean || params[k]) continue;
      params[k] = clean;
      read.push(label(k, clean, vocab));
    }
    if (params.level === "VOCATIONAL") params.pathway = "AUSBILDUNG";
    if (params.level === "REGISTRATION") params.pathway = "NURSING";
    return { params, read, notes: base.notes, byAi: true, left: allowance.limit == null ? null : allowance.left - 1 };
  } catch (e) {
    await audit(user.id, "ai.error", "ai", "finder", { message: (e as Error).message });
    return { ...base, byAi: false, left: null, notes: [...base.notes, "The AI service could not be reached, so the description was read by the portal's own rules."] };
  }
}

function safeJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Keeps only values the portal itself offers, whatever the model answered. */
function clamp(key: string, value: string, vocab: { countries: { code: string; name: string }[]; fields: string[] }): string | null {
  const parts = value.split(",").map((x) => x.trim()).filter(Boolean);
  if (key === "country") {
    const codes = parts.map((x) => x.toUpperCase()).filter((x) => vocab.countries.some((c) => c.code === x));
    return codes.length ? [...new Set(codes)].join(",") : null;
  }
  if (key === "level") return LEVELS.some(([k]) => k === parts[0]) ? parts[0] : null;
  if (key === "season") {
    const seasons = parts.map((x) => x.toLowerCase()).filter((x) => ["spring", "summer", "fall"].includes(x));
    return seasons.length ? [...new Set(seasons)].join(",") : null;
  }
  if (key === "field") return vocab.fields.find((f) => f.toLowerCase() === value.trim().toLowerCase()) ?? null;
  if (QUICK.some((q) => q.key === key)) return value === "1" || value === "true" ? "1" : null;
  return null;
}

function label(key: string, value: string, vocab: { countries: { code: string; name: string }[] }) {
  if (key === "country") return value.split(",").map((code) => vocab.countries.find((c) => c.code === code)?.name ?? code).join(" or ");
  if (key === "level") return LEVELS.find(([k]) => k === value)?.[1] ?? value;
  if (key === "season") return `${value.split(",").join(" or ")} intake`;
  if (key === "field") return value;
  return QUICK.find((q) => q.key === key)?.label.toLowerCase() ?? value;
}
