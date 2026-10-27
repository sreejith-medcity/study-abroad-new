"use client";

import type { ReactNode } from "react";
import { ActionForm } from "@/components/action-form";
import { auPairStepAction } from "@/server/au-pair-actions";
import type { AuPairOp } from "@/lib/au-pair";

/**
 * One Au pair step's form, as the FSJ / BFD tab has them: every step posts to
 * the same action with its own "op", the student and the application the
 * page was showing, so a page left open while the file moved on is told to
 * reload rather than acting on a different application.
 */
export function AuPairForm({
  op,
  studentId,
  applicationId,
  submitLabel,
  secondary = false,
  className,
  children,
}: {
  op: AuPairOp;
  studentId: string;
  applicationId: string;
  submitLabel: string;
  secondary?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div data-au-pair-op={op}>
      <ActionForm action={auPairStepAction} submitLabel={submitLabel} pendingLabel="Saving…" submitVariant={secondary ? "secondary" : "primary"} className={className}>
        <input type="hidden" name="op" value={op} />
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="applicationId" value={applicationId} />
        {children}
      </ActionForm>
    </div>
  );
}
