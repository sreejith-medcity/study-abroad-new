"use client";

import { ActionForm, FieldError } from "@/components/action-form";
import { Button } from "@/components/ui";
import { FIGURE_KEYS, FIGURE_LABEL, FIGURE_MAX, FIGURE_SOURCE, type DayEndFigures } from "@/lib/journal";
import { answerJournalAction } from "./actions";

/**
 * Verify the day, or say what is wrong with it. One or the other, once.
 * Flagging asks for a reason, because "something is wrong" with nothing
 * after it is not something anybody can look into.
 *
 * A counsellor is also handed the five figure boxes, each with what the portal
 * counted for the day typed in and where it came from said underneath; every
 * box has to hold a whole number before either button is accepted. Other
 * roles get no boxes, so `figures` is null for them.
 */
export function AnswerJournal({ count, figures }: { count: number; figures: DayEndFigures | null }) {
  return (
    <ActionForm action={answerJournalAction} hideSubmit pendingLabel="Saving…">
      {figures && <FigureBoxes figures={figures} />}
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
            Flag my report
          </Button>
        </div>
      </details>
    </ActionForm>
  );
}

/**
 * The day's figures, five small boxes in a row, each saying under it where
 * its number came from. Compact on purpose: the same form sits inside the
 * end-of-day popup, where there is no room for a label and a box on each line.
 */
function FigureBoxes({ figures }: { figures: DayEndFigures }) {
  return (
    <fieldset data-day-end-figures className="rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
      <legend className="px-1 text-xs font-semibold text-ink">The day&apos;s figures</legend>
      <p className="mb-2 text-xs text-muted">Every box starts from what the portal counted for you today; change any of them if the day was different. Fill in every box, 0 if none.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {FIGURE_KEYS.map((k) => (
          <div key={k} data-figure-box={k} className="min-w-0">
            <label htmlFor={`figure-${k}`} className="block text-2xs leading-tight text-muted">
              {FIGURE_LABEL[k]}
            </label>
            <input
              id={`figure-${k}`}
              name={k}
              type="number"
              inputMode="numeric"
              min={0}
              max={FIGURE_MAX}
              step={1}
              defaultValue={figures[k] ?? ""}
              data-figure={k}
              aria-describedby={`figure-${k}-source`}
              className="mt-0.5 w-full rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-sm tabular"
            />
            <p id={`figure-${k}-source`} data-figure-source={k} className="mt-0.5 text-3xs leading-tight text-muted">
              {FIGURE_SOURCE[k]}
            </p>
            <FieldError name={k} />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
