"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button } from "@/components/ui";
import { groupInr } from "@/lib/format";
import { bulkOutcomeText } from "@/lib/publish-rules";
import { bulkStatusAction, type BulkStatusState } from "./actions";

/** Publish and back-to-draft for a whole filter, saying so while a large batch runs. */
function BulkStatusButtons({ total }: { total: number }) {
  const { pending, data } = useFormStatus();
  const doing = pending ? data?.get("to") : null;
  return (
    <>
      <Button name="to" value="LIVE" size="sm" variant="secondary" disabled={pending}>
        {doing === "LIVE" ? `Publishing ${groupInr(total)}…` : "Publish"}
      </Button>
      <Button name="to" value="DRAFT" size="sm" variant="quiet" disabled={pending}>
        {doing === "DRAFT" ? "Moving back…" : "Back to draft"}
      </Button>
    </>
  );
}

/**
 * The status buttons that act on every program the filters match, and the
 * answer to the last press. The answer is worded here from the counts the
 * action returns, so nothing the page shows comes from the address bar.
 *
 * The page keeps this mounted even when the filter is left empty (publishing
 * every draft a "Draft" filter matches empties it), so the answer survives
 * the page refreshing behind it.
 */
export function BulkStatusForm({ filters, exportHref, total }: { filters: Record<string, string>; exportHref: string; total: number }) {
  const [state, action] = useActionState<BulkStatusState, FormData>(bulkStatusAction, {});
  const o = state.outcome;
  const held = o ? o.leftDrafts + o.leftArchived + o.unreached : 0;
  const tone = state.error ? "bad" : !o ? "info" : held ? "warn" : o.done ? "ok" : "info";
  return (
    <div className="flex flex-col items-end gap-2">
      {total > 0 && (
        <form action={action} className="flex flex-wrap items-center gap-2">
          {Object.entries(filters).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <a href={exportHref} className="mr-2 text-sm font-medium text-brand-600 hover:underline">
            Export CSV
          </a>
          <span className="text-sm text-muted">All {total} matching:</span>
          <BulkStatusButtons total={total} />
        </form>
      )}
      {(o || state.error) && (
        <div
          className="w-full max-w-xl"
          data-bulk-result
          data-answer={state.at}
          data-to={o?.to ?? ""}
          data-done={o?.done ?? 0}
          data-left-drafts={o?.leftDrafts ?? 0}
          data-no-intakes={o?.noIntakes ?? 0}
          data-no-evidence={o?.noEvidence ?? 0}
        >
          <Alert tone={tone}>{state.error ?? (o ? bulkOutcomeText(o) : "")}</Alert>
        </div>
      )}
    </div>
  );
}
