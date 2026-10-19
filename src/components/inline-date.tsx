"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button, Input } from "@/components/ui";

/**
 * A date on a list that can be corrected where it is read.
 *
 * The pattern is the one the students list uses for handing a file to
 * somebody: changing the control is the whole move, and what used to be a
 * Save button becomes the word Saved. The button is still rendered for a
 * browser that has not run the script, and steps aside once it has, so the
 * swap happens after mount and the server's markup is never contradicted.
 */
export function InlineDate({
  action,
  name,
  id,
  value,
  label,
  max,
}: {
  action: (fd: FormData) => Promise<void>;
  /** The field the action reads the new date from. */
  name: string;
  id: string;
  value: string;
  label: string;
  /** The last date that makes sense here, when the row has one. */
  max?: string;
}) {
  const [pending, start] = useTransition();
  const [scripted, setScripted] = useState(false);
  const [saved, setSaved] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => setScripted(true), []);

  function fileIt() {
    const next = field.current?.value ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next === value) return;
    const data = new FormData();
    data.set("id", id);
    data.set(name, next);
    setSaved(false);
    start(async () => {
      await action(data);
      setSaved(true);
    });
  }

  return (
    <form action={action} className="mt-1 flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <Input
        ref={field}
        type="date"
        name={name}
        defaultValue={value}
        max={max}
        aria-label={label}
        disabled={pending}
        onChange={scripted ? fileIt : undefined}
        className="w-36 px-2 py-1 text-xs"
      />
      {scripted ? (
        <span className="w-11 shrink-0 text-2xs text-muted" aria-live="polite">
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
