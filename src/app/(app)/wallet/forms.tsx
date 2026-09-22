"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Button } from "@/components/ui";
import { cancelPayoutAction, requestPayoutAction } from "./actions";

export function PayoutForm({ balance, companies }: { balance: number; companies: { id: string; label: string; isDefault: boolean }[] }) {
  return (
    <ActionForm action={requestPayoutAction} submitLabel="Request payout" pendingLabel="Sending…" resetOnSuccess>
      {companies.length > 0 && (
        <SelectField label="Pay to" name="billingCompanyId" defaultValue={companies.find((c) => c.isDefault)?.id ?? companies[0].id} required>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </SelectField>
      )}
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
