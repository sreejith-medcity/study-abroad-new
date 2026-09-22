// Offer, deposit, CAS / I-20 / CoE and visa on an application: the team records
// them with their rules, the partner sees the summary and is notified, and the
// student sees the offer and visa in the portal.
// Wants the sample data (npm run db:seed).
import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-offer-visa";
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
  page.on("pageerror", (e) => { errors.push(String(e)); console.log("PAGEERROR at", page.url().slice(21), String(e).slice(0, 120)); });
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
const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);

const admin = await signIn("admin@medcityoverseas.test", "10.73.1.1");
const ap = admin.page;
await go(ap, "/search");
const sid = await ap.locator('select[name="student"] option', { hasText: "Fathima Rahman" }).getAttribute("value");
await go(ap, `/students/${sid}/applications`);
const appUrl = ap.url();
await ap.waitForLoadState("networkidle");
check(/Offer and visa/.test(await main(ap)) && /No offer yet/.test(await main(ap)), "admin: the card shows no offer yet");

await ap.getByText("Update offer and visa").click();
await ap.selectOption('select[name="visaDecision"]', "GRANTED");
await ap.getByRole("button", { name: "Save offer and visa" }).click();
await ap.waitForTimeout(1200);
check(/When was the decision\?/.test(await main(ap)), "admin: a visa decision needs its date");
await ap.selectOption('select[name="visaDecision"]', "");

await ap.selectOption('select[name="offerType"]', "CONDITIONAL");
await ap.fill('input[name="offerDate"]', iso(0));
await ap.fill('input[name="offerAcceptBy"]', iso(-3));
await ap.getByRole("button", { name: "Save offer and visa" }).click();
await ap.waitForTimeout(1200);
check(/Before the offer date/.test(await main(ap)), "admin: accept-by cannot be before the offer");
await ap.fill('input[name="offerAcceptBy"]', iso(14));
await ap.fill('textarea[name="offerConditions"]', "Final marksheets and IELTS 6.5");
await ap.getByRole("button", { name: "Save offer and visa" }).click();
check(await toast(ap, /Saved 4 changes/), "admin: the conditional offer saves");
await ap.reload();
let text = await main(ap);
check(/Conditional, issued/.test(text) && /14 days left/.test(text) && /Final marksheets and IELTS 6.5/.test(text), "admin: the summary reads back");

const partner = await signIn("kottayam@medcity.test", "10.73.1.2");
const pp = partner.page;
text = await go(pp, appUrl.replace(BASE, ""));
check(/Conditional, issued/.test(text) && /Final marksheets/.test(text), "partner: sees the offer summary");
check(!(await pp.getByText("Update offer and visa").count()), "partner: cannot edit it");
text = await go(pp, "/notifications");
check(/Conditional offer recorded/.test(text), "partner: notified of the offer");

// The visa, granted.
await go(ap, appUrl.replace(BASE, ""));
await ap.waitForLoadState("networkidle");
await ap.getByText("Update offer and visa").click();
await ap.fill('input[name="confirmationNumber"]', "E4G1234567");
await ap.fill('input[name="visaLodgedOn"]', iso(-10));
await ap.selectOption('select[name="visaDecision"]', "GRANTED");
await ap.fill('input[name="visaDecisionOn"]', iso(-1));
await ap.getByRole("button", { name: "Save offer and visa" }).click();
check(await toast(ap, /Saved 4 changes/), "admin: CAS number and visa decision save");
text = await go(pp, appUrl.replace(BASE, ""));
check(/Granted/.test(text) && /E4G1234567/.test(text), "partner: sees the visa granted and the confirmation number");
await pp.screenshot({ path: `${OUT}/partner.png`, fullPage: true });

const student = await signIn("fathima.rahman@example.com", "10.73.1.3");
text = await go(student.page, "/portal");
check(/നിബന്ധനകളോടെയുള്ള ഓഫർ|Conditional offer/.test(text) && /അനുവദിച്ചു|Granted/.test(text), "portal: the student sees the offer and the visa");
check(!/E4G1234567/.test(text), "portal: internal numbers stay out");
await student.page.screenshot({ path: `${OUT}/portal.png`, fullPage: true });

for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors], ["student", student.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
