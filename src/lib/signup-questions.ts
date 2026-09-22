import type { SignupQuestion } from "@/db/schema";

export const MAX_SIGNUP_QUESTIONS = 6;
export const SIGNUP_KIND_LABEL = { text: "Short answer", choice: "Pick one", yesno: "Yes or no" } as const;

/** Checks an answer against its question; returns the error to show, or null. */
export function answerError(q: SignupQuestion, raw: string | null): string | null {
  const v = (raw ?? "").trim();
  if (!v) return q.required ? "Please answer this" : null;
  if (v.length > 300) return "Please keep it under 300 characters";
  if (q.kind === "choice" && !q.options.includes(v)) return "Please pick one of the options";
  if (q.kind === "yesno" && v !== "Yes" && v !== "No") return "Please answer yes or no";
  return null;
}
