"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

export function StepTabs({ steps }: { steps: { href: string; label: string; done?: boolean }[] }) {
  const path = usePathname();
  return (
    <ol className="flex items-center gap-2" aria-label="Student file steps">
      {steps.map((s, i) => {
        const active = path.startsWith(s.href);
        return (
          <li key={s.href} className="flex flex-1 items-center gap-2 last:flex-none">
            <Link href={s.href} aria-current={active ? "step" : undefined} className="flex items-center gap-2">
              <span className={cn("grid size-8 place-items-center rounded-full border text-sm font-semibold", active ? "border-brand-600 bg-brand-600 text-white" : s.done ? "border-emerald-600 text-emerald-700" : "border-line bg-white text-muted")}>
                {s.done && !active ? "✓" : i + 1}
              </span>
              <span className={cn("hidden sm:inline", active ? "font-semibold text-ink" : "text-muted")}>{s.label}</span>
            </Link>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-line" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** Horizontal section tabs, used for settings and any page with a few panels. */
export function SubTabs({ tabs, label = "Sections" }: { tabs: { href: string; label: string }[]; label?: string }) {
  const path = usePathname();
  return (
    <div className="thin-scroll -mx-1 overflow-x-auto px-1">
      <nav aria-label={label} className="inline-flex min-w-max gap-1 rounded-xl border border-line bg-surface p-1 shadow-card">
        {tabs.map((tab) => {
          const active = path === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors",
                active ? "bg-brand-600 text-white shadow-sm" : "text-ink-soft hover:bg-surface-2 hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
