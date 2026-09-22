"use client";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/fields";
import { savePaymentSettingsAction } from "@/server/payments";

export function PaymentSettingsForm({ keyId, secretSet, webhookSet, enabled, envKeys }: { keyId: string | null; secretSet: boolean; webhookSet: boolean; enabled: boolean; envKeys: boolean }) {
  return (
    <ActionForm action={savePaymentSettingsAction} submitLabel="Save payment settings" pendingLabel="Saving…">
      {envKeys ? (
        <p className="text-[13px] text-muted">The keys come from the server&apos;s environment (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET), so the boxes below are not used.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField id="rp-key" label="Key id" name="razorpayKeyId" defaultValue={keyId ?? ""} placeholder="rzp_live_…" autoComplete="off" />
          <TextField id="rp-secret" label="Key secret" name="keySecret" type="password" autoComplete="new-password" hint={secretSet ? "Set. Leave blank to keep it." : "Not set"} />
          <TextField id="rp-hook" label="Webhook secret" name="webhookSecret" type="password" autoComplete="new-password" hint={webhookSet ? "Set. Leave blank to keep it." : "Not set: payments are confirmed at checkout only"} />
        </div>
      )}
      {envKeys && <input type="hidden" name="razorpayKeyId" value="" />}
      {envKeys && <input type="hidden" name="keySecret" value="" />}
      {envKeys && <input type="hidden" name="webhookSecret" value="" />}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={enabled} className="size-4" /> Take application fees online
      </label>
    </ActionForm>
  );
}
