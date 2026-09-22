"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
}: {
  action: Action;
  children: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitVariant?: "primary" | "secondary";
  hideSubmit?: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state.redirectTo) router.push(state.redirectTo);
  }, [state, router]);
  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    setDismissed(false);
    // Anything worth keeping stays on the page. Everything else is a toast, which
    // keeps the confirmation visible even when the form has scrolled away.
    if (!state.keep) toast(state.ok);
  }, [state, resetOnSuccess]);
  // Submit through a transition instead of the form action prop, so React does not
  // clear what the user typed when the server returns a validation error.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    startTransition(() => formAction(fd));
  }
  return (
    <ErrorsContext.Provider value={state.fieldErrors ?? {}}>
      <form ref={ref} onSubmit={onSubmit} className={cn("space-y-3", className)} noValidate>
        {state.error && <Alert tone="bad">{state.error}</Alert>}
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

export function FieldError({ name }: { name: string }) {
  const errors = useContext(ErrorsContext)[name];
  if (!errors?.length) return null;
  return <p className="text-xs text-red-600">{errors[0]}</p>;
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
      <p className="text-[13px] leading-relaxed text-ink">{message}</p>
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
