// Two small ones from the same list: the learning library takes a slide deck
// and a video now, and the students board asks its questions as dropdowns
// rather than three rows of pills.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
const title = `Ausbildung briefing ${Math.random().toString(36).slice(2, 6)}`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.238.4.11" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

// A slide deck goes into the library.
await page.goto(`${BASE}/learning`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const add = page.locator("details").filter({ hasText: /add a resource|new resource|add resource/i }).first();
if (await add.count()) await add.locator("summary").first().click().catch(() => {});
await page.waitForTimeout(400);
const form = page.locator("form", { has: page.locator('input[name="file"]') }).first();
check((await form.count()) > 0, "the library has an upload form");

const accept = await form.locator('input[name="file"]').getAttribute("accept");
check(/pptx/.test(accept ?? ""), `slide decks are offered (${accept?.slice(0, 40)})`);
check(/mp4/.test(accept ?? ""), "and video");

await form.locator('input[name="title"]').fill(title);
for (const box of await form.locator('input[type="checkbox"][name^="audience_"]').all()) {
  await box.check().catch(() => {});
  break;
}
await form.locator('input[name="file"]').setInputFiles({
  name: "briefing.pptx",
  mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  buffer: Buffer.from("PK\u0003\u0004 a deck, near enough for the type check"),
});
await form.getByRole("button", { name: /save|add/i }).first().click();
await page.waitForTimeout(2500);
const saved = sql(`select count(*) from resources where title = '${title}'`);
check(saved === "1", "the deck is in the library");
check(
  saved !== "1" || sql(`select mime_type from resources where title = '${title}'`).includes("presentationml"),
  "kept as a slide deck rather than refused",
);

// The board asks with dropdowns.
await page.goto(`${BASE}/students/board`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
// The filters apply the moment they change, so there is no form around them
// and no Apply button any more. What was asked for is dropdowns, and that is
// what is counted.
const selects = await page.locator('main select[name="branch"], main select[name="who"], main select[name="team"], main select[name="quiet"]').count();
check(selects >= 2, `the board filters are dropdowns (${selects} of them)`);
const pills = await page.locator("a.rounded-full").count();
check(pills === 0, `and the wall of pills is gone (${pills} left)`);
const screens = await page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
check(screens < 3, `the board is under three screens (${screens.toFixed(1)})`);

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
