"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { FIGURE_KEYS, type FigureKey } from "@/lib/journal";
import { answerJournal } from "@/server/journal";

/**
 * Somebody answers today's day end report: verified, or flagged with what is
 * wrong, with the day's figures as typed. The figures go to the server as
 * text, so a blank box comes back as a message under that box rather than as
 * a silent 0.
 */
export async function answerJournalAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const verdict = formData.get("verdict") === "FLAGGED" ? "FLAGGED" : "VERIFIED";
  const note = String(formData.get("note") ?? "").slice(0, 1000);
  const typed = Object.fromEntries(FIGURE_KEYS.map((k) => [k, formData.has(k) ? String(formData.get(k) ?? "").slice(0, 20) : null])) as Record<FigureKey, string | null>;
  const result = await answerJournal(user, verdict, note || null, typed);
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  await audit(user.id, verdict === "FLAGGED" ? "journal.flag" : "journal.verify", "user", user.id, verdict === "FLAGGED" ? { note } : undefined);
  revalidatePath("/", "layout");
  return { ok: verdict === "FLAGGED" ? "Flagged. The Overseas admin will see what you wrote." : "Verified. Thank you, and see you tomorrow." };
}
