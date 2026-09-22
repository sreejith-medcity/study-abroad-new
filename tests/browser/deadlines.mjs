// Application deadlines and fee waivers: the admin records them on a program,
// partners see them on the program page, in search, on the deadlines page, and
// get a warning in the apply form when an intake's deadline has passed.
// Wants the real catalogue loaded and published (see programs.mjs).
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-deadlines";
fs.mkdirSync(OUT, { recursive: true });
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
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };

// ---------------- Admin records two deadlines and a waiver ----------------
const admin = await signIn("admin@medcityoverseas.test", "10.72.1.1");
const ap = admin.page;
await go(ap, "/admin/programs?q=MSc+Business+Management");
await ap.getByRole("link", { name: "MSc Business Management" }).first().click();
await ap.waitForURL(/\/admin\/programs\/[^?]+$/);
const programId = ap.url().split("/").pop();
await ap.waitForLoadState("networkidle");
// The first option can be this month's intake, whose deadline has usually gone; start after it.
const intakes = await ap.locator('select[name="intake"] option').evaluateAll((els) => els.slice(2).map((e) => ({ value: e.value, label: e.textContent })));
check(intakes.length >= 2, `admin: the deadline form offers the program's intakes (${intakes.map((i) => i.label).join(", ")})`);

await ap.selectOption('select[name="intake"]', intakes[0].value);
await ap.fill('input[name="deadline"]', inDays(10));
await ap.fill('input[name="note"]', "Published on the course page");
await ap.getByRole("button", { name: "Save deadline" }).click();
await ap.locator('[role="status"]').filter({ hasText: "Deadline saved" }).first().waitFor({ timeout: 10000 }).then(() => ok("admin: a deadline saves"), () => bad("admin: a deadline saves"));
await ap.selectOption('select[name="intake"]', intakes[1].value);
await ap.fill('input[name="deadline"]', inDays(-1));
await ap.getByRole("button", { name: "Save deadline" }).click();
await ap.waitForTimeout(1500);
let text = await main(ap);
check(/10 days left/.test(text) && /closed yesterday/.test(text), "admin: both deadlines are listed with their days");

const [y, m] = intakes[0].value.split("-").map(Number);
await ap.selectOption('select[name="intake"]', intakes[0].value);
await ap.fill('input[name="deadline"]', `${y + 1}-${String(m).padStart(2, "0")}-01`);
await ap.getByRole("button", { name: "Save deadline" }).click();
await ap.waitForTimeout(1200);
check(/After the intake itself/.test(await main(ap)), "admin: a deadline after the intake is refused");

await ap.fill('input[name="feeWaiver"]', "Waived for Medcity applicants this cycle");
await ap.getByRole("button", { name: "Save program" }).click();
await ap.locator('[role="status"]').filter({ hasText: /Saved 1 change/ }).first().waitFor({ timeout: 10000 }).then(() => ok("admin: the fee waiver saves"), () => bad("admin: the fee waiver saves"));

// ---------------- Partner ----------------
const partner = await signIn("kottayam@medcity.test", "10.72.1.2");
const pp = partner.page;
text = await go(pp, `/programs/${programId}`);
check(/Application deadlines/.test(text) && /10 days left/.test(text) && /Published on the course page/.test(text), "program page: deadlines show with the note");
check(/Application fee waiver\s*Waived for Medcity applicants/.test(text), "program page: the waiver shows");
await pp.screenshot({ path: `${OUT}/program.png`, fullPage: true });

text = await go(pp, "/search?closing=1");
check(/MSc Business Management/.test(text) && /apply by/.test(text), "search: 'deadline in the next 30 days' finds it, with the date");
text = await go(pp, "/search?waiver=1");
check(/MSc Business Management/.test(text) && /Fee waiver/.test(text), "search: the fee waiver filter finds it");

await pp.getByRole("link", { name: "Deadlines" }).first().click();
await pp.waitForURL(/\/deadlines/);
text = await main(pp);
check(/MSc Business Management/.test(text) && /10 days left/.test(text) && !/closed yesterday/.test(text), "deadlines page: open deadlines only, soonest first");
await pp.screenshot({ path: `${OUT}/deadlines.png`, fullPage: true });

// Shortlist it for a student, and the page's own filter finds it.
const sid = await (await go(pp, "/search"), pp.locator('select[name="student"] option', { hasText: "Arathi Krishnan" }).getAttribute("value"));
await go(pp, `/programs/${programId}?student=${sid}`);
await pp.waitForLoadState("networkidle");
const sl = pp.getByRole("button", { name: "Add to shortlist", exact: true });
if (await sl.count()) { await sl.first().click(); await pp.waitForTimeout(1500); }
text = await go(pp, "/deadlines?mine=1");
check(/MSc Business Management/.test(text) && /Arathi Krishnan/.test(text), "deadlines page: 'on my students' shortlists' names the student");

// The apply form warns on the intake whose deadline has passed.
await go(pp, `/students/${sid}/applications?tab=apply&program=${programId}`);
await pp.waitForLoadState("networkidle");
await pp.selectOption('select[name="programId"]', programId);
const opts = await pp.locator('select[name="intake"] option').allTextContents();
check(opts.some((o) => /apply by/.test(o)), "apply form: intakes carry their deadline");
await pp.selectOption('select[name="intake"]', intakes[1].value);
check(/deadline for this intake was/.test(await main(pp)), "apply form: a passed deadline is warned about");

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
