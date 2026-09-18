/**
 * What a server action hands back to the form that called it. One definition,
 * imported by both sides, so a new field cannot be added to the component and
 * silently missing from the actions.
 */
export type FormState = {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /**
   * Set when the message carries something the person must read and keep, such
   * as a one-time password. Shown as a panel they dismiss, never as a toast.
   */
  keep?: boolean;
};
