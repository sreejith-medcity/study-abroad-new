"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./ui";
import { IconSearch } from "./icons";
import type { NavGroup } from "./nav";

type Hit = { kind: "student" | "application" | "partner"; label: string; hint: string; href: string };
type Row = { key: string; label: string; hint: string; href: string; group: string };

const KIND_GROUP: Record<Hit["kind"], string> = {
  student: "Students",
  application: "Applications",
  partner: "Partners",
};

/**
 * Command palette on Ctrl+K or Cmd+K. Destinations come from the signed-in
 * person's own navigation, so it can never offer a screen their role cannot open,
 * and records are fetched from an endpoint scoped the same way the pages are.
 */
export function CommandPalette({ groups }: { groups: NavGroup[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const destinations = useMemo<Row[]>(
    () =>
      groups.flatMap((g) =>
        g.items
          .filter((i) => !i.soon)
          .map((i) => ({ key: i.href, label: i.label, hint: g.title, href: i.href, group: "Go to" })),
      ),
    [groups],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((was) => !was);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setCursor(0);
      // The dialog mounts first, so focus on the next frame.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Records are looked up a beat after typing stops, so a fast typist makes one request.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/palette?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const data = (await response.json()) as { hits?: Hit[] };
        setHits(data.hits ?? []);
      } catch {
        // An aborted request is the normal case while typing.
      } finally {
        setBusy(false);
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const term = query.trim().toLowerCase();
    const places = term
      ? destinations.filter((d) => d.label.toLowerCase().includes(term) || d.hint.toLowerCase().includes(term))
      : destinations;
    const records: Row[] = hits.map((h) => ({
      key: `${h.kind}:${h.href}`,
      label: h.label,
      hint: h.hint,
      href: h.href,
      group: KIND_GROUP[h.kind],
    }));
    return [...records, ...places.slice(0, term ? 6 : 12)];
  }, [destinations, hits, query]);

  const go = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      setOpen(false);
      router.push(row.href);
    },
    [router],
  );

  useEffect(() => setCursor(0), [rows.length]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search the portal"
        className="hidden items-center gap-2 rounded-lg bg-white/12 px-2.5 py-1.5 text-[13px] text-white/75 ring-1 ring-inset ring-white/15 transition-colors hover:bg-white/20 hover:text-white sm:flex"
      >
        <IconSearch className="size-4" />
        <span>Search</span>
        <kbd className="rounded bg-white/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold tracking-wide">⌘K</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search the portal">
      <div className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-pop">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <IconSearch className="size-[18px] shrink-0 text-muted" />
          <input
            ref={inputRef}
            autoFocus
            aria-label="Search the portal"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(rows[cursor]);
              }
            }}
            placeholder="Search a student, an acknowledgement number, or a screen"
            className="w-full bg-transparent py-3.5 text-[15px] outline-none focus-visible:outline-none placeholder:text-muted/70"
          />
          {busy && <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-line border-t-brand-600" aria-hidden="true" />}
          <button type="button" onClick={() => setOpen(false)} className="shrink-0 rounded px-1.5 text-xs font-medium text-muted hover:text-ink">
            Esc
          </button>
        </div>

        <ul className="thin-scroll max-h-[22rem] overflow-y-auto py-1.5">
          {rows.length === 0 ? (
            <li className="px-4 py-8 text-center text-[13px] text-muted">
              {query.trim().length < 2 ? "Type at least two letters." : "Nothing matched that."}
            </li>
          ) : (
            rows.map((row, i) => {
              const newGroup = i === 0 || rows[i - 1].group !== row.group;
              return (
                <li key={row.key}>
                  {newGroup && (
                    <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/70">{row.group}</p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(row)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left text-sm",
                      i === cursor ? "bg-brand-50 text-brand-700" : "hover:bg-surface-2",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{row.label}</span>
                    {row.hint && <span className="shrink-0 truncate text-xs text-muted">{row.hint}</span>}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
          Up and down to move, Enter to open, Esc to close.
        </p>
      </div>
    </div>
  );
}
