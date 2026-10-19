"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Card, Input } from "@/components/ui";

/**
 * The partners screen used to stack every organisation open, with every one of
 * its people underneath. Nineteen branches made it fifteen screens of
 * scrolling to reach the last one, almost all of it rows nobody was looking
 * for.
 *
 * Each organisation now folds. What the desk scans without opening anything is
 * on the summary line: the tier, the seats, the students, and whatever that
 * branch still needs doing. Folding hides names from the browser's own find,
 * so the box at the top searches the people too: type a name or an email and
 * only the organisations holding it stay on screen, already open.
 */
const Query = createContext("");

export function OrgList({ count, children }: { count: number; children: ReactNode }) {
  const [q, setQ] = useState("");
  const id = useId();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={id} className="sr-only">
          Find an organisation or a person
        </label>
        <Input
          id={id}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a branch, a sub-agent or a person"
          className="max-w-xs py-2 text-sm"
        />
        <p className="text-xs text-muted">
          {count} {count === 1 ? "organisation" : "organisations"}. Open one to see its people.
        </p>
      </div>
      <Query.Provider value={q.trim().toLowerCase()}>
        <div className="space-y-3">{children}</div>
      </Query.Provider>
    </div>
  );
}

export function OrgFold({
  id,
  title,
  meta,
  attention,
  defaultOpen,
  haystack,
  children,
}: {
  id: string;
  title: string;
  meta: string;
  attention?: string | null;
  defaultOpen: boolean;
  haystack: string;
  children: ReactNode;
}) {
  const q = useContext(Query);
  const [open, setOpen] = useState(defaultOpen);
  const searching = q.length > 1;
  const hit = searching && haystack.includes(q);
  if (searching && !hit) return null;
  const isOpen = searching ? true : open;

  return (
    <Card id={id} className="scroll-mt-20 overflow-hidden">
      <details open={isOpen} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-ground">
          <span className="font-semibold text-brand-700">{title}</span>
          {attention && <span className="text-xs font-medium text-stop-500">{attention}</span>}
          <span className="text-xs text-muted">{meta}</span>
          <span className="ml-auto text-xs text-muted">{isOpen ? "Hide" : "Show"}</span>
        </summary>
        <div className="border-t border-line">{children}</div>
      </details>
    </Card>
  );
}
