// Australia's CRICOS register at full size, through the admin screen: the
// upload path of the sync, a bulk publish of every draft, and the partner
// screens with 27,000 programs behind them.
// Wants a seeded database with the catalogue and the three register files:
//   CRICOS_DIR=/path/to/folder node tests/browser/cricos.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.CRICOS_DIR;
if (!DIR) { console.error("Set CRICOS_DIR to the folder holding the three CRICOS CSVs"); process.exit(1); }
const file = (part) => path.join(DIR, fs.readdirSync(DIR).find((f) => f.includes(part) && f.endsWith(".csv")));
const OUT = "/tmp/smoke-cricos";
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
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p, { timeout: 60000 }); return main(page); }
const timed = async (label, fn) => { const t = Date.now(); const r = await fn(); console.log(`      ${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`); return r; };

const admin = await signIn("admin@medcityoverseas.test", "10.90.1.1");
const ap = admin.page;
await go(ap, "/admin/programs");
await ap.waitForLoadState("networkidle");
await ap.getByText("Server cannot reach data.gov.au? Upload the files").click();
await ap.setInputFiles('input[name="institutions"]', file("institutions"));
await ap.setInputFiles('input[name="courses"]', file("courses"));
await ap.setInputFiles('input[name="locations"]', file("locations"));
await timed("sync by upload", async () => {
  await ap.getByRole("button", { name: "Sync from CRICOS" }).click();
  await ap.getByText(/CRICOS: 25,978 live courses/).waitFor({ timeout: 240000 }).then(() => ok("sync: the upload imports the whole register"), () => bad("sync: no success message"));
});
let text = await main(ap);
const created = Number((text.match(/([\d,]+) new as drafts/) || [])[1]?.replace(/,/g, ""));
check(created > 25000, `sync: ${created} courses land as drafts`);
check(/matched to programs already in the catalogue/.test(text), "sync: hand-researched rows are matched, not duplicated");

text = await go(ap, "/admin/programs");
const total = Number((text.match(/([\d,]+) matches/) || [])[1]?.replace(/,/g, ""));
check(total > 26000, `admin list counts everything (${total})`);
check(/Last sync:/.test(text), "admin: the card shows the last sync");

await timed("bulk publish of every Australian draft", async () => {
  await go(ap, "/admin/programs?country=AU&status=DRAFT");
  await ap.waitForLoadState("networkidle");
  await ap.getByRole("button", { name: "Publish" }).first().click();
  // The list does not always redraw after the action, so reload to read the result.
  let t0 = Date.now(), n = -1;
  while (Date.now() - t0 < 180000) { await ap.waitForTimeout(3000); const t = await go(ap, "/admin/programs?country=AU&status=DRAFT"); n = Number((t.match(/([\d,]+) match/) || [])[1]?.replace(/,/g, "") ?? -1); if (n === 0) break; }
  check(n === 0, "bulk publish: every Australian draft published in one action");
});

// Running it again changes nothing but refreshes.
await go(ap, "/admin/programs");
await ap.waitForLoadState("networkidle");
await ap.getByText("Server cannot reach data.gov.au? Upload the files").click();
await ap.setInputFiles('input[name="institutions"]', file("institutions"));
await ap.setInputFiles('input[name="courses"]', file("courses"));
await ap.setInputFiles('input[name="locations"]', file("locations"));
await timed("second sync", async () => {
  await ap.getByRole("button", { name: "Sync from CRICOS" }).click();
  await ap.getByText(/CRICOS: 25,978 live courses/).waitFor({ timeout: 240000 }).catch(() => {});
});
text = await main(ap);
check(/ 0 new/.test(text) && /refreshed/.test(text), "second sync: nothing new, everything refreshed");

// ---- Partner screens at full size ----
const partner = await signIn("kottayam@medcity.test", "10.90.1.2");
const pp = partner.page;
text = await timed("search, all programs", () => go(pp, "/search"));
const live = Number((text.match(/([\d,]+) live programs?/) || [])[1]?.replace(/,/g, ""));
check(live > 26000, `search counts every live program (${live})`);
text = await timed("search, keyword", () => go(pp, "/search?q=Master+of+Data+Science&country=AU"));
check(/whole course/.test(text), "search: CRICOS fees read as whole-course");
await pp.locator('a[href^="/programs/"]').first().click();
await pp.waitForURL(/\/programs\//);
text = await main(pp);
check(/Tuition, whole course/.test(text) && /CRICOS register, course/.test(text), "program page: shows the whole-course fee and its source");
check(/Tuition per year\s*Not recorded/.test(text), "program page: no yearly figure is invented");
await pp.screenshot({ path: `${OUT}/program.png`, fullPage: true });

text = await timed("university page, Monash", async () => { await go(pp, "/search?q=Monash+University&country=AU"); await pp.locator('a[href^="/universities/"]').first().click(); await pp.waitForURL(/\/universities\//); return main(pp); });
check(/Page 1 of \d+/.test(text), "university page: a large university pages its list");
check(/Official website/.test(await pp.locator("main").innerText()), "university page: links the official website");
await pp.screenshot({ path: `${OUT}/university.png`, fullPage: true });

const sid = await (await go(pp, "/search"), pp.locator('select[name="student"] option', { hasText: "Arathi Krishnan" }).getAttribute("value"));
text = await timed("apply panel, keyword", () => go(pp, `/students/${sid}/applications?tab=apply&q=Monash&country=AU`));
const options = await pp.locator('select[name="programId"] option').count();
check(options > 20 && options <= 60, `apply panel: a bounded list that includes register courses (${options - 1} options)`);
// Pick a course from the register: the one whose intake list says none are on record.
for (let i = 1; i < Math.min(options, 15); i++) {
  await pp.selectOption('select[name="programId"]', { index: i });
  if (/No intakes are recorded/.test(await pp.locator("main").innerText())) break;
}
const intakeOptions = await pp.locator('select[name="intake"] option').count();
check(intakeOptions > 12 && /No intakes are recorded/.test(await pp.locator("main").innerText()), `apply panel: a register course offers every month, with the note (${intakeOptions - 1})`);
await pp.selectOption('select[name="intake"]', { index: 1 });
await pp.getByRole("button", { name: "Create application" }).click();
await pp.waitForURL(/app=/, { timeout: 20000 }).then(() => ok("apply: an application opens for a course with no intake on record"), () => bad("apply: could not create the application"));
text = await timed("apply panel, no filter", () => go(pp, `/students/${sid}/applications?tab=apply`));
check(/first 50 matches/.test(text) || (await pp.locator('select[name="programId"] option').count()) <= 60, "apply panel: never sends the whole catalogue");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
