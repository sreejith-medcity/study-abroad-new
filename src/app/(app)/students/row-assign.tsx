"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button, Select } from "@/components/ui";
import { reassignStudentAction } from "./actions";

/**
 * Handing a student to somebody, from the list itself.
 *
 * This was a dropdown with a Save button beside it: two moves for one
 * decision, on a row that is already tight, and a button that sat there
 * unread whether or not anything had changed. A branch reassigning a morning's
 * intake was clicking it twenty times. The dropdown files the change on its
 * own now, and says so in the space the button used to take.
 *
 * The button is still rendered first, so the row works in a browser that has
 * not run the script yet, and steps aside once it has. That swap happens after
 * mount rather than during render, so the server's markup and the browser's
 * first pass agree.
 */
export function RowAssign({
  studentId,
  current,
  label,
  children,
}: {
  studentId: string;
  current: string;
  label: string;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  const [scripted, setScripted] = useState(false);
  const [saved, setSaved] = useState(false);
  const select = useRef<HTMLSelectElement>(null);

  useEffect(() => setScripted(true), []);

  function fileIt() {
    const data = new FormData();
    data.set("studentId", studentId);
    data.set("assignedToId", select.current?.value ?? "");
    setSaved(false);
    start(async () => {
      await reassignStudentAction(data);
      setSaved(true);
    });
  }

  return (
    <form action={reassignStudentAction} className="flex items-center gap-1.5">
      <input type="hidden" name="studentId" value={studentId} />
      <Select
        ref={select}
        name="assignedToId"
        defaultValue={current}
        aria-label={label}
        className="min-w-32 py-1.5"
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
        <Button variant="quiet" className="px-2 py-1" type="submit" aria-label="Save assignment">
          Save
        </Button>
      )}
    </form>
  );
}
