"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Card, cn } from "@/components/ui";

/**
 * One foldable part of a long screen.
 *
 * The student profile stacked every section open, so a finished file was four
 * and a half screens of scrolling to reach anything at the bottom, almost all
 * of it already filled in and read-only. A section that is done folds away; a
 * section that still wants something stays open, so the work left is what is
 * on screen.
 *
 * The jump links at the top of the page still work: a section opens itself
 * when the address bar points at it, whether that is from a click or from
 * somebody arriving on the link.
 */
export function Section({
  id,
  title,
  state,
  defaultOpen,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  state?: "Complete" | "Incomplete" | "Optional" | null;
  defaultOpen: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const openIfTargeted = () => {
      if (window.location.hash === `#${id}`) setOpen(true);
    };
    openIfTargeted();
    window.addEventListener("hashchange", openIfTargeted);
    return () => window.removeEventListener("hashchange", openIfTargeted);
  }, [id]);

  return (
    <Card id={id} className={cn("scroll-mt-20 overflow-hidden", className)}>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 hover:bg-ground">
          <span className="font-semibold text-brand-700">{title}</span>
          {state && (
            <span className={cn("text-xs", state === "Complete" ? "text-emerald-700" : state === "Optional" ? "text-muted" : "text-red-600")}>{state}</span>
          )}
          <span className="ml-auto text-xs text-muted">{open ? "Hide" : "Show"}</span>
        </summary>
        <div className="border-t border-line p-5">{children}</div>
      </details>
    </Card>
  );
}
