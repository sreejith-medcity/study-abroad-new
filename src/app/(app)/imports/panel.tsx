"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { Alert, Button, Chip } from "@/components/ui";
import { runImportAction, type ImportState } from "@/server/imports/actions";

/** Choose a file, preview what it would do, then import. */
export function ImportPanel({ kind }: { kind: string }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(runImportAction, {});
  const mine = state.kind === kind ? state : {};
  const r = mine.result;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    startTransition(() => action(fd));
  };
  const willChange = r ? r.created + r.updated : 0;
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-3">
        <input type="hidden" name="kind" value={kind} />
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`file-${kind}`} className="font-medium">CSV or Excel file</label>
          <input id={`file-${kind}`} type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="text-xs" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="mode" value="preview" variant="secondary" disabled={pending}>
            {pending ? "Working…" : "Check the file"}
          </Button>
          {r && !mine.committed && willChange > 0 && (
            <Button type="submit" name="mode" value="commit" disabled={pending}>
              Import {willChange.toLocaleString("en-IN")} row{willChange === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </form>
      {mine.error && <Alert tone="bad">{mine.error}</Alert>}
      {r && (
        <div className="rounded-md border border-line p-3 text-[13px]" data-testid="import-result">
          {mine.committed ? (
            <p className="mb-2 font-medium text-emerald-700">Imported from {mine.fileName}.</p>
          ) : (
            <p className="mb-2 text-muted">Checked {mine.fileName}. Nothing is saved until you press Import.</p>
          )}
          <p className="mb-2 flex flex-wrap gap-1.5">
            {r.created > 0 && <Chip tone="ok">{r.created} new</Chip>}
            {r.updated > 0 && <Chip tone="info">{r.updated} to update</Chip>}
            {r.unchanged > 0 && <Chip>{r.unchanged} already up to date</Chip>}
            {r.skipped > 0 && <Chip tone="warn">{r.skipped} left as they are</Chip>}
            {r.errors.length > 0 && <Chip tone="bad">{r.errors.length} with problems</Chip>}
          </p>
          {r.sample.length > 0 && (
            <ul className="mb-2 space-y-0.5 text-xs text-ink-soft">
              {r.sample.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          {r.errors.length > 0 && (
            <>
              <p className="text-xs text-muted">Rows with problems are left out. Fix them in the file and upload it again; rows already imported are then up to date.</p>
              <ul className="mt-1 max-h-60 space-y-0.5 overflow-y-auto text-xs text-red-700">
                {r.errors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
              </ul>
            </>
          )}
          {r.notes.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs text-amber-800">
              {r.notes.map((e, i) => <li key={i}>{e.line > 1 ? `Line ${e.line}: ` : ""}{e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
