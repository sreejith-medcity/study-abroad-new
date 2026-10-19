"use client";

import { startTransition, useActionState, useOptimistic } from "react";
import { SKINS } from "@/lib/skins";
import { cn } from "@/components/ui";
import { toast } from "@/components/toast";
import { saveSkinAction } from "./actions";
import type { FormState } from "@/lib/form-state";

/**
 * Three swatches, each a small portrait of the surface it switches to:
 * a header strip, a card and a figure, painted with the same values the
 * skin uses. Picking one saves on the click, because a surface is
 * something you judge by looking rather than by reading a label.
 */
const SWATCH: Record<string, { page: string; card: string; header: string; line: string; ink: string; faint: string }> = {
  soft: {
    page: "#f6f2f5",
    card: "#ffffff",
    header: "linear-gradient(115deg,#631a33,#c01f53)",
    line: "#e9e2e8",
    ink: "#1c1420",
    faint: "#6c6374",
  },
  glass: {
    page: "linear-gradient(135deg,#e7d7e6,#dfe4f3 55%,#efdfe6)",
    card: "rgba(255,255,255,0.58)",
    header: "linear-gradient(115deg,#631a33,#c01f53)",
    line: "rgba(255,255,255,0.6)",
    ink: "#16101a",
    faint: "#5f5768",
  },
  night: {
    page: "#110c16",
    card: "#191220",
    header: "linear-gradient(115deg,#3d1020,#a32350)",
    line: "#2c2333",
    ink: "#f3edf6",
    faint: "#9a90a4",
  },
};

export function AppearancePicker({ current }: { current: string }) {
  const [, run] = useActionState<FormState, FormData>(saveSkinAction, {});
  // The swatch marks itself chosen straight away. The page behind it
  // repaints a moment later, when the server comes back.
  const [chosen, choose] = useOptimistic(current);

  function pick(id: string) {
    if (id === chosen) return;
    const fd = new FormData();
    fd.set("skin", id);
    startTransition(() => {
      choose(id);
      run(fd);
      toast("Appearance saved.");
    });
  }

  return (
    <div className="grid gap-3 p-4 sm:grid-cols-3">
      {SKINS.map((s) => {
        const w = SWATCH[s.id];
        const on = chosen === s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => pick(s.id)}
            aria-pressed={on}
            aria-label={s.name}
            data-testid="skin-swatch"
            className={cn(
              "rounded-xl border p-2 text-left transition-shadow",
              on ? "border-brand-600 shadow-lift ring-2 ring-brand-100" : "border-line hover:shadow-card",
            )}
          >
            <span className="block overflow-hidden rounded-lg" style={{ background: w.page }}>
              <span className="block h-5" style={{ background: w.header }} />
              <span className="block p-2.5">
                <span
                  className="block rounded-md p-2"
                  style={{ background: w.card, border: `1px solid ${w.line}`, backdropFilter: s.id === "glass" ? "blur(6px)" : undefined }}
                >
                  <span className="block text-3xs font-medium" style={{ color: w.faint }}>
                    Waiting
                  </span>
                  <span className="block font-display text-lg font-semibold leading-none tabular" style={{ color: w.ink }}>
                    14
                  </span>
                </span>
              </span>
            </span>
            <span className="mt-2 flex items-center gap-1.5 px-0.5">
              <span className="font-display text-md font-semibold text-ink">{s.name}</span>
              {on && <span className="rounded-full bg-brand-600 px-1.5 py-px text-3xs font-semibold text-white">On</span>}
            </span>
            <span className="mt-0.5 block px-0.5 text-xs leading-snug text-muted">{s.note}</span>
          </button>
        );
      })}
    </div>
  );
}
