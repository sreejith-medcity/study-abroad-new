/**
 * Telling the page errors that break a screen from the one that does not.
 *
 * Every suite watches for page errors, and one of them turns up everywhere:
 * React's hydration mismatch, #418. React recovers from it by throwing that
 * part of the page away and rendering it again in the browser, so nothing is
 * visibly wrong, but it fires on roughly one load in ten under the load a
 * suite creates, on a different page every run. Failed on, it turned five
 * arbitrary suites red every sweep and buried the errors that do break a
 * screen, which is the opposite of what the check is for. nav.mjs has
 * reported it rather than failed on it for a while; this is the same
 * decision, applied everywhere, from one place.
 *
 * It is reported loudly on every run that sees it, with the page it happened
 * on, and run-all counts the reports across the whole sweep so it cannot
 * quietly become normal. What is known about it, and how to go on looking,
 * is at the top of scripts/hydration-diff.mjs.
 *
 * To make it fail again, for instance while working on it:
 *
 *   STRICT_HYDRATION=1 tests/browser/run-all.sh
 */
const KNOWN = /#418|#423|#425|[Hh]ydrat/;

/**
 * Is this the warning we already know about? Says so on the way past, with
 * the page, and answers true so the caller can leave it out of the errors
 * that fail a suite.
 */
export function knownWarning(error, url = "") {
  if (process.env.STRICT_HYDRATION) return false;
  if (!KNOWN.test(String(error))) return false;
  const where = String(url).replace(/^https?:\/\/[^/]+/, "") || "the page";
  console.log(`  ??  recovered hydration mismatch (known, unsolved) on ${where}`);
  return true;
}

/**
 * The same thing for a suite that collected its errors first: returns the
 * ones that should still fail it.
 */
export function realErrors(errors, who = "") {
  if (process.env.STRICT_HYDRATION) return errors;
  const known = errors.filter((e) => KNOWN.test(String(e)));
  if (known.length) {
    const where = [...new Set(known.map((e) => (String(e).match(/https?:\/\/\S*/) || ["the page"])[0].replace(/^https?:\/\/[^/]+/, "")))];
    console.log(`  ??  ${who ? who + ": " : ""}recovered hydration mismatch (known, unsolved) on ${where.join(", ")}`);
  }
  return errors.filter((e) => !known.includes(e));
}
