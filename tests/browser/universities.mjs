// The universities index: every institution with live programs, filtered by
// destination, level and type, with links through to its page and its programs.
// Wants the catalogue loaded and published (see programs.mjs).
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-universities";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.71.1.1" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', "kottayam@medcity.test");
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

const main = () => page.locator("main").innerText();
const countOf = (t) => Number((t.match(/([\d,]+) institutions?/) || [])[1]?.replace(/,/g, ""));

await page.getByRole("link", { name: "Universities" }).first().click();
await page.waitForURL(/\/universities$/);
let text = await main();
const all = countOf(text);
check(all > 10, `index: lists institutions with live programs (${all})`);
await page.screenshot({ path: `${OUT}/index.png`, fullPage: true });

await page.goto(`${BASE}/universities?country=GB`);
text = await main();
const uk = countOf(text);
check(uk > 0 && uk < all && /United Kingdom/.test(text) && !/Germany/.test(text.split("University\n")[1] ?? ""), `index: a destination narrows the list (${uk})`);

await page.goto(`${BASE}/universities?level=VOCATIONAL`);
text = await main();
check(countOf(text) > 0 && /Ausbildung|Vocational/.test(text) && /Germany/.test(text), "index: a level keeps institutions that teach it");

await page.goto(`${BASE}/universities?q=Hull`);
text = await main();
check(countOf(text) === 1 && /University of Hull/.test(text), "index: search by name");
await page.getByRole("link", { name: "University of Hull" }).click();
await page.waitForURL(/\/universities\/[^?]+$/);
check(/Live programs/.test(await main()), "index: a name opens the university page");

await page.goto(`${BASE}/universities?q=Hull`);
await page.getByRole("link", { name: "Search its programs" }).click();
await page.waitForURL(/\/search\?/);
await page.waitForLoadState("networkidle");
check(/University of Hull/.test(await main()), "index: 'Search its programs' opens search for that university");

await page.goto(`${BASE}/universities?sort=programs`);
const firstTwo = await page.locator("tbody tr td:nth-child(3)").evaluateAll((els) => els.slice(0, 2).map((e) => Number(e.textContent.replace(/,/g, ""))));
check(firstTwo.length === 2 && firstTwo[0] >= firstTwo[1], `index: most programs first (${firstTwo.join(", ")})`);

check(errors.length === 0, `no page errors or 500s ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
