"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, type FormEvent } from "react";
import { Alert, Button, Checkbox, Field } from "@/components/ui";
import type { FormState } from "@/lib/form-state";
import { syncCricosAction } from "./actions";

/**
 * Its own small form rather than ActionForm: the result is a report worth
 * keeping on screen, and the list behind it is refreshed from here once the
 * report has arrived. Asking the server action to revalidate the page it was
 * called from is what left long imports looking stuck.
 */
export function CricosForm({ lastSync }: { lastSync: string | null }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<FormState, FormData>(syncCricosAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-[13px] leading-relaxed text-muted">
        Every course Australia registers for international students, from the government&apos;s CRICOS register on data.gov.au:
        provider, campus, level, field, duration and whole-course tuition. Entry requirements and intakes are not in the register, so
        they stay blank. Safe to run again: courses update by their CRICOS code and anything added by hand is kept.
      </p>
      {lastSync && <p className="text-xs text-muted">Last sync: {lastSync}</p>}
      {state.error && <Alert tone="bad">{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.ok}</Alert>}
      <Checkbox name="publish" label="Publish new courses straight away (otherwise they land as drafts)" />
      <details className="text-[13px]">
        <summary className="cursor-pointer font-medium text-brand-600">Server cannot reach data.gov.au? Upload the files</summary>
        <div className="mt-2 space-y-2">
          <Field label="CRICOS Institutions.csv" htmlFor="cr-inst"><input id="cr-inst" type="file" name="institutions" accept=".csv" className="text-xs" /></Field>
          <Field label="CRICOS Courses.csv" htmlFor="cr-courses"><input id="cr-courses" type="file" name="courses" accept=".csv" className="text-xs" /></Field>
          <Field label="CRICOS Course Locations.csv" htmlFor="cr-loc"><input id="cr-loc" type="file" name="locations" accept=".csv" className="text-xs" /></Field>
        </div>
      </details>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Syncing, about a minute…" : "Sync from CRICOS"}</Button>
    </form>
  );
}
