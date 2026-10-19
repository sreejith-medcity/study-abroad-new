"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./ui";

/**
 * A menu that hangs off a button in the header, and shuts itself.
 *
 * Both header menus were plain <details>. A <details> opens when its summary
 * is clicked and closes when it is clicked again, and that is all it does:
 * clicking anywhere else on the page leaves it hanging over whatever you
 * were trying to read, Escape does nothing, and opening the second one
 * leaves the first one open behind it. The notification list was the one
 * that showed, because it is wide and it covers the page it is on.
 *
 * So: a click outside shuts it, Escape shuts it and puts the focus back on
 * the button, opening one shuts the other, and arriving somewhere new shuts
 * whatever is still open, which is what a menu with links in it needs.
 *
 * Still a <details> underneath, so it opens with the keyboard, it reads to a
 * screen reader as the disclosure it is, and it works before the script has
 * run rather than being a button that does nothing.
 */
const OPENED = "medcity:menu-opened";

/**
 * The behaviour on its own, for a <details> menu that brings its own markup.
 *
 * Give it the element and it shuts on a click outside, on Escape, when
 * another menu opens, and when the screen changes. Put onMenuOpen on the
 * element's onToggle so the other menus hear about it.
 */
export function useSelfClosing(ref: { current: HTMLDetailsElement | null }) {
  const path = usePathname();

  useEffect(() => {
    const shut = () => {
      const el = ref.current;
      if (el?.open) el.open = false;
    };
    const away = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        el.open = false;
        el.querySelector("summary")?.focus();
        return;
      }
      if (!el.contains(e.target as Node)) el.open = false;
    };
    // Somebody opened another one. Only one menu at a time, the way every
    // other menu on a computer behaves.
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== ref.current) shut();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", away);
    document.addEventListener(OPENED, other);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", away);
      document.removeEventListener(OPENED, other);
    };
  }, [ref]);

  // Arriving somewhere shuts it. The header does not reload between screens,
  // so without this a menu followed you to the page you picked from it.
  useEffect(() => {
    const el = ref.current;
    if (el?.open) el.open = false;
  }, [path, ref]);
}

/** Tells the other menus one has just opened, from onToggle. */
export function onMenuOpen(e: { currentTarget: HTMLDetailsElement }) {
  if (e.currentTarget.open) document.dispatchEvent(new CustomEvent(OPENED, { detail: e.currentTarget }));
}

export function PopMenu({
  label,
  trigger,
  triggerClassName,
  panelClassName,
  className,
  testId,
  children,
}: {
  /** What the button is called, for a screen reader and for the suites. */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  panelClassName?: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useSelfClosing(ref);

  return (
    <details
      ref={ref}
      className={cn("relative", className)}
      data-testid={testId}
      onToggle={onMenuOpen}
    >
      <summary aria-label={label} className={cn("cursor-pointer list-none [&::-webkit-details-marker]:hidden", triggerClassName)}>
        {trigger}
      </summary>
      <div className={panelClassName}>{children}</div>
    </details>
  );
}
