/**
 * The day-to-day layer: what somebody has to do today, and what was said to a
 * student last week.
 *
 * A counsellor on the phone all day will not fill in forms, so everything here
 * asks for the least that is still worth having. Pure, so the same rules decide
 * a desk, a student file and a test.
 */

import type { ContactChannel, ContactOutcome, JourneyStage, TaskKind } from "@/db/schema";

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  FOLLOW_UP: "Follow up",
  DOCUMENT: "Documents",
  APPLICATION: "Application",
  CALL: "Call",
  VISIT: "Visit",
  PAYMENT: "Payment",
  OTHER: "Something else",
};

export const CHANNEL_LABEL: Record<ContactChannel, string> = {
  CALL: "Call",
  WHATSAPP: "WhatsApp",
  VISIT: "Visit",
  EMAIL: "Email",
  SMS: "SMS",
};

export const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  REACHED: "Spoke to them",
  NO_ANSWER: "No answer",
  WILL_SEND: "They will send it",
  WANTS_TIME: "They want more time",
  NEEDS_COUNSELLING: "Wants to talk it through",
  NOT_INTERESTED: "Not interested for now",
  WRONG_NUMBER: "Wrong number",
  OTHER: "Something else",
};

/**
 * How many days later the portal suggests looking again, by what came of the
 * call. A suggestion only: the counsellor sets the date, and they know whether
 * this family needs two days or two weeks.
 */
export const SUGGESTED_FOLLOW_UP: Record<ContactOutcome, number | null> = {
  REACHED: 7,
  NO_ANSWER: 1,
  WILL_SEND: 3,
  WANTS_TIME: 14,
  NEEDS_COUNSELLING: 2,
  NOT_INTERESTED: 30,
  WRONG_NUMBER: null,
  OTHER: 7,
};

/** The day a follow-up falls on, from what came of the conversation. */
export function suggestedFollowUp(outcome: ContactOutcome, from = new Date()): string | null {
  const days = SUGGESTED_FOLLOW_UP[outcome];
  if (days == null) return null;
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type When = "OVERDUE" | "TODAY" | "TOMORROW" | "THIS_WEEK" | "LATER";

export const WHEN_LABEL: Record<When, string> = {
  OVERDUE: "Overdue",
  TODAY: "Today",
  TOMORROW: "Tomorrow",
  THIS_WEEK: "This week",
  LATER: "Later",
};

/** Which heading a task belongs under on a desk. */
export function whenDue(dueOn: Date | string, today = new Date()): When {
  const due = dueOn instanceof Date ? dueOn : new Date(dueOn);
  const d0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const d1 = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const days = Math.round((d1 - d0) / 86_400_000);
  if (days < 0) return "OVERDUE";
  if (days === 0) return "TODAY";
  if (days === 1) return "TOMORROW";
  return days <= 7 ? "THIS_WEEK" : "LATER";
}

export const WHEN_ORDER: When[] = ["OVERDUE", "TODAY", "TOMORROW", "THIS_WEEK", "LATER"];

/**
 * The keys the portal raises its own tasks under. One fact, one key, so the
 * same thing never lands on a desk twice however often the chasing runs.
 */
export const autoKeys = {
  documentSilent: (itemId: string) => `document-silent:${itemId}`,
  vendorQuiet: (applicationId: string, since: string) => `vendor-quiet:${applicationId}:${since}`,
  gateClear: (studentId: string, stage: JourneyStage) => `gate-clear:${studentId}:${stage}`,
  callFollowUp: (contactId: string) => `call-follow-up:${contactId}`,
};

/** Everything on one feed, whatever table it came from. */
export type TimelineKind =
  | "CONTACT"
  | "COMMENT"
  | "DOCUMENT"
  | "CHECKLIST"
  | "REQUEST"
  | "STATUS"
  | "VENDOR_UPDATE"
  | "HANDOVER"
  | "STAGE"
  | "TASK"
  | "PAYMENT"
  | "APPLICATION";

export type TimelineEntry = {
  id: string;
  at: Date;
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  who?: string | null;
  href?: string | null;
};

export const TIMELINE_LABEL: Record<TimelineKind, string> = {
  CONTACT: "Conversation",
  COMMENT: "Message",
  DOCUMENT: "Document",
  CHECKLIST: "Documentation",
  REQUEST: "Asked the student",
  STATUS: "Status",
  VENDOR_UPDATE: "From the vendor",
  HANDOVER: "Hand-over",
  STAGE: "Stage",
  TASK: "Task",
  PAYMENT: "Payment",
  APPLICATION: "Application",
};

/** Newest first, and a stable order where two things happened in the same second. */
export const byNewest = (a: TimelineEntry, b: TimelineEntry) => b.at.getTime() - a.at.getTime() || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
