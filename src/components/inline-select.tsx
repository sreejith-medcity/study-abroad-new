"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, Select, cn } from "@/components/ui";

/**
 * A choice on a list that files itself.
 *
 * Every one of these used to be a dropdown with a Save button beside it: two
 * moves for one decision, on a row that is already tight, and a button that
 * sat there unread whether or not anything had changed. Somebody working
 * through a morning's intake was clicking it once per row.
 *
 * The button is still rendered first, so the control works in a browser that
 * has not run the script yet, and steps aside once it has. That swap happens
 * after mount rather than during render, so the server's markup and the
 * browser's first pass agree.
 */
export function InlineSelect({
  action,
  idName,
  id,
  name,
  value,
  label,
  className,
  children,
}: {
  action: (fd: FormData) => Promise<void>;
  /** What the action calls the row's own identifier. */
  idName: string;
  id: string;
  /** What the action calls the choice. */
  name: string;
  value: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [scripted, setScripted] = useState(false);
  const [saved, setSaved] = useState(false);
  const field = useRef<HTMLSelectElement>(null);

  useEffect(() => setScripted(true), []);

  function fileIt() {
    const data = new FormData();
    data.set(idName, id);
    data.set(name, field.current?.value ?? "");
    setSaved(false);
    start(async () => {
      await action(data);
      setSaved(true);
    });
  }

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name={idName} value={id} />
      <Select
        ref={field}
        name={name}
        defaultValue={value}
        aria-label={label}
        className={cn("min-w-32 py-1.5", className)}
        disabled={pending}
        onChange={scripted ? fileIt : undefined}
      >
        {children}
      </Select>
      {scripted ? (
        <span className="w-11 shrink-0 text-[11px] text-muted" aria-live="polite">
          {pending ? "Saving" : saved ? "Saved" : ""}
        </span>
      ) : (
        <Button variant="quiet" className="px-2 py-1" type="submit" aria-label={`Save ${label}`}>
          Save
        </Button>
      )}
    </form>
  );
}
