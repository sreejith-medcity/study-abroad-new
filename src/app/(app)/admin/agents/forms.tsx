"use client";

import { Button } from "@/components/ui";
import { startReviewAction } from "@/server/agent-actions";

/**
 * Picking an application up, so two people at the desk do not both ring the same
 * applicant. One click, no dialog.
 */
export function StartReview({ applicationId }: { applicationId: string }) {
  return (
    <form action={startReviewAction}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <Button variant="quiet" className="py-1 text-xs">
        I am looking at this
      </Button>
    </form>
  );
}
