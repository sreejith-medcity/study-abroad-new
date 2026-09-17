"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { Alert, Button, Chip, Textarea } from "@/components/ui";
import { MONTHS } from "@/lib/format";
import { importProgramsAction, type ImportState } from "./actions";

const TEMPLATE = `program,university,city,country_code,pathway,level,study_area,duration_months,tuition_per_year,application_fee,initial_deposit,intakes,min_ielts,min_pte,min_oet_grade,min_german_level,max_backlogs,max_gap_years,moi_accepted,required_docs,status
MSc Public Health,University of Westbridge,Leeds,GB,DEGREE,PG,Health,12,17800,0,2000,Jan|Sep,6.5,58,,,5,4,no,PASSPORT|MARKSHEET_12|DEGREE_MARKSHEETS|ENGLISH_TEST|SOP,LIVE`;

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importProgramsAction, {});
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    startTransition(() => action(fd));
  }
  return (
    <div className="space-y-3">
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="csv-file" className="font-medium">CSV file</label>
          <input id="csv-file" type="file" name="file" accept=".csv,text/csv" className="text-xs" />
        </div>
        <details>
          <summary className="cursor-pointer text-brand-600">Or paste CSV (template)</summary>
          <label htmlFor="csv-text" className="sr-only">CSV text</label>
          <Textarea id="csv-text" name="csv" rows={5} className="mt-2 font-mono text-xs" defaultValue={TEMPLATE} />
          <p className="mt-1 text-xs text-muted">Intakes: month names or numbers separated by |. Required docs: document codes separated by |. Existing programs with the same name and university are updated.</p>
        </details>
        <div className="flex gap-2">
          <Button type="submit" name="mode" value="preview" variant="secondary" disabled={pending}>{pending ? "Checking…" : "Preview import"}</Button>
          {state.preview && state.preview.valid > 0 && (
            <Button type="submit" name="mode" value="commit" disabled={pending}>Import {state.preview.valid} rows</Button>
          )}
        </div>
      </form>

      {state.preview && (
        <div className="rounded-md border border-line p-3">
          <p className="mb-2">
            <Chip tone="ok">{state.preview.valid} ready</Chip> {state.preview.errors.length > 0 && <Chip tone="bad">{state.preview.errors.length} with errors</Chip>}
          </p>
          {state.preview.errors.length > 0 && (
            <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto text-xs text-red-700">
              {state.preview.errors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
            </ul>
          )}
          <ul className="space-y-1 text-xs">
            {state.preview.sample.map((r) => (
              <li key={r.line}>Line {r.line}: <span className="font-medium">{r.program}</span> · {r.university} ({r.countryCode}) · {r.level} · {r.intakeMonths.map((m) => MONTHS[m - 1]).join(", ")}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
