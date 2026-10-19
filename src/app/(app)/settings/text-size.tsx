"use client";

import { startTransition, useActionState, useOptimistic } from "react";
import { TEXT_SIZES } from "@/lib/text-size";
import { cn } from "@/components/ui";
import { toast } from "@/components/toast";
import { saveTextSizeAction } from "./actions";
import type { FormState } from "@/lib/form-state";

/**
 * Four samples of the same card at the four sizes, so the choice can be made
 * by looking rather than by reading the word "Large" and guessing. Picking
 * one saves on the click, the way the surface above it does, and the page
 * behind redraws a moment later at the new size.
 *
 * The samples are drawn with a font size of their own rather than with the
 * portal's classes, because at this point the page is still at the old size
 * and a sample that matched it would show nothing.
 */
export function TextSizePicker({ current }: { current: string }) {
  const [, run] = useActionState<FormState, FormData>(saveTextSizeAction, {});
  const [chosen, choose] = useOptimistic(current);

  function pick(id: string) {
    if (id === chosen) return;
    const fd = new FormData();
    fd.set("textSize", id);
    startTransition(() => {
      choose(id);
      run(fd);
      toast("Reading size saved.");
    });
  }

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      {TEXT_SIZES.map((t) => {
        const on = chosen === t.id;
        // 16px is the everyday size; the rest are multiples of it, the same
        // multiples the document itself uses.
        const px = (n: number) => `${(16 * t.sample * n).toFixed(2)}px`;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            aria-pressed={on}
            // The sample inside says nothing about which size it is, so the
            // button carries the name for anybody not reading by eye.
            aria-label={t.name}
            data-testid="size-swatch"
            className={cn(
              "rounded-xl border p-2 text-left transition-shadow",
              on ? "border-brand-600 shadow-lift ring-2 ring-brand-100" : "border-line hover:shadow-card",
            )}
          >
            <span className="block rounded-lg border border-line bg-surface-2/60 p-2.5">
              <span className="block font-medium text-muted" style={{ fontSize: px(0.75) }}>
                Waiting on the desk
              </span>
              <span className="mt-0.5 block font-medium text-ink" style={{ fontSize: px(0.875) }}>
                Arathi Krishnan
              </span>
              <span className="mt-0.5 block text-muted" style={{ fontSize: px(0.8125) }}>
                MSc Business Management
              </span>
            </span>
            <span className="mt-2 flex items-center gap-1.5 px-0.5">
              <span className="font-display text-md font-semibold text-ink">{t.name}</span>
              {on && <span className="rounded-full bg-brand-600 px-1.5 py-px text-3xs font-semibold text-white">On</span>}
            </span>
            <span className="mt-0.5 block px-0.5 text-xs leading-snug text-muted">{t.note}</span>
          </button>
        );
      })}
    </div>
  );
}
