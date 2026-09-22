// The help desk: a partner raises a commission question, the Overseas team is
// told and replies, the ticket moves to whoever has to act, and the team
// resolves it. Another branch cannot open it.
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

const partner = await signIn("kottayam@medcity.test", "10.77.1.1");
const pp = partner.page;
await pp.getByRole("link", { name: "Help desk" }).first().click();
await pp.waitForURL(/\/support$/);
await pp.waitForLoadState("networkidle");
await pp.getByRole("button", { name: "Send to the Overseas team" }).click();
await pp.waitForTimeout(1000);
check(/Choose what it is about/.test(await main(pp)), "raise: the category is required");
await pp.selectOption('select[name="category"]', "COMMISSION");
await pp.fill('input[name="subject"]', "August commission not in the wallet");
await pp.fill('textarea[name="body"]', "Two visas were granted in August but the wallet shows no credit for either.");
await pp.getByRole("button", { name: "Send to the Overseas team" }).click();
await pp.waitForURL(/\/support\/[^/]+$/, { timeout: 15000 }).then(() => ok("raise: opens the new ticket"), () => bad("raise: opens the new ticket"));
const ticketUrl = pp.url();
let text = await main(pp);
check(/August commission not in the wallet/.test(text) && /With the Overseas team/.test(text), "ticket: the thread starts with the question");

const admin = await signIn("admin@medcityoverseas.test", "10.77.1.2");
const ap = admin.page;
text = await go(ap, "/notifications");
check(/Help desk: August commission/.test(text), "admin: notified");
text = await go(ap, "/support");
check(/August commission not in the wallet/.test(text) && /Medcity Kottayam/.test(text), "admin: sees it with the branch");
await go(ap, ticketUrl.replace(BASE, ""));
await ap.waitForLoadState("networkidle");
await ap.fill('textarea[name="body"]', "Both are accruing now; they will show in the wallet once received.");
await ap.getByRole("button", { name: "Send reply" }).click();
check(await toast(ap, /Reply sent/), "admin: replies");
await ap.reload();
check(/Waiting on the partner/.test(await main(ap)), "ticket: moves to the partner after the team's reply");

text = await go(pp, "/support");
check(/Waiting on you/.test(text), "partner: the list says it is waiting on them");
text = await go(pp, "/notifications");
check(/The Overseas team replied: August commission/.test(text), "partner: notified of the reply");

await go(ap, ticketUrl.replace(BASE, ""));
await ap.getByRole("button", { name: "Mark resolved" }).click();
await ap.waitForTimeout(1500);
check(/Resolved/.test(await main(ap)), "admin: resolves it");
text = await go(pp, "/support");
check(!/August commission/.test(text), "partner: resolved tickets leave the open list");
text = await go(pp, "/support?status=RESOLVED");
check(/August commission/.test(text), "partner: and are under Resolved");

const other = await signIn("kochi@medcity.test", "10.77.1.3");
const r = await other.page.goto(ticketUrl);
check(r && r.status() === 404, "another branch gets a 404 for it");
check(!/August commission/.test(await go(other.page, "/support?status=all")), "another branch does not see it in its list");

for (const [who, e] of [["partner", partner.errors], ["admin", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
