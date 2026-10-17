import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { groupInr } from "../src/lib/format";

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

/*
  The same trap, with numbers. toLocaleString("en-IN") groups in lakhs only
  if the machine running it has the full set of locale data compiled in.
  Node is often built without it, so the server writes 1,234,567 where the
  browser writes 12,34,567: one number, two strings, and React throws out
  the page. groupInr in @/lib/format writes the grouping out and gives one
  answer everywhere.
*/
const LOCALE_FORMAT = /toLocale(String|DateString|TimeString)\(|Intl\.(NumberFormat|DateTimeFormat)/;

test("no client component formats a number or a date by locale", () => {
  const bad: string[] = [];
  for (const f of clientFiles()) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (LOCALE_FORMAT.test(line)) bad.push(`${f}:${i + 1} ${line.trim()}`);
      });
  }
  assert.deepEqual(
    bad,
    [],
    "These run on the server and again in the browser, and the two only agree on locale formatting if the " +
      "server's Node was built with the full locale data. Use groupInr or the fmt helpers from @/lib/format:\n" +
      bad.join("\n"),
  );
});

/*
  A client component can read the clock without writing new Date() itself: it
  calls a helper that does. daysUntil in @/lib/catalogue defaults its second
  argument to new Date(), so a component that calls it with one argument is
  asking the browser what today is, through one more layer. That is how the
  apply tab kept its mismatch after the obvious ones were taken out.
*/
test("no client component reaches the clock through a helper", () => {
  // The helpers in src/lib that fall back to the current date AND read it in
  // local time. One that reads it in UTC is safe: every machine gets the same
  // answer at the same instant, which is the whole point of the helpers in
  // src/lib/now.ts.
  const risky = new Set<string>();
  for (const f of execFileSync("sh", ["-c", "ls src/lib/*.ts"]).toString().trim().split("\n")) {
    if (f.endsWith("src/lib/now.ts")) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/export function (\w+)\(([\s\S]*?)\)\s*[:{]([\s\S]*?)\n\}/g)) {
      const [, name, params, body] = m;
      if (!/=\s*new Date\(\s*\)/.test(params)) continue;
      if (/\.get(FullYear|Month|Date|Day|Hours|Minutes)\(/.test(body)) risky.add(name);
    }
  }
  assert.ok(risky.size > 0, "expected to find helpers that default to the current date");

  const bad: string[] = [];
  for (const f of clientFiles()) {
    const src = readFileSync(f, "utf8");
    src.split("\n").forEach((line, i) => {
      for (const name of risky) {
        // Called with one argument, so the date it compares against is the
        // browser's own idea of today.
        const called = new RegExp(`\\b${name}\\(([^(),]|\\([^()]*\\))*\\)`);
        const m = line.match(called);
        if (m && !m[0].includes(",")) bad.push(`${f}:${i + 1} ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    bad,
    [],
    "These call a helper that falls back to the current date, in a component that renders on the server and " +
      "again in the browser. Pass the date down from the server instead:\n" + bad.join("\n"),
  );
});

test("groupInr groups the way this country reads numbers", () => {
  const cases: [number, string][] = [
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [12345, "12,345"],
    [100000, "1,00,000"],
    [1234567, "12,34,567"],
    [123456789, "12,34,56,789"],
    [-1234567, "-12,34,567"],
    [1234.5, "1,234.5"],
  ];
  for (const [n, want] of cases) assert.equal(groupInr(n), want, `groupInr(${n})`);
});

test("the apply form is told the month rather than asking its own clock", () => {
  const src = readFileSync("src/app/(app)/students/[id]/applications/client.tsx", "utf8");
  assert.match(src, /todayYm: number/, "ApplyForm should take the month from the server");
  assert.doesNotMatch(src, /const now = new Date\(\)/, "ApplyForm should not read its own clock");
  const page = readFileSync("src/app/(app)/students/[id]/applications/page.tsx", "utf8");
  assert.match(page, /todayYm=\{/, "the page should pass the month down");
});
