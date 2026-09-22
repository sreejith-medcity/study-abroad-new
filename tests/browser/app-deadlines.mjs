// Typed deadlines on applications: the team dates a CAS request, the partner
// is told, sees it on the dashboard by window, filters the applications list by
// it, and ticks it off; an offer's accept-by date becomes a deadline by itself.
// Wants the sample data (npm run db:seed).
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
const iso = (n) => { const d = new Date(Date.now() + n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const partner = await signIn("kottayam@medcity.test", "10.81.1.1");
const pp = partner.page;
let text = await go(pp, "/dashboard");
check(/Upcoming deadlines/.test(text) && /Payment ·/.test(text), "dashboard: a payment deadline within 14 days");
text = await go(pp, "/dashboard?dw=today");
check(/Nothing due in this window/.test(text), "dashboard: the Today tab narrows it");

const admin = await signIn("admin@medcityoverseas.test", "10.81.1.2");
const ap = admin.page;
await go(ap, "/search");
const sid = await ap.locator('select[name="student"] option', { hasText: "Fathima Rahman" }).getAttribute("value");
await go(ap, `/students/${sid}/applications`);
const appUrl = ap.url();
await ap.waitForLoadState("networkidle");
await ap.selectOption('select[name="type"]', "CAS_REQUEST");
await ap.fill('input[name="dueOn"]', iso(2));
await ap.fill('input[name="note"]', "Ask the university for the CAS");
await ap.getByRole("button", { name: "Add deadline" }).click();
check(await toast(ap, /Deadline added/), "admin: a CAS request deadline is added");

text = await go(pp, "/notifications");
check(/CAS \/ I-20 \/ CoE request due/.test(text), "partner: told about it");
text = await go(pp, "/dashboard?dw=7");
check(/CAS \/ I-20 \/ CoE request ·/.test(text) && /Fathima Rahman/.test(text), "dashboard: shows in the 7-day window");
text = await go(pp, "/applications?dlType=CAS_REQUEST");
check(/Fathima Rahman/.test(text) && /Due in 2d/.test(text), "applications: filtered by deadline type, with the countdown");
text = await go(pp, "/applications?dlType=VISA");
check(!/Fathima Rahman/.test(text), "applications: another type leaves it out");
text = await go(pp, "/deadlines?tab=applications");
check(/Ask the university for the CAS/.test(text), "deadlines page: the applications tab lists it");

await go(pp, appUrl.replace(BASE, ""));
await pp.waitForLoadState("networkidle");
const before = await pp.getByRole("button", { name: "Mark done" }).count();
await pp.getByRole("button", { name: "Mark done" }).first().click();
await pp.waitForTimeout(1500);
check((await pp.getByRole("button", { name: "Reopen" }).count()) === 1 && (await pp.getByRole("button", { name: "Mark done" }).count()) === before - 1, "partner: ticks a deadline off");
check(!(await pp.getByRole("button", { name: "Add deadline" }).count()), "partner: cannot add deadlines");

await go(ap, appUrl.replace(BASE, ""));
await ap.waitForLoadState("networkidle");
await ap.getByText("Update offer and visa").click();
await ap.selectOption('select[name="offerType"]', "CONDITIONAL");
await ap.fill('input[name="offerDate"]', iso(0));
await ap.fill('input[name="offerAcceptBy"]', iso(10));
await ap.getByRole("button", { name: "Save offer and visa" }).click();
check(await toast(ap, /Saved/), "admin: an offer with an accept-by date saves");
await ap.reload();
check(/Offer acceptance · /.test(await main(ap)), "the accept-by date becomes an offer acceptance deadline");

for (const [who, e] of [["partner", partner.errors], ["admin", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
