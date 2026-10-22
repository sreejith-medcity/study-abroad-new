"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import { importRankingsAction, saveLivingFundsAction } from "./actions";
import { saveServiceChargeCountryAction } from "@/server/ausbildung-actions";

export function LivingFundsForm({ countryId, currency, amount, note, source }: { countryId: string; currency: string; amount: number | null; note: string | null; source: string | null }) {
  return (
    <ActionForm action={saveLivingFundsAction} submitLabel="Save" submitVariant="secondary">
      <input type="hidden" name="countryId" value={countryId} />
      <div className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)]">
        <Field label={`First year (${currency})`} htmlFor={`lf-a-${countryId}`}>
          <Input id={`lf-a-${countryId}`} name="amount" inputMode="numeric" defaultValue={amount ?? ""} />
          <FieldError name="amount" />
        </Field>
        <Field label="Government page" htmlFor={`lf-s-${countryId}`}>
          <Input id={`lf-s-${countryId}`} name="source" defaultValue={source ?? ""} placeholder="https://" />
          <FieldError name="source" />
        </Field>
      </div>
      <Field label="As the government words it" htmlFor={`lf-n-${countryId}`}>
        <Input id={`lf-n-${countryId}`} name="note" defaultValue={note ?? ""} />
      </Field>
    </ActionForm>
  );
}

export function RankingsImportForm() {
  return (
    <ActionForm action={importRankingsAction} submitLabel="Save rankings">
      <Field label="CSV file" htmlFor="rk-file">
        <input id="rk-file" type="file" name="file" accept=".csv,text/csv" className="text-xs" />
      </Field>
      <Field label="Or paste rows" htmlFor="rk-csv" hint="university, country_code, qs_rank, qs_year, the_rank, the_year. Ranks as published: 154, =154 or 601-650.">
        <Textarea id="rk-csv" name="csv" rows={4} className="font-mono text-xs" defaultValue={"university,country_code,qs_rank,qs_year,the_rank,the_year\n"} />
      </Field>
    </ActionForm>
  );
}

/**
 * One destination's service charge: whether Medcity collects one for it, and
 * the usual figure. A tick and a number, saved together.
 */
export function ServiceChargeForm({ countryId, name, on, amount }: { countryId: string; name: string; on: boolean; amount: number | null }) {
  return (
    <ActionForm action={saveServiceChargeCountryAction} submitLabel="Save" submitVariant="secondary" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="countryId" value={countryId} />
      <label className="flex min-w-40 flex-1 items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="collects" value="1" defaultChecked={on} className="size-4 rounded border-line-strong accent-brand-600" aria-label={`${name} collects a service charge`} />
        {name}
      </label>
      <Field label="Usual charge (₹)" htmlFor={`sc-${countryId}`}>
        <Input id={`sc-${countryId}`} name="serviceChargeInr" inputMode="numeric" defaultValue={amount ?? ""} placeholder="Not recorded" className="w-36" />
        <FieldError name="serviceChargeInr" />
      </Field>
    </ActionForm>
  );
}
