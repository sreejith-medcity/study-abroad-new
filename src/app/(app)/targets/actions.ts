"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { FormState } from "@/lib/form-state";
import { copyLastMonth, isMonth, saveTargets, type Metric } from "@/server/targets";

/** Every box on the form is "t:<subject>:<metric>"; an empty one clears that target. */
export async function saveTargetsAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = String(formData.get("month") ?? "");
  if (!isMonth(month)) return { error: "Pick a month." };
  const entries: { subject: string; metric: Metric; value: number | null }[] = [];
  const bad: Record<string, string[]> = {};
  for (const [key, raw] of formData.entries()) {
    const m = key.match(/^t:((?:org|user):[^:]+):(REGISTRATIONS|APPLICATIONS|VISAS)$/);
    if (!m) continue;
    const text = String(raw).trim();
    if (text === "") {
      entries.push({ subject: m[1], metric: m[2] as Metric, value: null });
      continue;
    }
    const value = Number(text);
    if (!Number.isInteger(value) || value < 0 || value > 100000) {
      bad[key] = ["A whole number"];
      continue;
    }
    entries.push({ subject: m[1], metric: m[2] as Metric, value });
  }
  if (Object.keys(bad).length) return { fieldErrors: bad, error: "A target is a whole number of students, applications or visas." };
  const saved = await saveTargets(user, month, entries);
  if (!saved.ok) return { error: saved.error };
  await audit(user.id, "targets.save", "targets", month, { set: entries.filter((e) => e.value != null).length });
  revalidatePath("/targets");
  revalidatePath("/dashboard");
  return { ok: "Targets saved." };
}

export async function copyTargetsAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const month = String(formData.get("month") ?? "");
  if (!isMonth(month)) return { error: "Pick a month." };
  const subjects = String(formData.get("subjects") ?? "").split(",").filter(Boolean);
  const done = await copyLastMonth(user, month, subjects);
  if (!done.ok) return { error: done.error };
  await audit(user.id, "targets.copy", "targets", month, { copied: done.copied });
  revalidatePath("/targets");
  revalidatePath("/dashboard");
  return { ok: done.copied ? `Copied ${done.copied} ${done.copied === 1 ? "target" : "targets"} from last month.` : "Nothing to copy: last month had no targets that are not already set." };
}

