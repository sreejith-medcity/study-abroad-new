"use client";

import { ActionForm } from "@/components/action-form";
import { runRemindersAction } from "@/server/documentation-actions";

/**
 * The chasing, run now. It normally happens on a schedule; this is here so the
 * team can see what it would do, and so a quiet afternoon can be put to use.
 */
export function RunReminders() {
  return (
    <ActionForm action={runRemindersAction} submitLabel="Run the chasing now" pendingLabel="Chasing…" submitVariant="secondary">
      <p className="sr-only">Sends reminders that are due, tells counsellors about anything a week old, and flags what runs out too early.</p>
    </ActionForm>
  );
}
