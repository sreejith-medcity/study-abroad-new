"use client";

import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";

/**
 * The read-only wrapper on a student file, with named tabs left open.
 *
 * Finance reads a student's file and changes nothing on it, except their
 * fees: that is the one screen of the file that is finance's own work. The
 * file's layout cannot see which tab is open, so this asks the router and
 * leaves the named tabs out of the disabled fieldset.
 */
export function ReadOnlyGate({ children, writable, notice }: { children: ReactNode; writable: string[]; notice: ReactNode }) {
  const segment = useSelectedLayoutSegment();
  if (segment && writable.includes(segment)) return <>{children}</>;
  return (
    <>
      {notice}
      <fieldset disabled className="mt-4 w-full min-w-0 border-0 p-0">
        {children}
      </fieldset>
    </>
  );
}
