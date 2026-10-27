"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, cn } from "./ui";
import { toast } from "./toast";

import type { FormState } from "@/lib/form-state";
export type { FormState };
type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const ErrorsContext = createContext<Record<string, string[] | undefined>>({});

export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  className,
  resetOnSuccess = false,
  submitVariant = "primary",
  hideSubmit = false,
  beforeSubmit,
  trackUnsaved = false,
}: {
  action: Action;
  children: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitVariant?: "primary" | "secondary";
  hideSubmit?: boolean;
  /**
   * A check run in the browser before anything is sent. Return a message to
   * stop the submit and show it, or null to go ahead. For the things worth
   * catching before a round trip: a file too big for the server to accept,
   * which otherwise comes back as a dead screen rather than an answer.
   */
  beforeSubmit?: (fd: FormData) => string | null;
  /**
   * Marks the form with data-unsaved while what is in it differs from what
   * was last loaded or saved, so something else on the page that would
   * replace the form (a Restore in the change history) can refuse rather than
   * throw away somebody's typing. Typing a value back to what it was clears it.
   */
  trackUnsaved?: boolean;
}) {
  // The latest action, read at submit time, so the wrapper below can stay
  // the same function across renders.
  const latest = useRef(action);
  latest.current = action;
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (prev, fd) => {
    const next = await latest.current(prev, fd);
    // The toast is raised here, as the answer arrives, and not from an effect
    // on this component. A save can take the form off the screen in the same
    // commit that carries its answer: a person's row edited under a search
    // the new email no longer matches, or a person moved to another fold.
    // An effect on a component unmounted in that commit never runs, so the
    // confirmation was never shown. The toast host lives in the shell and is
    // still there whatever the save did to this form.
    if (next?.ok && !next.keep) toast(next.ok);
    return next;
  }, {});
  const [dismissed, setDismissed] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // A complaint about what was typed stops being true the moment somebody
  // starts retyping it. Left up, it reads as the form refusing good input: a
  // contact row with the phone now filled in still showed "Give a phone number
  // or an email" from the attempt before, under the very field that now had
  // one. Cleared on the first keystroke, and shown again by whatever the next
  // submit answers.
  const [editedSince, setEditedSince] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  // What the form held when it was loaded or last saved, to tell typing apart
  // from typing that has been undone.
  const savedSnapshot = useRef<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (trackUnsaved && ref.current) savedSnapshot.current = snapshotOf(ref.current);
  }, [trackUnsaved]);
  // Anything worth keeping (a one-time password) stays on the page as a panel.
  // Everything else was already raised as a toast when the answer arrived.
  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    if (trackUnsaved && ref.current) {
      savedSnapshot.current = snapshotOf(ref.current);
      ref.current.removeAttribute("data-unsaved");
    }
    setDismissed(false);
  }, [state, resetOnSuccess, trackUnsaved]);
  useEffect(() => {
    if (state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);
  // Every answer from the server is a fresh object, so the same error coming
  // back a second time still puts itself back on the screen.
  useEffect(() => {
    setEditedSince(false);
  }, [state]);
  // Submit through a transition instead of the form action prop, so React does not
  // clear what the user typed when the server returns a validation error.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    const stop = beforeSubmit?.(fd) ?? null;
    setRefused(stop);
    if (stop) return;
    startTransition(() => formAction(fd));
  }
  const complaining = !editedSince;
  const noteEdit = () => {
    const form = ref.current;
    if (trackUnsaved && form) form.toggleAttribute("data-unsaved", snapshotOf(form) !== savedSnapshot.current);
    if (refused) setRefused(null);
    if (!editedSince && (state.error || state.fieldErrors)) setEditedSince(true);
  };
  return (
    <ErrorsContext.Provider value={complaining ? state.fieldErrors ?? {} : {}}>
      <form ref={ref} onSubmit={onSubmit} onInput={noteEdit} onChange={noteEdit} className={cn("space-y-3", className)} noValidate>
        {(refused || (state.error && complaining)) && <Alert tone="bad">{refused ?? state.error}</Alert>}
        {!refused && state.error && complaining && state.link && (
          <p>
            <Link href={state.link.href} className="text-sm font-medium text-brand-600 hover:underline" data-form-link>
              {state.link.label}
            </Link>
          </p>
        )}
        {state.ok && state.keep && !dismissed && <KeepAlert message={state.ok} onDismiss={() => setDismissed(true)} />}
        {children}
        {!hideSubmit && (
          <div>
            <Button type="submit" variant={submitVariant} disabled={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </div>
        )}
      </form>
    </ErrorsContext.Provider>
  );
}

/** Everything a form would send, as one string to compare. */
function snapshotOf(form: HTMLFormElement) {
  return JSON.stringify([...new FormData(form).entries()].map(([k, v]) => [k, typeof v === "string" ? v : v.name]));
}

export function FieldError({ name }: { name: string }) {
  const errors = useContext(ErrorsContext)[name];
  if (!errors?.length) return null;
  return <p className="text-xs text-stop-500">{errors[0]}</p>;
}

export function SubmitButton({ children, className, variant = "primary" }: { children: ReactNode; className?: string; variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return (
    <Button type="submit" variant={variant} className={className}>
      {children}
    </Button>
  );
}

/**
 * A message that must survive long enough to be acted on: a one-time password
 * handed to somebody. It stays until dismissed and offers a copy button, because
 * retyping a generated password from a screen is where onboarding goes wrong.
 */
function KeepAlert({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the text is on screen either way.
    }
  }
  return (
    <div className="rounded-xl border border-gold-500/40 bg-gold-300/20 p-3.5">
      <p className="text-sm leading-relaxed text-ink">{message}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        <button type="button" onClick={onDismiss} className="text-xs text-muted hover:text-ink">
          Dismiss
        </button>
        <span className="text-xs text-muted">This is the only time it is shown.</span>
      </div>
    </div>
  );
}
