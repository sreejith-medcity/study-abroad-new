"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Alert, Button } from "@/components/ui";
import { groupInr } from "@/lib/format";
import { reviewDraftsAction, type ReviewState } from "../actions";

const tickedIn = (form: HTMLFormElement | null) => form?.querySelectorAll('input[name="id"]:checked').length ?? 0;

type Next = { href: string; name: string; drafts: number } | null;

/**
 * The form around one university's drafts: the ticked courses, all of them,
 * or the clean ones (no worth-a-look flag), published or archived, and the
 * answer with the way on to the next university. The rows themselves come
 * from the server as children, so the table refreshes with whatever is still
 * a draft after each press.
 */
export function ReviewForm({
  universityId,
  source,
  total,
  clean,
  allLabel,
  next,
  children,
}: {
  universityId: string;
  source: string;
  /** Drafts in view at this university, across every page. */
  total: number;
  /** Of those, the drafts with no flag, which "Publish all clean drafts" is about. */
  clean: number;
  allLabel: string;
  next: Next;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState<ReviewState, FormData>(reviewDraftsAction, {});
  const [doing, setDoing] = useState<string | null>(null);
  const [ticked, setTicked] = useState(0);
  const ref = useRef<HTMLFormElement>(null);

  const countTicked = () => setTicked(tickedIn(ref.current));
  // Each answer clears the ticks. A course left as a draft would otherwise
  // stay ticked into the next press, and an Archive meant for one course
  // would quietly take the refused ones with it.
  useEffect(() => {
    if (!state.at) return;
    ref.current?.querySelectorAll<HTMLInputElement>('input[name="id"], input[data-select-all]').forEach((box) => (box.checked = false));
    setTicked(0);
  }, [state]);

  // Submitted through a transition rather than the form's action prop, so the
  // ticks are cleared here, once the answer is in, and not before it.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    setDoing(submitter?.value ?? null);
    startTransition(() => formAction(fd));
  }

  const answer = state.ok ?? state.error;
  const tone = state.ok ? (state.outcome && (state.outcome.left || state.outcome.gone) ? "warn" : "ok") : "bad";
  const busy = (op: string, label: string, idle: string) => (pending && doing === op ? label : idle);

  return (
    <form ref={ref} onSubmit={onSubmit} onChange={countTicked} noValidate>
      <input type="hidden" name="universityId" value={universityId} />
      <input type="hidden" name="source" value={source} />
      {answer && (
        <div className="border-b border-line p-4" data-review-result data-answer={state.at} data-done={state.outcome?.done ?? 0} data-left={state.outcome?.left ?? 0}>
          <Alert tone={tone}>
            <p>{answer}</p>
            {next ? (
              <p className="mt-1.5">
                Next university:{" "}
                <Link href={next.href} className="font-semibold underline" data-next-university>
                  {next.name}
                </Link>{" "}
                ({groupInr(next.drafts)} draft{next.drafts === 1 ? "" : "s"}).
              </p>
            ) : (
              <p className="mt-1.5">No other university on your list has drafts.</p>
            )}
          </Alert>
        </div>
      )}
      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Button name="op" value="publish" size="sm" disabled={pending || ticked === 0}>
            {busy("publish", "Publishing…", ticked ? `Publish selected (${ticked})` : "Publish selected")}
          </Button>
          <Button name="op" value="archive" size="sm" variant="secondary" disabled={pending || ticked === 0}>
            {busy("archive", "Archiving…", ticked ? `Archive selected (${ticked})` : "Archive selected")}
          </Button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <Button name="op" value="publishClean" size="sm" disabled={pending || clean === 0} data-publish-clean data-clean={clean}>
            {busy("publishClean", `Publishing ${groupInr(clean)}…`, `Publish all clean drafts (${groupInr(clean)})`)}
          </Button>
          <Button name="op" value="publishAll" size="sm" variant="secondary" disabled={pending} data-publish-all>
            {busy("publishAll", `Publishing ${groupInr(total)}…`, allLabel)}
          </Button>
          <span className="text-sm text-muted">Clean drafts have nothing worth a look. Courses that are not ready stay drafts, and the answer says why.</span>
        </div>
      )}
      {children}
    </form>
  );
}

/**
 * Ticks or clears every course on this page. Left uncontrolled, like the
 * course boxes, so the form can clear it with them after an answer.
 */
export function SelectAll() {
  return (
    <input
      type="checkbox"
      aria-label="Select every course on this page"
      data-select-all
      onChange={(e) => {
        const on = e.currentTarget.checked;
        e.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="id"]').forEach((box) => (box.checked = on));
      }}
      className="size-4 accent-brand-600"
    />
  );
}
