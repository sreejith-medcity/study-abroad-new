"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Checkbox, Field, Select } from "@/components/ui";
import type { FormState } from "@/lib/form-state";
import { BARRED, REGISTRY_SOURCES } from "@/lib/registry";
import { syncRegistryAction } from "./actions";

/**
 * Its own form rather than ActionForm, for the same reason as the CRICOS card:
 * the report is worth leaving on screen, and the list behind it is refreshed
 * from here once the report has arrived.
 *
 * The check runs first by design. A register's columns move, and finding that
 * out from a report is cheaper than finding it out from the catalogue.
 */
export function RegistryForm() {
  const router = useRouter();
  const sources = Object.values(REGISTRY_SOURCES);
  const [key, setKey] = useState(sources[0]?.key ?? "");
  const [state, action, pending] = useActionState<FormState, FormData>(syncRegistryAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  const chosen = REGISTRY_SOURCES[key];

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-sm leading-relaxed text-muted">
        Institutions from a public register, so a counsellor can find a university that is not on the list yet. Nothing is renamed, nothing is deleted, and a
        city or website somebody has already checked is left alone.
      </p>
      {sources.length > 1 ? (
        <Field label="Register" htmlFor="reg-source">
          <Select id="reg-source" name="source" value={key} onChange={(e) => setKey(e.target.value)}>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="source" value={key} />
      )}
      {chosen && (
        <p className="text-sm leading-relaxed text-muted">
          {chosen.blurb} <span className="whitespace-nowrap">Licence: {chosen.licence}.</span>
        </p>
      )}
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <Checkbox name="apply" label="Write the changes (leave this off to check first and write nothing)" />
      <details className="text-sm">
        <summary className="cursor-pointer font-medium text-brand-600">Server cannot reach the register? Upload the file</summary>
        <div className="mt-2">
          <Field label="The register's CSV" htmlFor="reg-file">
            <input id="reg-file" type="file" name="file" accept=".csv,text/csv" className="text-xs" />
          </Field>
          {chosen && (
            <p className="mt-1 text-xs text-muted break-all">
              Download it from <span className="font-mono">{chosen.url}</span>
            </p>
          )}
        </div>
      </details>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Working, this can take a minute…" : "Run"}
      </Button>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Registers deliberately left out</summary>
        <ul className="mt-2 space-y-1 text-xs text-muted">
          {BARRED.map(([name, why]) => (
            <li key={name}>
              <span className="font-medium">{name}</span>: {why}.
            </li>
          ))}
        </ul>
      </details>
    </form>
  );
}
