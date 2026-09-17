"use client";

import { ActionForm } from "@/components/action-form";
import { SelectField, TextField, TextareaField } from "@/components/fields";
import { Button, Select, Input } from "@/components/ui";
import { accrueMissingAction, adjustWalletAction, decidePayoutAction, moveCommissionAction, saveRuleAction } from "./actions";

type Option = { id: string; name: string };

export function RuleForm({
  countries,
  universities,
  values,
}: {
  countries: Option[];
  universities: Option[];
  values?: {
    id: string;
    name: string;
    countryId: string | null;
    universityId: string | null;
    intakeYear: number | null;
    basis: string;
    percentOfTuition: number | null;
    flatAmount: number | null;
    currency: string;
    partnerSharePercent: number;
    notes: string | null;
  };
}) {
  const now = new Date().getFullYear();
  return (
    <ActionForm action={saveRuleAction} submitLabel={values ? "Save rule" : "Add rule"} pendingLabel="Saving…" resetOnSuccess={!values}>
      {values && <input type="hidden" name="ruleId" value={values.id} />}
      <TextField label="Rule name" name="name" required defaultValue={values?.name} placeholder="UK universities, 2027 intakes" />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Country" name="countryId" defaultValue={values?.countryId ?? ""} hint="Leave empty if the rule is for one university">
          <option value="">Any country</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </SelectField>
        <SelectField label="University" name="universityId" defaultValue={values?.universityId ?? ""} hint="Beats a country rule">
          <option value="">Any university</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </SelectField>
        <SelectField label="Basis" name="basis" defaultValue={values?.basis ?? "PERCENT_TUITION"}>
          <option value="PERCENT_TUITION">Percentage of first year tuition</option>
          <option value="FLAT">Flat amount per placement</option>
        </SelectField>
        <TextField label="Intake year" name="intakeYear" type="number" min="2020" max="2100" defaultValue={values?.intakeYear ?? ""} hint={`Leave empty for every intake (now ${now})`} />
        <TextField label="Percentage" name="percentOfTuition" type="number" step="0.5" min="0" max="100" defaultValue={values?.percentOfTuition ?? ""} hint="Used when the basis is a percentage" />
        <TextField label="Flat amount" name="flatAmount" type="number" min="0" defaultValue={values?.flatAmount ?? ""} hint="Used when the basis is a flat amount" />
        <TextField label="Currency" name="currency" required maxLength={3} defaultValue={values?.currency ?? "INR"} hint="Three letters, for example GBP" />
        <TextField label="Partner share (%)" name="partnerSharePercent" type="number" step="1" min="0" max="100" required defaultValue={values?.partnerSharePercent ?? 50} />
      </div>
      <TextareaField label="Notes" name="notes" rows={2} defaultValue={values?.notes ?? ""} />
    </ActionForm>
  );
}

const NEXT: Record<string, { value: string; label: string }[]> = {
  EXPECTED: [
    { value: "INVOICED", label: "Mark invoiced" },
    { value: "WRITTEN_OFF", label: "Write off" },
  ],
  INVOICED: [
    { value: "RECEIVED", label: "Mark received" },
    { value: "WRITTEN_OFF", label: "Write off" },
  ],
  RECEIVED: [
    { value: "SETTLED", label: "Pay the partner" },
    { value: "WRITTEN_OFF", label: "Write off" },
  ],
  SETTLED: [],
  WRITTEN_OFF: [{ value: "EXPECTED", label: "Reopen" }],
};

export function MoveCommissionForm({
  commissionId,
  status,
  suggestedInr,
}: {
  commissionId: string;
  status: string;
  suggestedInr: number | null;
}) {
  const options = NEXT[status] ?? [];
  if (options.length === 0) return null;
  return (
    <ActionForm action={moveCommissionAction} hideSubmit className="space-y-2">
      <input type="hidden" name="commissionId" value={commissionId} />
      <div className="flex items-center gap-1.5">
        <Select name="status" aria-label="Move to" className="w-36 py-1.5 text-[13px]">
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Input name="invoiceRef" placeholder="Ref" aria-label="Reference" className="w-24 py-1.5 text-[13px]" />
        {(status === "RECEIVED" || status === "INVOICED") && (
          <Input
            name="partnerAmountInr"
            type="number"
            min="0"
            placeholder="Share in rupees"
            aria-label="Partner share in rupees"
            defaultValue={suggestedInr ?? ""}
            className="w-28 py-1.5 text-[13px]"
          />
        )}
        <Button type="submit" variant="secondary" size="sm">Apply</Button>
      </div>
    </ActionForm>
  );
}

export function AccrueForm() {
  return (
    <ActionForm action={accrueMissingAction} submitLabel="Find missing commissions" pendingLabel="Scanning…" submitVariant="secondary">
      <p className="text-[13px] text-muted">
        Scans every placement that reached a visa or enrolment and adds the commission where a rule matches and none exists yet.
      </p>
    </ActionForm>
  );
}

export function AdjustWalletForm({ orgs }: { orgs: Option[] }) {
  return (
    <ActionForm action={adjustWalletAction} submitLabel="Post to wallet" pendingLabel="Posting…" resetOnSuccess>
      <SelectField label="Partner" name="orgId" required>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </SelectField>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Kind" name="kind" defaultValue="BONUS">
          <option value="BONUS">Bonus</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </SelectField>
        <TextField label="Amount (rupees)" name="amountInr" type="number" required hint="Negative to take money back" />
      </div>
      <TextField label="Note" name="note" required placeholder="Tier bonus for the September intake" />
    </ActionForm>
  );
}

export function DecidePayoutForm({ payoutId, status }: { payoutId: string; status: string }) {
  const options =
    status === "REQUESTED"
      ? [
          { value: "APPROVED", label: "Approve" },
          { value: "PAID", label: "Mark paid" },
          { value: "REJECTED", label: "Decline" },
        ]
      : status === "APPROVED"
        ? [
            { value: "PAID", label: "Mark paid" },
            { value: "REJECTED", label: "Decline" },
          ]
        : [];
  if (options.length === 0) return null;
  return (
    <ActionForm action={decidePayoutAction} hideSubmit className="space-y-2">
      <input type="hidden" name="payoutId" value={payoutId} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Select name="decision" aria-label="Decision" className="w-32 py-1.5 text-[13px]">
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
        <Input name="reference" placeholder="UTR or cheque" aria-label="Reference" className="w-36 py-1.5 text-[13px]" />
        <Button type="submit" variant="secondary" size="sm">Apply</Button>
      </div>
    </ActionForm>
  );
}
