"use client";

import { useEffect, useRef, useState } from "react";
import { Input, cn } from "@/components/ui";
import { IconSearch } from "@/components/icons";

type Suggestion = { value: string; n: number; area?: boolean };

/**
 * The course box, with the catalogue's own names offered as they are typed.
 *
 * A field of study narrows better than a keyword, so study areas come first
 * and set the field filter; a course name goes in as the search words. What
 * the counsellor types stands on its own, so the list never has to be used.
 */
export function CourseBox({ q, field }: { q?: string; field?: string }) {
  const [text, setText] = useState(q ?? "");
  const [chosenField, setChosenField] = useState(field ?? "");
  const [list, setList] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = text.trim();
    if (term.length < 2 || term === (q ?? "")) {
      setList([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/programs/suggest?q=${encodeURIComponent(term)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { areas: Suggestion[]; courses: Suggestion[] };
        setList([...data.areas.map((a) => ({ ...a, area: true })), ...data.courses]);
        setOpen(true);
      } catch {
        // The box still works without the list; nothing is worth saying here.
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [text, q]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  return (
    <div ref={box} className="relative">
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted" />
      <Input
        name="q"
        value={text}
        autoComplete="off"
        onChange={(e) => {
          setText(e.target.value);
          setChosenField("");
        }}
        onFocus={() => list.length && setOpen(true)}
        aria-label="Course or study area"
        placeholder="Type a course or a field of study"
        className="pl-10"
      />
      <input type="hidden" name="field" value={chosenField} />
      {open && list.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-xl border border-line-strong bg-surface py-1 shadow-lg" role="listbox">
          {list.map((s) => (
            <li key={`${s.area ? "a" : "c"}-${s.value}`}>
              <button
                type="button"
                onClick={() => {
                  if (s.area) {
                    setChosenField(s.value);
                    setText("");
                  } else {
                    setChosenField("");
                    setText(s.value);
                  }
                  setOpen(false);
                }}
                className={cn("flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] hover:bg-surface-2", s.area && "font-medium text-brand-700")}
              >
                <span className="truncate">{s.area ? `${s.value} (field of study)` : s.value}</span>
                <span className="tabular shrink-0 text-xs text-muted">{s.n.toLocaleString("en-IN")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chosenField && (
        <p className="mt-1 text-xs text-muted">
          Field of study: <span className="font-medium text-ink">{chosenField}</span>{" "}
          <button type="button" onClick={() => setChosenField("")} className="text-brand-600 hover:underline">clear</button>
        </p>
      )}
    </div>
  );
}
