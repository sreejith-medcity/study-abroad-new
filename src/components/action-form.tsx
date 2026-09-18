"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Alert, Button, cn } from "./ui";
import { toast } from "./toast";

export type FormState = { error?: string; ok?: string; fieldErrors?: Record<string, string[] | undefined> };
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
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    // A toast keeps the confirmation visible even when the form has scrolled away.
    toast(state.ok);
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
