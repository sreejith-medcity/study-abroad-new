"use client";

import { useState, type ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { fsjStepAction } from "@/server/fsj-actions";
import type { FsjOp } from "@/lib/fsj";

/**
 * One FSJ / BFD step's form. Every step posts to the same action with its own
 * "op", the student and the application the page was showing, so a page left
 * open while the file moved on is told to reload rather than acting on a
 * different application.
 */
export function StepForm({
  op,
  studentId,
  applicationId,
  submitLabel,
  pendingLabel = "Saving…",
  secondary = false,
  className,
  children,
}: {
  op: FsjOp;
  studentId: string;
  applicationId: string;
  submitLabel: string;
  pendingLabel?: string;
  secondary?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div data-fsj-op={op}>
      <ActionForm action={fsjStepAction} submitLabel={submitLabel} pendingLabel={pendingLabel} submitVariant={secondary ? "secondary" : "primary"} className={className}>
        <input type="hidden" name="op" value={op} />
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="applicationId" value={applicationId} />
        {children}
      </ActionForm>
    </div>
  );
}

/**
 * Copies an email's text, with its addresses and subject, for the person to
 * paste into their own mail. The portal sends no email itself.
 */
export function CopyEmail({ text, trigger }: { text: string; trigger: string }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
    setTimeout(() => setCopied(null), 2500);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={copy} data-copy-email={trigger} className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2">
        Copy email text
      </button>
      <span role="status" className="text-xs text-muted">
        {copied === "yes" ? "Copied" : copied === "no" ? "Could not reach the clipboard: select the text below and copy it" : ""}
      </span>
    </span>
  );
}
