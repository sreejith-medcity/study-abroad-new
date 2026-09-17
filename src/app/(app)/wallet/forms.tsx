"use client";

import { ActionForm } from "@/components/action-form";
import { TextField, TextareaField } from "@/components/fields";
import { Button } from "@/components/ui";
import { cancelPayoutAction, requestPayoutAction } from "./actions";

export function PayoutForm({ balance }: { balance: number }) {
  return (
    <ActionForm action={requestPayoutAction} submitLabel="Request payout" pendingLabel="Sending…" resetOnSuccess>
      <TextField
        label="Amount (rupees)"
        name="amountInr"
        type="number"
        min="1"
        max={String(balance)}
        required
        hint={balance > 0 ? `Up to ${new Intl.NumberFormat("en-IN").format(balance)}` : "Nothing available yet"}
        disabled={balance <= 0}
      />
      <TextareaField label="Note" name="note" rows={2} hint="Bank details change, invoice number, anything the team should know" />
    </ActionForm>
  );
}

export function CancelPayoutButton({ payoutId }: { payoutId: string }) {
  return (
    <form action={cancelPayoutAction}>
      <input type="hidden" name="payoutId" value={payoutId} />
      <Button type="submit" variant="quiet" size="sm">Withdraw the request</Button>
    </form>
  );
}
