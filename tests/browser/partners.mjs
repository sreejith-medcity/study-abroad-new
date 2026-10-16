// The partners screen folds each organisation away, says enough about a
// folded one to answer the usual question, and searches the people inside the
// folds.
//
// Written after the screen was fifteen screens tall with nineteen
// organisations on it, every one of them stacked open.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
const orgCount = Number(sql("select count(*) from organizations"));
// Somebody in a branch, so the search has to reach inside a fold to find them.
const hidden = sql(`
  select u.name from users u join organizations o on o.id = u.org_id
  where o.type <> 'HQ' and u.role <> 'STUDENT' and u.active and not u.must_change_password
  order by u.name limit 1`);
const hiddenOrg = sql(`
  select o.name from users u join organizations o on o.id = u.org_id
  where o.type <> 'HQ' and u.role <> 'STUDENT' and u.active and not u.must_change_password
  order by u.name limit 1`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.250.4.9" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/admin/partners`);
await page.waitForTimeout(400);

const folds = page.locator("[id^='org-'] > details");
const foldCount = await folds.count();
check(foldCount === orgCount, `every organisation is a fold (${foldCount} of ${orgCount})`);
if (!foldCount) {
  console.log("\nnothing folds on this screen, so the rest cannot be checked");
  await browser.close();
  process.exit(1);
}

const open = await folds.evaluateAll((ds) => ds.filter((d) => d.open).length);
check(open > 0 && open < foldCount, `not everything is stacked open (${open} of ${foldCount} open)`);

// The head office is the desk's own team, so it is the one that starts open.
check(await folds.first().evaluate((d) => d.open), "the head office starts open");

// A folded organisation still has to answer the usual question without being
// opened: which tier, how many seats, how many students.
const closed = page.locator("[id^='org-'] > details:not([open]) > summary").first();
const line = (await closed.innerText()).replace(/\s+/g, " ");
check(/seats/.test(line) && /students/.test(line), `a folded branch still says its seats and students (${line.slice(0, 90)})`);

// Fifteen screens was the complaint. Anything near that again is a regression.
const screens = await page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
check(screens < 6, `the screen is under six screens tall (${screens.toFixed(1)})`);

// Folding hides names from the browser's own find, so the box has to search
// the people inside the folds.
await page.fill("input[placeholder*='Find a branch']", hidden);
await page.waitForTimeout(300);
const left = await page.locator("[id^='org-']").count();
check(left >= 1 && left < orgCount, `searching a branch person narrows the list to ${left}`);
check(await page.locator("[id^='org-'] > details").first().evaluate((d) => d.open), "the organisation found by the search is open");
check((await page.locator("[id^='org-']").first().innerText()).includes(hiddenOrg), `the one left is ${hiddenOrg}`);
check((await page.locator("[id^='org-'] li").filter({ hasText: hidden }).count()) >= 1, `${hidden} is on screen`);

// Clearing it puts everything back.
await page.fill("input[placeholder*='Find a branch']", "");
await page.waitForTimeout(300);
check((await page.locator("[id^='org-']").count()) === orgCount, "clearing the search brings every organisation back");

// Nonsense finds nobody rather than showing everybody.
await page.fill("input[placeholder*='Find a branch']", "zzqqxx");
await page.waitForTimeout(300);
check((await page.locator("[id^='org-']").count()) === 0, "a search matching nobody shows nothing");
await page.fill("input[placeholder*='Find a branch']", "");
await page.waitForTimeout(300);

// Opening a fold has to show the controls that live inside it.
const shut = page.locator("[id^='org-'] > details:not([open])").first();
const id = await shut.evaluate((d) => d.parentElement.id);
await page.locator(`#${id} > details > summary`).click();
await page.waitForTimeout(250);
check(await page.locator(`#${id} > details`).evaluate((d) => d.open), "clicking a folded organisation opens it");
check((await page.locator(`#${id} select[name='tier']`).count()) === 1, "the tier and seats form is inside the fold");
check((await page.locator(`#${id} li`).count()) >= 1, "its people are inside the fold");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
