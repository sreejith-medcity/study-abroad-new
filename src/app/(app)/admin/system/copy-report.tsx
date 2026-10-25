"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { toast } from "@/components/toast";

/**
 * Puts the text report on the clipboard. The browser may refuse (a page not on
 * https, or a permission the person declined), so the same text is also behind
 * "Show as text", where it can be selected and copied the old way.
 */
export function CopyReport({ text }: { text: string }) {
  const [shown, setShown] = useState(false);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("No clipboard access");
      await navigator.clipboard.writeText(text);
      toast("Report copied. Paste it into a message.");
    } catch {
      setShown(true);
      toast("The browser would not give clipboard access. The report is shown below; select it and copy.", "info");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={copy}>
          Copy report
        </Button>
        <Button type="button" variant="secondary" onClick={() => setShown((v) => !v)} aria-expanded={shown}>
          {shown ? "Hide the text" : "Show as text"}
        </Button>
      </div>
      {shown && (
        <pre data-system-report className="max-h-[480px] overflow-auto rounded-lg border border-line bg-surface-2 p-4 text-xs leading-relaxed text-ink whitespace-pre-wrap">
          {text}
        </pre>
      )}
    </div>
  );
}
