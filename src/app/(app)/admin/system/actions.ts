"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { isSuperAdmin } from "@/lib/permissions";
import { CRON_JOBS } from "@/server/cron-runs";
import { isCronJob, runCronJob } from "@/server/cron-jobs";
import { resultText } from "@/lib/system-report";
import type { FormState } from "@/lib/form-state";
export type { FormState };

/**
 * Run now: one scheduled job, this minute, by the super admin. It goes through
 * the same runner the /api/cron routes use, so the run is recorded exactly as a
 * scheduled one would be, marked as started by hand and by whom.
 */
export async function runJobNowAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!isSuperAdmin(user)) return { error: "Only a super admin can run a scheduled job by hand." };
  const job = String(formData.get("job") ?? "");
  if (!isCronJob(job)) return { error: "That is not one of the scheduled jobs." };

  const run = await runCronJob(job, { via: "manual", actorId: user.id });
  revalidatePath("/admin/system");
  if (!run.ok) return { error: `${CRON_JOBS[job].label} failed: ${run.error}` };
  const outcome = resultText(run.result);
  return { ok: `${CRON_JOBS[job].label} ran in ${run.ms} ms${outcome ? `: ${outcome}` : ""}.` };
}
