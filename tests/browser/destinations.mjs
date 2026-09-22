// Destinations and rankings: the visa living-cost figure and its source reach
// the program and university pages, rankings import from a CSV with line-level
// errors, and search and the universities index sort and filter by them.
// Wants the real catalogue loaded and published (see programs.mjs).
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
const go = async (page, path) => { await page.goto(BASE + path); return main(page); };

const admin = await signIn("admin@medcityoverseas.test", "10.76.1.1");
const ap = admin.page;
let text = await go(ap, "/admin/destinations");
check(/United Kingdom/.test(text) && /GBP 10,539/.test(text) && /Canada/.test(text) && /CAD 23,448/.test(text), "admin: the seeded government figures are listed");
await ap.waitForLoadState("networkidle");
await ap.fill('textarea[name="csv"]', "university,country_code,qs_rank,qs_year,the_rank,the_year\nUniversity of Hull,GB,=580,2026,501-600,2026\nMohawk College,CA,top ten,2026,,\nNo Such Place,GB,100,2026,,");
await ap.getByRole("button", { name: "Save rankings" }).click();
await ap.waitForTimeout(1500);
text = await main(ap);
check(/Rankings saved for 1 university/.test(text) && /line 3: qs_rank "top ten"/.test(text) && /No Such Place: no such university/.test(text), "admin: rankings import, with each skipped line explained");
await ap.reload();
check(/QS 2026 =580 · THE 2026 501-600/.test(await main(ap)), "admin: the ranked list shows it");

const partner = await signIn("kottayam@medcity.test", "10.76.1.2");
const pp = partner.page;
text = await go(pp, "/search?q=MSc+Advanced+Computer+Science&country=GB");
check(/QS 2026 =580/.test(text), "search: the ranking shows with the university");
text = await go(pp, "/search?country=GB&sort=rank");
const firstRow = text.slice(text.indexOf("PROGRAM\t"), text.indexOf("PROGRAM\t") + 600);
check(/University of Hull/.test(firstRow), "search: best ranking first puts Hull at the top");
text = await go(pp, "/universities?top=1000");
check(/1 institution/.test(text) && /University of Hull/.test(text), "universities: the ranking filter");

await go(pp, "/search?q=Hull&country=GB");
await pp.getByRole("link", { name: "MSc Advanced Computer Science" }).first().click();
await pp.waitForURL(/\/programs\//);
text = await main(pp);
check(/Funds to show for the visa\s*GBP 29,894: first-year tuition plus GBP 10,539 living costs/.test(text) && /United Kingdom government figure/.test(text), "program page: tuition plus living funds, with the source");
await pp.getByRole("link", { name: "University page" }).click();
await pp.waitForURL(/\/universities\//);
text = await main(pp);
check(/Rankings\s*QS 2026 =580/.test(text) && /Visa living funds, first year\s*GBP 10,539/.test(text), "university page: rankings and the living-cost figure");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
