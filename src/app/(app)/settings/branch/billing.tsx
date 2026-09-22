"use client";

import { ActionForm } from "@/components/action-form";
import { TextField, TextareaField } from "@/components/fields";
import { deleteBillingCompanyAction, saveBillingCompanyAction } from "@/server/billing";

export type BillingValues = {
  id: string;
  legalName: string;
  address: string;
  state: string;
  pan: string;
  gstin: string | null;
  lutNumber: string | null;
  lutValidUntil: string | null;
  bankAccountName: string;
  ifsc: string;
  maskedAccount: string;
};

/** Add a company, or edit one. The account number is never sent back to the browser; left blank on an edit, it stays as it is. */
export function BillingCompanyForm({ values }: { values?: BillingValues }) {
  const v = values;
  const f = (k: string) => `bc-${v?.id ?? "new"}-${k}`;
  return (
    <ActionForm action={saveBillingCompanyAction} submitLabel={v ? "Save company" : "Add company"} pendingLabel="Saving…" resetOnSuccess={!v}>
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={f("name")} label="Legal name" name="legalName" defaultValue={v?.legalName} required />
        <TextField id={f("state")} label="State" name="state" defaultValue={v?.state} required hint="Decides whether GST is IGST or CGST and SGST" />
        <div className="sm:col-span-2">
          <TextareaField id={f("address")} label="Registered address" name="address" rows={2} defaultValue={v?.address} required />
        </div>
        <TextField id={f("pan")} label="PAN" name="pan" defaultValue={v?.pan} required placeholder="ABCDE1234F" />
        <TextField id={f("gstin")} label="GSTIN" name="gstin" defaultValue={v?.gstin ?? ""} hint="Leave blank if not registered for GST" />
        <TextField id={f("lut")} label="LUT number" name="lutNumber" defaultValue={v?.lutNumber ?? ""} hint="Letter of undertaking, if you have one" />
        <TextField id={f("lutdate")} label="LUT valid until" name="lutValidUntil" type="date" defaultValue={v?.lutValidUntil ?? ""} />
        <TextField id={f("acname")} label="Name on the bank account" name="bankAccountName" defaultValue={v?.bankAccountName} required />
        <TextField id={f("acno")} label="Account number" name="bankAccountNumber" inputMode="numeric" required={!v} autoComplete="off" hint={v ? `Leave blank to keep ${v.maskedAccount}` : undefined} />
        <TextField id={f("ifsc")} label="IFSC" name="ifsc" defaultValue={v?.ifsc} required placeholder="SBIN0001234" />
      </div>
    </ActionForm>
  );
}

export function RemoveBillingCompany({ id, name }: { id: string; name: string }) {
  return (
    <ActionForm action={deleteBillingCompanyAction} submitLabel={`Remove ${name}`} pendingLabel="Removing…" submitVariant="secondary">
      <input type="hidden" name="id" value={id} />
    </ActionForm>
  );
}
