/**
 * What a server action does when something throws that it did not plan for.
 *
 * Next.js carries redirect and not-found through the exception path, so those
 * have to go back up untouched or navigation stops working. Everything else
 * used to be rethrown too, and a throw out of a server action reaches the
 * browser as an answer it cannot read: the screen dies with "an unexpected
 * response was received from the server" and the person is told nothing about
 * what they were doing.
 *
 * This turns the rest into something the person can act on, and writes the
 * real cause to the server log where it can be read.
 */
import type { FormState } from "@/lib/form-state";

/** Redirect and not-found are control flow, not failures. */
export function isNavigation(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return false;
  return digest === "NEXT_REDIRECT" || digest.startsWith("NEXT_REDIRECT;") || digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK");
}

/** A not-found thrown inside an action means the record moved out of reach mid-edit. */
function isGone(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404"));
}

export function actionFailure(e: unknown, what: string, context: Record<string, unknown> = {}): FormState {
  if (isGone(e)) {
    console.error(`${what}: no longer reachable by this user`, context);
    return { error: "This file is not open to you any more, or somebody moved it. Reload the page and try again." };
  }
  if (isNavigation(e)) throw e;
  console.error(`${what} failed`, context, e);
  return { error: `${what} did not go through and nothing was saved. Try again, and if it keeps happening tell the Overseas desk what you were doing.` };
}
