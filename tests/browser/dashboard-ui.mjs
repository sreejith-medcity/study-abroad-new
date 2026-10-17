// What a dashboard does when there is not much to show yet.
//
// A branch with one live application was given eight tiles, seven of them a
// nought, a funnel of empty bars, and a two-colour chart whose second colour
// was the brand yellow at 1.2 to 1 against a white card. Most branches look
// like that most of the time, so this is the normal state, not the edge.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

// The quietest branch there is: the one with the fewest applications.
const email = sql(`
  select u.email from users u join organizations o on o.id = u.org_id
  where u.role = 'PARTNER' and u.active and o.type <> 'HQ'
  order by (select count(*) from applications a where a.org_id = o.id) asc
  limit 1`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.236.1.6" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
await page.goto(`${BASE}/dashboard`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(600);

const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");

/*
  The board of figures.

  This used to fold the noughts away and say them in a line, to keep the row
  short. It was the wrong trade on the one screen everybody opens first: a
  board that changes shape between Monday and Tuesday cannot be read by
  position, and reading by position is the whole way somebody uses it. Every
  figure is drawn now, in the same order every day, with a nought dimmed so
  the eye slides past it.
*/
const LABELS = ["All applications", "Needs your action", "Offers", "Visa received", "Fees paid", "Deferrals", "Non-enrolment", "Visa rejected"];
// Scoped to the board itself: the funnel further down the page links to the
// same screens with some of the same words, and used to be counted as part of it.
const board = page.locator("main [data-kpi-board] a");
const drawn = await board.evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
check(drawn.length === LABELS.length, `every figure is drawn, nought or not (${drawn.length} of ${LABELS.length})`);
check(
  LABELS.every((label, i) => (drawn[i] ?? "").startsWith(label)),
  `and always in the same order, so it can be read by position (${drawn.map((d) => d.replace(/\d+$/, "")).join(" | ")})`,
);

// A nought is drawn but quietened, rather than shouting alongside a real
// figure. Read off the figure itself rather than the tile's run-together
// text, which is how this was got wrong the first time.
const cells = await board.evaluateAll((els) =>
  els.map((e) => {
    const n = e.querySelector("p.tabular");
    return { value: (n?.textContent ?? "").trim(), colour: n ? getComputedStyle(n).color : "" };
  }),
);
const zeros = cells.filter((c) => c.value === "0");
const figures = cells.filter((c) => c.value !== "0");
if (zeros.length > 0 && figures.length > 0) {
  check(
    zeros.every((z) => z.colour !== figures[0].colour),
    `a nought is set quieter than a figure (${zeros[0].colour} against ${figures[0].colour})`,
  );
} else if (zeros.length === cells.length) {
  check(true, `this branch is at nought across the board, so there is nothing to tell apart (${cells.length} tiles)`);
} else {
  check(true, "nothing is at nought on this data");
}

// The filters are on the page rather than behind a fold: narrowing to one
// intake is the first thing somebody does, and a filter you have to go
// looking for is a filter nobody uses.
check((await page.locator("#narrow").count()) === 0, "the filters are not hidden behind a fold any more");
check((await page.locator('main select[name="intakeMonth"]').count()) === 1, "and the intake filter is on the page");

// The chart says what its height means, and its second colour can be seen.
const chart = page.locator("figure").first();
if (await chart.count()) {
  const text = await chart.innerText();
  check(/\d/.test(text), "the chart carries a scale rather than bare bars");
  const blue = await chart.locator(".bg-info-500").count();
  const yellow = await chart.locator(".bg-gold-400").count();
  check(yellow === 0, "the near-invisible yellow series is gone");
  check(blue > 0, "and the second series is the blue that passes the colour checks");
} else {
  check(/No applications|No visas/i.test(body), "a stretch with nothing in it says so instead of drawing an empty chart");
}

// A funnel with nothing through it says so rather than drawing empty bars.
// Careful: 100% is a real answer and ends in "0%".
check(!/(^|[^0-9])0%/.test(body), "no 0% is printed under a nought");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
