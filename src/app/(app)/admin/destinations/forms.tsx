"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import { importRankingsAction, saveLivingFundsAction } from "./actions";

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
