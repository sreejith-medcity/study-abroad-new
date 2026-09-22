// Student services: a partner asks for an education loan for a student, the
// Overseas team works it from the services queue, and the partner sees the
// status, provider and note, and is notified.
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

const partner = await signIn("kottayam@medcity.test", "10.74.1.1");
const pp = partner.page;
await go(pp, "/search");
const sid = await pp.locator('select[name="student"] option', { hasText: "Arathi Krishnan" }).getAttribute("value");
let text = await go(pp, `/students/${sid}/services`);
check(/Services \(0\)/.test(text) && /Nothing requested yet/.test(text), "student file: a Services tab, empty to start");
await pp.waitForLoadState("networkidle");
await pp.getByRole("button", { name: "Send request" }).click();
await pp.waitForTimeout(1000);
check(/Choose a service/.test(await main(pp)), "request: the service is required");
await pp.selectOption('select[name="type"]', "EDUCATION_LOAN");
check(/collateral/.test(await main(pp)), "request: the hint follows the service");
await pp.fill('textarea[name="details"]', "INR 25 lakh, property collateral, father as co-applicant");
await pp.getByRole("button", { name: "Send request" }).click();
check(await toast(pp, /Request sent/), "request: sent");
await pp.reload();
text = await main(pp);
check(/Services \(1\)/.test(text) && /Education loan/.test(text) && /New/.test(text), "student file: the request is listed as new");
check(!(await pp.getByText("Update", { exact: true }).count()), "partner: cannot work the request");
const r = await pp.goto(`${BASE}/admin/services`);
check(pp.url().includes("/forbidden") || (r && r.status() >= 400), "partner: kept out of the services queue");

const admin = await signIn("admin@medcityoverseas.test", "10.74.1.2");
const ap = admin.page;
text = await go(ap, "/notifications");
check(/Education loan requested/.test(text), "admin: notified of the request");
await ap.getByRole("link", { name: "Services" }).first().click();
await ap.waitForURL(/\/admin\/services/);
text = await main(ap);
check(/1 new/.test(text) && /Arathi Krishnan/.test(text) && /INR 25 lakh/.test(text), "queue: the new request is there with its details");
await ap.waitForLoadState("networkidle");
await ap.selectOption('select[name="status"] >> nth=1', "IN_PROGRESS");
await ap.fill('input[name="provider"]', "Sample Bank, Kottayam branch");
await ap.fill('textarea[name="teamNote"]', "Sanction letter expected in 10 days");
await ap.getByRole("button", { name: "Save" }).first().click();
check(await toast(ap, /Saved/), "queue: the team moves it on");
await ap.reload();
check(/0 new, 1 in progress/.test(await main(ap)), "queue: the counts follow");

text = await go(pp, `/students/${sid}/services`);
check(/In progress/.test(text) && /Sample Bank/.test(text) && /Sanction letter expected/.test(text), "partner: sees status, provider and the note");
text = await go(pp, "/notifications");
check(/Education loan for Arathi: In progress/.test(text), "partner: notified of the change");

for (const [who, e] of [["partner", partner.errors], ["admin", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
