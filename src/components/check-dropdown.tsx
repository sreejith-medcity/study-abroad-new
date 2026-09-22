"use client";

import { useEffect, useRef } from "react";
import { cn } from "./ui";

/**
 * A select-like button that opens a list of checkboxes, for filters that take
 * several values. The boxes are ordinary form fields, so the surrounding GET
 * form submits them as repeated keys. Closes on a click outside or Escape.
 */
export function CheckDropdown({
  label,
  summary,
  name,
  options,
  selected,
  testId,
}: {
  label: string;
  summary: string | null;
  name: string;
  options: readonly (readonly [string, string])[];
  selected: string[];
  testId?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className="relative" data-testid={testId}>
      <summary
        aria-label={label}
        className="flex h-10 cursor-pointer list-none items-center justify-between rounded-lg border border-line-strong bg-surface px-3 text-sm [&::-webkit-details-marker]:hidden"
      >
        <span className={cn("truncate", !summary && "text-muted")}>{summary ?? label}</span>
        <span aria-hidden className="text-muted">▾</span>
      </summary>
      <fieldset className="absolute z-20 mt-1 w-full min-w-[14rem] space-y-1 rounded-lg border border-line bg-surface p-2 shadow-lg">
        <legend className="sr-only">{label}</legend>
        {options.map(([k, text]) => (
          <label key={k} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-2">
            <input type="checkbox" name={name} value={k} defaultChecked={selected.includes(k)} /> {text}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
