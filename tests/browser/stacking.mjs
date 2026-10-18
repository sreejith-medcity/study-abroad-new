// The three screens that were walls of controls.
//
// Students by stage had its branch, counsellor and team choices as a grid of
// labelled selects with its own Show button. Search programs put eleven
// controls in one grid, so the four somebody actually reaches for were lost
// among them. The course finder asked sixteen destinations, nine levels and
// three intakes as ticks, nearly thirty controls stacked above the scores,
// and the scores are what somebody came to fill in.
import { chromium } from "playwright";
import { knownWarning } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.231.6.9" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(`${page.url().replace(BASE, "")}: ${String(e).slice(0, 90)}`); });
await page.goto(`${BASE}/login`);
// The busiest branch, so the board has something on it: "0 of 0" would pass
// every check below without proving anything.
await page.fill('input[name="email"]', sql(`
  select u.email from users u join organizations o on o.id = u.org_id
  where u.role = 'PARTNER' and u.active and o.type <> 'HQ'
  order by (select count(*) from students s where s.org_id = o.id and not s.archived) desc, u.email limit 1`));
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

// ---- Students by stage ----
await page.goto(`${BASE}/students/board`);
await page.waitForTimeout(900);
check((await page.locator("main form button", { hasText: "Show these" }).count()) === 0, "by stage: the board applies a choice itself, with no Show button");
const contact = page.locator('main select[name="quiet"]');
check((await contact.count()) === 1, "by stage: the choices are dropdowns on the bar");
const everyone = Number((await page.locator("main").innerText()).match(/of (\d+) on the board/)?.[1] ?? 0);
check(everyone > 0, `by stage: the board says how many it is drawing (${everyone})`);
await contact.selectOption("1");
await page.waitForTimeout(1500);
check(/1 filter on/i.test(await page.locator("main").innerText()), "by stage: what is on is said as a chip you can take off");
check(page.url().includes("quiet=1"), "by stage: and it is in the address, so the view can be sent to somebody");

// ---- Search programs ----
await page.goto(`${BASE}/search`);
await page.waitForTimeout(900);
// Not the first <details> on the page: the level and season pickers are
// dropdowns built the same way, and they come first.
const fold = page.locator('[data-testid="search-fold"]');
check((await fold.count()) === 1, "search: the secondary filters are behind a fold");
check(!(await fold.evaluate((d) => d.open)), "search: which is shut when nothing in it is on");
for (const name of ["q", "country"]) {
  check((await page.locator(`main form > div:first-of-type [name="${name}"]`).count()) > 0, `search: ${name} stays out of the fold`);
}
check((await fold.locator('select[name="budget"]').count()) === 1, "search: and the tuition budget goes into it");

// Every row of the results says "Pick a student to apply". The control that
// does it was folded away with the filters, so the instruction pointed at
// something nobody could see. It is not a filter and it does not fold.
check(
  (await page.locator('#pick-student input[role="combobox"]').isVisible()) === true,
  "search: the student picker is on the bar, not behind the fold",
);
check(
  (await fold.locator("#pick-student").count()) === 0,
  "search: and cannot be folded away again",
);
const prompt = page.locator('main a[href="#pick-student"]').first();
check((await prompt.count()) > 0, "search: and the row's prompt is a link to it rather than a sentence about it");

// A filter that is on but folded would be invisible, so the fold opens itself.
await page.goto(`${BASE}/search?budget=15`);
await page.waitForTimeout(900);
const fold2 = page.locator('[data-testid="search-fold"]');
check(await fold2.evaluate((d) => d.open), "search: a folded filter that is on opens the fold rather than hiding");
check(/\(1 on\)|Fewer filters/.test(await page.locator('[data-testid="search-fold"] > summary').innerText()), "search: and the fold says so on its face");

// ---- Course finder ----
await page.goto(`${BASE}/finder`);
await page.waitForTimeout(900);
for (const id of ["finder-country", "finder-level", "finder-season"]) {
  check((await page.locator(`[data-testid="${id}"]`).count()) === 1, `finder: ${id.replace("finder-", "")} is a dropdown`);
}
const main = await page.locator("main").innerText();
check(!/Australia\s+\d+[\s\S]{0,40}Austria/.test(main), "finder: the destinations are not a wall of ticks any more");
// Ticking one inside the dropdown still files through the form.
await page.locator('[data-testid="finder-country"] summary').click();
await page.locator('[data-testid="finder-country"] input[value="DE"]').check();
await page.locator('[data-testid="finder-country"] summary').click();
await page.locator("main form button[type=submit]", { hasText: /Show|Find|Search/ }).first().click().catch(() => {});
await page.waitForTimeout(2000);
check(page.url().includes("country=DE") || (await page.locator("main").innerText()).includes("Germany"), "finder: a destination ticked in the dropdown reaches the search");

check(errors.length === 0, `no client errors ${errors.slice(0, 2).join(" | ")}`);
await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
