// Updates, announcements and What's New: the team publishes each; partners are
// told about the first two, see them on the dashboard by country and on the
// Updates page, and What's New carries a dot until it has been opened.
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
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);

const admin = await signIn("admin@medcityoverseas.test", "10.80.1.1");
const ap = admin.page;
async function publish(kind, title, body, extra = async () => {}) {
  await go(ap, "/admin/updates");
  await ap.waitForLoadState("networkidle");
  await ap.selectOption('select[name="kind"]', kind);
  await ap.fill('input[name="title"]', title);
  await ap.fill('textarea[name="body"]', body);
  await extra();
  await ap.getByRole("button", { name: "Publish", exact: true }).click();
  return toast(ap, /Published/);
}
check(await publish("UPDATE", "Hull extends the January deadline", "Applications for January now close on 15 November.", async () => {
  await ap.getByLabel("United Kingdom", { exact: true }).check();
  await ap.fill('input[name="university"]', "University of Hull");
  await ap.fill('input[name="intakes"]', "January 2027");
}), "admin: an update for the UK publishes");
check(await publish("ANNOUNCEMENT", "Partner meet in Kochi", "Join us on the 30th for the autumn partner meet.", async () => {
  await ap.fill('input[name="ctaLabel"]', "See events");
  await ap.fill('input[name="ctaUrl"]', "/events");
}), "admin: an announcement with a button publishes");
check(await publish("WHATS_NEW", "Program options are here", "Ask the team what fits a student from the Program options page."), "admin: a What's New item publishes");

const partner = await signIn("kottayam@medcity.test", "10.80.1.2");
const pp = partner.page;
let text = await go(pp, "/notifications");
check(/Important update: Hull extends/.test(text) && /Announcement: Partner meet in Kochi/.test(text) && !/Program options are here/.test(text), "partner: told about the update and the announcement, not What's New");
text = await go(pp, "/dashboard");
check(/Partner meet in Kochi/.test(text) && (await pp.getByRole("link", { name: "See events" }).count()) >= 1, "dashboard: the announcement banner with its button");
check(/Hull extends the January deadline/.test(text), "dashboard: the update in the Important updates card");
text = await go(pp, "/dashboard?uc=AU");
check(!/Hull extends the January deadline/.test(text), "dashboard: the AUS tab leaves out a UK update");
text = await go(pp, "/updates?country=GB");
check(/Hull extends the January deadline/.test(text) && /January 2027/.test(text), "updates page: filtered by country");
check(await pp.getByLabel("New items").count() === 1, "What's New: a dot for the unread item");
await pp.getByRole("link", { name: /What's new/ }).click();
await pp.waitForURL(/whats-new/);
check(/Program options are here/.test(await main(pp)), "What's New: lists the item");
await pp.reload();
check(await pp.getByLabel("New items").count() === 0, "What's New: the dot goes once opened");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
