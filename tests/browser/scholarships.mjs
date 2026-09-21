// Scholarships: an admin adds one (and cannot add one without its source),
// partners see it on the university and program pages and can filter search
// by it, and pausing or an expired deadline hides it again.
// Wants the real catalogue loaded and published.
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-scholarships";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p); return main(page); }
const count = (t) => Number((t.match(/([\d,]+) live programs?/) || [])[1]?.replace(/,/g, "") ?? -1);

const admin = await signIn("admin@medcityoverseas.test", "10.94.1.1");
const ap = admin.page;
let text = await go(ap, "/admin/scholarships");
check(/No scholarships yet/.test(text), "admin: starts empty with a way in");
await ap.waitForLoadState("networkidle");

await ap.fill('input[name="university"]', "University of Hull");
await ap.fill('input[name="name"]', "Vice-Chancellor's International Scholarship");
await ap.fill('input[name="amount"]', "£5,000 off first-year tuition");
await ap.getByRole("button", { name: "Add scholarship" }).click();
check(await ap.getByText("Link the university's own page for it").first().waitFor({ timeout: 8000 }).then(() => true, () => false), "admin: a scholarship needs its official page");

await ap.fill('input[name="university"]', "University of Nowhere");
await ap.fill('input[name="url"]', "https://www.hull.ac.uk/study/international-students/scholarships");
await ap.getByRole("button", { name: "Add scholarship" }).click();
check(await ap.getByText(/No university by that exact name/).first().waitFor({ timeout: 8000 }).then(() => true, () => false), "admin: the university must exist");

await ap.fill('input[name="university"]', "University of Hull");
await ap.locator('input[name="level"][value="PG"]').check();
await ap.getByRole("button", { name: "Add scholarship" }).click();
await ap.locator('[role="status"]').filter({ hasText: /Added/ }).first().waitFor({ timeout: 10000 }).then(() => ok("admin: adds the scholarship"), () => bad("admin: no confirmation"));
text = await go(ap, "/admin/scholarships");
check(/Vice-Chancellor's International Scholarship/.test(text) && /Master's/.test(text), "admin: listed with its level");

const partner = await signIn("kottayam@medcity.test", "10.94.1.2");
const pp = partner.page;
text = await go(pp, "/search?q=Hull");
await pp.locator('a[href^="/universities/"]').first().click();
await pp.waitForURL(/\/universities\//);
text = await main(pp);
check(/Scholarships/.test(text) && /£5,000 off first-year tuition/.test(text), "university page: shows the scholarship");
await pp.screenshot({ path: `${OUT}/university.png`, fullPage: true });

text = await go(pp, "/search?q=MSc+Civil+Engineering+Hull");
await go(pp, "/search?q=Hull");
await pp.getByRole("link", { name: "MSc Civil Engineering" }).first().click();
await pp.waitForURL(/\/programs\//);
text = await main(pp);
check(/Vice-Chancellor's International Scholarship/.test(text), "program page: a master's shows the master's scholarship");

text = await go(pp, "/search?scholarship=1");
check(count(text) === 10, `search: "Scholarship available" finds the Hull master's programs only (${count(text)})`);

// Pause it and it disappears everywhere.
await go(ap, "/admin/scholarships");
await ap.waitForLoadState("networkidle");
await ap.getByRole("button", { name: "Pause" }).first().click();
await ap.getByText("Paused").first().waitFor({ timeout: 10000 }).catch(() => {});
text = await go(pp, "/search?scholarship=1");
check(count(text) === 0, "search: a paused scholarship no longer counts");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
