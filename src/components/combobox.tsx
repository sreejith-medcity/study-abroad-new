"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "./ui";

export type PickOption = {
  id: string;
  label: string;
  sub?: string;
  tag?: string;
  /** Whatever the caller needs back when this one is picked. */
  data?: unknown;
};

/**
 * Type to search, then pick one.
 *
 * Written because the course picker was a plain select holding the first fifty
 * rows of a catalogue with tens of thousands in it: the list looked broken,
 * typing did nothing a browser's first-letter jump could not do, and the only
 * way to narrow it was a separate Find button that reloaded the page. The same
 * problem applies to picking a student out of several thousand.
 *
 * The chosen value is posted by a hidden input, so this drops into an ordinary
 * form with no extra wiring.
 */
export function Combobox({
  name,
  endpoint,
  params,
  initial,
  selected,
  placeholder = "Type to search",
  label,
  emptyText = "Nothing matches that.",
  required,
  onPick,
}: {
  name: string;
  /** Returns { options: PickOption[] } for ?q= plus whatever params are given. */
  endpoint: string;
  params?: Record<string, string>;
  /** Shown before anything is typed: a shortlist, the recent few, the current one. */
  initial?: PickOption[];
  /** The option already chosen, if any. */
  selected?: PickOption | null;
  placeholder?: string;
  label?: string;
  emptyText?: string;
  required?: boolean;
  onPick?: (option: PickOption | null) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<PickOption | null>(selected ?? null);
  const [options, setOptions] = useState<PickOption[]>(initial ?? []);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const query = params ? new URLSearchParams(params).toString() : "";

  // Debounced, and the stale answer to an earlier keystroke is thrown away
  // rather than allowed to overwrite the newer one.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const run = async () => {
      setBusy(true);
      try {
        const url = `${endpoint}?q=${encodeURIComponent(text)}${query ? `&${query}` : ""}`;
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { options?: PickOption[] };
        if (live) {
          setOptions(body.options ?? []);
          setCursor(0);
        }
      } catch {
        if (live) setOptions([]);
      } finally {
        if (live) setBusy(false);
      }
    };
    const t = setTimeout(run, text ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, open, endpoint, query]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const pick = (o: PickOption) => {
    setChosen(o);
    setText("");
    setOpen(false);
    onPick?.(o);
  };
  const clear = () => {
    setChosen(null);
    setText("");
    setOptions(initial ?? []);
    onPick?.(null);
  };

  return (
    <div ref={box} className="relative min-w-0">
      <input type="hidden" name={name} value={chosen?.id ?? ""} />
      {chosen ? (
        <div className="flex min-w-0 items-start gap-2 rounded-lg border border-brand-500 bg-brand-50/40 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{chosen.label}</span>
            {chosen.sub && <span className="block truncate text-xs text-muted">{chosen.sub}</span>}
          </span>
          <button type="button" onClick={clear} className="shrink-0 text-[13px] font-medium text-brand-700 hover:underline">
            Change
          </button>
        </div>
      ) : (
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={label}
          autoComplete="off"
          required={required}
          placeholder={placeholder}
          value={text}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setCursor((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && open && options[cursor]) {
              // Enter picks the highlighted row; it must not also submit the form.
              e.preventDefault();
              pick(options[cursor]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      )}
      {open && !chosen && (
        <ul
          id={listId}
          role="listbox"
          className="thin-scroll absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          {busy && options.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">Searching…</li>}
          {!busy && options.length === 0 && <li className="px-3 py-2 text-[13px] text-muted">{emptyText}</li>}
          {options.map((o, i) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => pick(o)}
                className={cn("block w-full px-3 py-2 text-left", i === cursor ? "bg-brand-50" : "hover:bg-ground")}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{o.label}</span>
                  {o.tag && <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">{o.tag}</span>}
                </span>
                {o.sub && <span className="block truncate text-xs text-muted">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
