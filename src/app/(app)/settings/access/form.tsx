"use client";

import { ActionForm } from "@/components/action-form";
import { setCapabilityAction } from "./actions";

/** One box in the table. Submitting it sets the opposite of what is shown. */
export function CapabilityToggle({ role, capability, allowed }: { role: string; capability: string; allowed: boolean }) {
  return (
    <ActionForm action={setCapabilityAction} submitLabel={allowed ? "Allowed" : "Not allowed"} submitVariant={allowed ? "primary" : "secondary"}>
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="capability" value={capability} />
      <input type="hidden" name="allowed" value={allowed ? "0" : "1"} />
    </ActionForm>
  );
}
