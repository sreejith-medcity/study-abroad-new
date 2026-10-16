import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/*
  A component rendered on the server and again in the browser must produce the
  same HTML both times. Anything that reads the machine's own clock in local
  time breaks that rule: the server and the browser cross into the next day,
  month or year hours apart, so one of them renders a list one item shorter
  and React throws a hydration error.

  It showed up on the portal as an intermittent React #418 on the apply tab,
  which is the hardest shape of bug to chase: correct all day, wrong for a few
  hours around a boundary, and never on the machine you are testing from.

  This test reads the client components themselves rather than rendering them,
  because the failure only appears at a boundary and a test that waits for the
  turn of a month is not a test.
*/

/** Every file that runs in the browser as well as on the server. */
function clientFiles(): string[] {
  const out = execFileSync("grep", ["-rl", '"use client"', "src", "--include=*.tsx"]).toString().trim();
  return out ? out.split("\n") : [];
}

/*
  The rule, stated so it cannot be argued with: a component that runs in the
  browser does not read the clock. Not the year, not the month, not today's
  date. It is handed the value by the server, or it uses the helpers in
  src/lib/now.ts, which read in UTC and so give every machine the same answer
  at the same instant.

  Date.now() is fine: it is an absolute number, and it is used for timing
  rather than for rendering.
*/
const BARE_NOW = /new Date\(\s*\)/;

test("no client component reads the clock", () => {
  const files = clientFiles();
  assert.ok(files.length > 10, "expected to find the client components");
  const bad: string[] = [];
  for (const f of files) {
    if (f.endsWith("src/lib/now.ts")) continue;
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (BARE_NOW.test(line)) bad.push(`${f}:${i + 1} ${line.trim()}`);
      });
  }
  assert.deepEqual(
    bad,
    [],
    "A client component renders on the server and again in the browser. Reading the clock in each makes the two " +
      "renders disagree around a day, month or year boundary, which React throws as a hydration error. " +
      "Take the value from the server as a prop, or use utcToday / utcYear / utcYearMonth from @/lib/now:\n" +
      bad.join("\n"),
  );
});

test("the apply form is told the month rather than asking its own clock", () => {
  const src = readFileSync("src/app/(app)/students/[id]/applications/client.tsx", "utf8");
  assert.match(src, /todayYm: number/, "ApplyForm should take the month from the server");
  assert.doesNotMatch(src, /const now = new Date\(\)/, "ApplyForm should not read its own clock");
  const page = readFileSync("src/app/(app)/students/[id]/applications/page.tsx", "utf8");
  assert.match(page, /todayYm=\{/, "the page should pass the month down");
});
