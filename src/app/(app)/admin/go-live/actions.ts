"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canManageSettings } from "@/lib/permissions";
import { clearDemoData } from "@/server/go-live";
import type { FormState } from "@/lib/form-state";
export type { FormState };

/**
 * Deliberately awkward: a super admin only, and only after typing the word out.
 * There is no undo, so the confirmation is the safety, not a dialog.
 */
export async function clearDemoDataAction(_: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!canManageSettings(user)) return { error: "Only a super admin can clear the sample data." };
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "REMOVE") {
    return { error: "Type REMOVE to confirm.", fieldErrors: { confirm: ["Type REMOVE"] } };
  }

  try {
    const result = await clearDemoData(user.id);
    await audit(user.id, "platform.go_live", "settings", "app", result);
    revalidatePath("/", "layout");
    return {
      keep: true,
      ok:
        `Sample data removed. ${result.removedAccounts} accounts gone. ` +
        `The portal now holds ${result.organisations} organisation${result.organisations === 1 ? "" : "s"}, ` +
        `${result.accounts} account${result.accounts === 1 ? "" : "s"}, ${result.students} students and ${result.applications} applications.`,
    };
  } catch (error) {
    // The whole thing is one transaction, so nothing was removed.
    return {
      error:
        "Nothing was removed. " +
        (error instanceof Error ? error.message : "The database refused the change.") +
        " This usually means a sample account is attached to a real record, which is worth looking at before trying again.",
    };
  }
}
