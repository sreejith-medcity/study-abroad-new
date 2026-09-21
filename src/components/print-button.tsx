"use client";

import { Button } from "./ui";

export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button type="button" size="sm" variant="secondary" onClick={() => window.print()} data-print="hide">
      {label}
    </Button>
  );
}
