"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { filterAssignGroups, type AssignGroup } from "@/lib/assign-choice";
import { cn } from "./ui";

/**
 * A list of people in groups that can be searched by typing.
 *
 * Written for the Assign list on the students list and the student's file,
 * which for a head office admin carries every team and every branch: a plain
 * select had grown to several screens of names that could only be scrolled.
 * The button shows who is chosen; opening it puts the cursor in a search box,
 * every word typed narrows the list by name or by group (so "ausb" leaves the
 * Ausbildung team and the Ausbildung branch), the arrow keys move and Enter
 * picks.
 *
 * The list is drawn fixed to the window, under the button or above it when
 * there is no room below, because the students table scrolls sideways and a
 * list drawn inside it would be cut off at the table's edge. Scrolling the
 * page or resizing the window closes it rather than leaving it floating
 * away from its row.
 */
export function GroupedPicker({
  groups,
  value,
  noneLabel = "Unassigned",
  label,
  disabled,
  grouped = true,
  onPick,
}: {
  groups: AssignGroup[];
  value: string;
  noneLabel?: string;
  label: string;
  disabled?: boolean;
  /** Without groups the headers are not drawn: a branch's own list only ever has its own people. */
  grouped?: boolean;
  onPick: (value: string) => void;
}) {
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [cursor, setCursor] = useState(0);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number; width: number; maxHeight: number } | null>(null);

  const chosenLabel = useMemo(() => {
    if (!value) return noneLabel;
    for (const g of groups) {
      const o = g.options.find((x) => x.value === value);
      if (o) return o.label;
    }
    return noneLabel;
  }, [groups, value, noneLabel]);

  const shown = useMemo(() => filterAssignGroups(groups, text), [groups, text]);
  // "Unassigned" stays first while nothing is typed, or when the search asks for it.
  const showNone = !text.trim() || noneLabel.toLowerCase().includes(text.trim().toLowerCase());
  const flat = useMemo(() => {
    const all: { value: string; label: string }[] = [];
    if (showNone) all.push({ value: "", label: noneLabel });
    for (const g of shown) for (const o of g.options) all.push(o);
    return all;
  }, [shown, showNone, noneLabel]);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const width = Math.max(r.width, 288);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    if (below >= 260 || below >= above) setPlace({ left, top: r.bottom + 4, width, maxHeight: Math.max(160, below - 4) });
    else setPlace({ left, bottom: window.innerHeight - r.top + 4, width, maxHeight: Math.max(160, above - 4) });
  }, [open]);

  // The search box exists only once the list has been placed, so the cursor
  // is put in it then, not when the button is pressed.
  useEffect(() => {
    if (open && place) search.current?.focus();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
      setPlace(null);
      setText("");
    };
    const shut = (e: Event) => {
      if (panel.current && e.target instanceof Node && panel.current.contains(e.target)) return;
      setOpen(false);
      setPlace(null);
      setText("");
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", shut, true);
    window.addEventListener("resize", shut);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", shut, true);
      window.removeEventListener("resize", shut);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setPlace(null);
    setText("");
    setCursor(0);
    button.current?.focus();
  };
  const pick = (v: string) => {
    close();
    if (v !== value) onPick(v);
  };

  let index = -1;
  const optionButton = (o: { value: string; label: string }) => {
    index += 1;
    const i = index;
    return (
      <li key={o.value || "none"}>
        <button
          type="button"
          role="option"
          aria-selected={i === cursor}
          onMouseEnter={() => setCursor(i)}
          onClick={() => pick(o.value)}
          className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === cursor ? "bg-brand-50" : "hover:bg-ground")}
        >
          <span className="w-3 shrink-0 text-brand-700">{o.value === value ? "✓" : ""}</span>
          <span className="min-w-0 flex-1 truncate">{o.label}</span>
        </button>
      </li>
    );
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${chosenLabel}`}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex min-w-32 max-w-56 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-sm disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">{chosenLabel}</span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open && place && (
        <div
          ref={panel}
          style={{ position: "fixed", left: place.left, top: place.top, bottom: place.bottom, width: place.width, maxHeight: place.maxHeight }}
          className="z-50 flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
        >
          <div className="border-b border-line p-2">
            <input
              ref={search}
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-label={`Search ${label.toLowerCase()}`}
              autoComplete="off"
              placeholder="Search a name, team or branch"
              value={text}
              onChange={(e) => {
                setText(e.currentTarget.value);
                setCursor(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((i) => Math.min(i + 1, flat.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (flat[cursor]) pick(flat[cursor].value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
              }}
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className="thin-scroll min-h-0 flex-1 overflow-y-auto py-1">
            {showNone && optionButton({ value: "", label: noneLabel })}
            {shown.map((g) =>
              grouped ? (
                <li key={`${g.kind}:${g.label}`} role="presentation">
                  <p className="px-3 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted">{g.label}</p>
                  <ul role="group" aria-label={g.label}>{g.options.map(optionButton)}</ul>
                </li>
              ) : (
                g.options.map(optionButton)
              ),
            )}
            {flat.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nobody matches that.</li>}
          </ul>
        </div>
      )}
    </>
  );
}
