"use client";

import { useEffect, useState } from "react";
import { cn } from "./ui";
import { IconAlert, IconCheck } from "./icons";

export type ToastTone = "ok" | "bad" | "info";
type Toast = { id: number; message: string; tone: ToastTone };

const EVENT = "portal:toast";

/** Raise a toast from anywhere on the client, without threading a context through. */
export function toast(message: string, tone: ToastTone = "ok") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

const TONE: Record<ToastTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  bad: "border-red-200 bg-red-50 text-red-900",
  info: "border-line bg-surface text-ink",
};

/** Sits once in the app shell and shows whatever toast() raises. */
export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    let next = 0;
    function onToast(event: Event) {
      const detail = (event as CustomEvent<{ message: string; tone?: ToastTone }>).detail;
      if (!detail?.message) return;
      const id = ++next;
      setItems((list) => [...list.slice(-2), { id, message: detail.message, tone: detail.tone ?? "ok" }]);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
    }
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:items-end"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] shadow-pop motion-safe:animate-[toast-in_180ms_ease-out]",
            TONE[t.tone],
          )}
        >
          <span className="mt-0.5 shrink-0">{t.tone === "bad" ? <IconAlert className="size-4" /> : <IconCheck className="size-4" />}</span>
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}
            aria-label="Dismiss"
            className="shrink-0 rounded px-1 text-current/60 hover:text-current"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
