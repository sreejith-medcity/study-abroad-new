"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Button } from "@/components/ui";
import { answerJournalAction } from "./actions";

/**
 * Verify the day, or say what is wrong with it. One or the other, once.
 * Flagging asks for a reason, because "something is wrong" with nothing
 * after it is not something anybody can look into.
 */
export function AnswerJournal({ count }: { count: number }) {
  return (
    <ActionForm action={answerJournalAction} hideSubmit pendingLabel="Saving…">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" name="verdict" value="VERIFIED" data-verify>
          I have checked these {count} {count === 1 ? "line" : "lines"}: verified
        </Button>
      </div>
      <details className="rounded-lg border border-line bg-surface-2/60 px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-ink">Something here is wrong</summary>
        <div className="mt-2 space-y-2">
          <label htmlFor="journal-note" className="block text-xs text-muted">
            Say what is wrong: a line that is not yours, something missing, a mistake you made and how it was put right.
          </label>
          <textarea id="journal-note" name="note" rows={3} maxLength={1000} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm" />
          <FieldError name="note" />
          <Button type="submit" name="verdict" value="FLAGGED" variant="secondary" data-flag>
            Flag my journal
          </Button>
        </div>
      </details>
    </ActionForm>
  );
}
