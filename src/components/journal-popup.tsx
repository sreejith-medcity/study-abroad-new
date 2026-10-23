"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AnswerJournal } from "@/app/(app)/journal/forms";
import { cn } from "./ui";

export type JournalDue = {
  day: string;
  closesAt: string;
  work: number;
  totals: { label: string; n: number }[];
  latest: { at: string; text: string; href: string | null; outOfHours: boolean }[];
  lateSignIn: boolean;
};

/**
 * The day's journal, put in front of somebody from the end of the working day
 * until they answer it.
 *
 * It opens over whatever page they are on, with the day's totals, the latest
 * few lines and the answer itself, so most days it is verified without
 * leaving the page. It can be minimised to a small tab in the corner, which
 * stays on every page and opens it again; minimised is remembered for the
 * day in this browser, so it does not spring open on every page they visit
 * after choosing to put it away. Once answered, it is gone.
 *
 * Not shown on the journal page itself, which is the same thing in full.
 */
export function JournalPopup({ due }: { due: JournalDue }) {
  const path = usePathname();
  const key = `journal-minimised-${due.day}`;
  // Nothing is drawn until the browser has said whether it was minimised, so
  // the popup never flashes open and shut again on a page change.
  const [open, setOpen] = useState<boolean | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let minimised = false;
    try {
      minimised = window.localStorage.getItem(key) === "1";
    } catch {
      // Storage refused (private window, blocked site data): open it.
    }
    setOpen(!minimised);
  }, [key]);

  const remember = (min: boolean) => {
    try {
      if (min) window.localStorage.setItem(key, "1");
      else window.localStorage.removeItem(key);
    } catch {
      // Remembering is a convenience; the popup still works without it.
    }
  };
  const minimise = () => {
    remember(true);
    setOpen(false);
  };
  const restore = () => {
    remember(false);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") minimise();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (path === "/journal" || open === null) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={restore}
        data-journal-tab
        data-print="hide"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-warn-500 px-4 py-2.5 text-sm font-semibold text-white shadow-pop hover:bg-warn-700"
      >
        <span className="size-2 animate-pulse rounded-full bg-white" aria-hidden="true" />
        Today&apos;s journal: verify by {due.closesAt}
      </button>
    );
  }

  return (
    <div data-journal-popup data-print="hide" className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-6">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="journal-popup-title"
        tabIndex={-1}
        className="thin-scroll flex max-h-[90vh] w-full max-w-xl flex-col overflow-y-auto rounded-2xl border border-line bg-surface shadow-pop !outline-none"
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="journal-popup-title" className="font-display text-lg font-semibold text-ink">
              Your journal for today
            </h2>
            <p className="text-sm text-muted">The working day is over. Check what you did and verify it before {due.closesAt}.</p>
          </div>
          <button
            type="button"
            onClick={minimise}
            data-journal-minimise
            className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2"
            aria-label="Minimise the journal"
          >
            Minimise
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {due.lateSignIn && (
            <p className="rounded-lg bg-stop-50 px-3 py-2 text-xs font-medium text-stop-700">You signed in after hours today. That is recorded on your journal.</p>
          )}
          {due.work === 0 ? (
            <p className="rounded-lg bg-surface-2 px-3 py-3 text-sm text-ink-soft">Nothing recorded in the portal today. If that is right, verify it.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {due.totals.map((t) => (
                  <div key={t.label} className="rounded-lg bg-surface-2 px-3 py-2">
                    <dd className="font-display text-xl font-semibold tabular text-ink">{t.n}</dd>
                    <dt className="text-2xs leading-tight text-muted">{t.label}</dt>
                  </div>
                ))}
              </dl>
              <div>
                <p className="mb-1 text-3xs font-semibold uppercase tracking-wider text-muted">Latest</p>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {due.latest.map((l, i) => (
                    <li key={i} className={cn("flex gap-3 px-3 py-2 text-sm", l.outOfHours && "bg-stop-50/60")}>
                      <span className="w-[4.75rem] shrink-0 whitespace-nowrap tabular text-muted">{l.at}</span>
                      <span className="min-w-0 flex-1 truncate text-ink">{l.text}</span>
                    </li>
                  ))}
                </ul>
                {due.work > due.latest.length && (
                  <p className="mt-1 text-xs text-muted">and {due.work - due.latest.length} more on the full journal</p>
                )}
              </div>
            </>
          )}
          <AnswerJournal count={due.work} />
          <Link href="/journal" className="inline-block text-sm font-medium text-brand-700 hover:underline">
            Read every line on the full journal
          </Link>
        </div>
      </div>
    </div>
  );
}
