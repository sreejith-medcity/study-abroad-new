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

// The noughts are said once, in a line, rather than eight times in tiles.
const tiles = await page.locator("main a[href^='/applications?']").filter({ hasText: /^(All applications|Needs your action|Offers|Visa received|Fees paid|Deferrals|Non-enrolment|Visa rejected)/ }).count();
check(tiles <= 4, `the tile row is short (${tiles} tiles)`);
check(/Nothing yet in/.test(body), "and what is empty is said in one line");
check(/All applications/.test(body) && /Needs your action/.test(body), "the two that matter keep their tiles whatever they read");

// The filters are there, folded, with the numbers first.
const narrow = page.locator("#narrow");
check((await narrow.count()) === 1, "the filters fold into Narrow this");
check(!(await narrow.locator("details").evaluate((d) => d.open)), "and start folded when nothing is narrowed");

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
