"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { answerJournal } from "@/server/journal";

/** Somebody answers today's journal: verified, or flagged with what is wrong. */
export async function answerJournalAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const verdict = formData.get("verdict") === "FLAGGED" ? "FLAGGED" : "VERIFIED";
  const note = String(formData.get("note") ?? "").slice(0, 1000);
  const result = await answerJournal(user, verdict, note || null);
  if (!result.ok) return { error: result.error };
  await audit(user.id, verdict === "FLAGGED" ? "journal.flag" : "journal.verify", "user", user.id, verdict === "FLAGGED" ? { note } : undefined);
  revalidatePath("/", "layout");
  return { ok: verdict === "FLAGGED" ? "Flagged. The Overseas admin will see what you wrote." : "Verified. Thank you, and see you tomorrow." };
}
