// Events: the team publishes a webinar open to students, partners are told,
// take a seat (which reveals the join link), register a student, and a
// cancelled event disappears from their list.
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
const tomorrow = (() => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();

const admin = await signIn("admin@medcityoverseas.test", "10.75.1.1");
const ap = admin.page;
await ap.getByRole("link", { name: "Events" }).first().click();
await ap.waitForURL(/\/admin\/events/);
await ap.waitForLoadState("networkidle");
await ap.fill('input[name="title"]', "Studying in the UK: the 2027 intakes");
await ap.selectOption('select[name="kind"]', "WEBINAR");
await ap.fill('input[name="startsAt"]', `${tomorrow}T18:30`);
await ap.fill('input[name="endsAt"]', `${tomorrow}T19:30`);
await ap.fill('input[name="capacity"]', "3");
await ap.getByRole("button", { name: "Publish event" }).click();
await ap.waitForTimeout(1200);
check(/Give a place, a link, or both/.test(await main(ap)), "admin: an event needs a place or a link");
await ap.fill('input[name="joinUrl"]', "https://meet.example.org/uk-2027");
await ap.fill('textarea[name="description"]', "Graduate visa changes, CAS timelines and deposits.");
await ap.check('input[name="openToStudents"]');
await ap.getByRole("button", { name: "Publish event" }).click();
check(await toast(ap, /Event published/), "admin: the webinar publishes");
await ap.reload();
check(/Studying in the UK/.test(await main(ap)) && /0 partners, 0 students of 3/.test(await main(ap)), "admin: listed with its seats");

const partner = await signIn("kottayam@medcity.test", "10.75.1.2");
const pp = partner.page;
let text = await go(pp, "/notifications");
check(/Webinar: Studying in the UK/.test(text), "partner: notified of the new event");
await pp.getByRole("link", { name: "Events" }).first().click();
await pp.waitForURL(/\/events/);
text = await main(pp);
check(/Studying in the UK/.test(text) && /6:30 pm/i.test(text) && /3 seats left/.test(text), "events: shown in IST with its seats");
check(!(await pp.getByRole("link", { name: /Join link/ }).count()) && /join link appears once you are on the list/.test(text), "events: the join link waits for a seat");
await pp.waitForLoadState("networkidle");
await pp.getByRole("button", { name: "I'll attend" }).click();
check(await toast(pp, /on the list/), "events: a partner takes a seat");
await pp.reload();
text = await main(pp);
check(/2 seats left/.test(text) && (await pp.getByRole("link", { name: /Join link/ }).count()) === 1, "events: the seat is counted and the join link shows");
await pp.waitForLoadState("networkidle");
const opt = await pp.locator('select[name="studentId"] option', { hasText: "Arathi Krishnan" }).getAttribute("value");
await pp.selectOption('select[name="studentId"]', opt);
await pp.getByRole("button", { name: "Register student" }).click();
check(await toast(pp, /Arathi is registered/), "events: a student is registered");
await pp.reload();
text = await main(pp);
check(/Your students registered/i.test(text) && /Arathi Krishnan/.test(text) && /1 seat left/.test(text), "events: the branch sees its student on the list");

text = await go(ap, "/admin/events");
check(/1 partner, 1 student of 3/.test(text), "admin: counts partners and students");
await ap.getByRole("button", { name: "Cancel event" }).first().click();
await ap.waitForTimeout(1500);
check(/Cancelled/.test(await main(ap)), "admin: the event can be cancelled");
text = await go(pp, "/events");
check(!/Studying in the UK/.test(text), "events: a cancelled event leaves the partner's list");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
