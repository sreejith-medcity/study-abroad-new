// Training: the team builds a course with a quiz and publishes it; a counsellor
// fails, retakes, passes and opens a certificate; the branch head sees the
// team's progress; another branch cannot open the certificate.
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

const admin = await signIn("admin@medcityoverseas.test", "10.78.1.1");
const ap = admin.page;
await go(ap, "/admin/training");
await ap.waitForLoadState("networkidle");
await ap.fill('input[name="title"]', "UK Graduate visa basics");
await ap.fill('input[name="passMark"]', "150");
await ap.getByRole("button", { name: "Create course" }).click();
await ap.waitForTimeout(1000);
check(/Between 1 and 100/.test(await main(ap)), "admin: the pass mark must be a percentage");
await ap.fill('input[name="passMark"]', "100");
await ap.getByRole("button", { name: "Create course" }).click();
check(await toast(ap, /Course created as a draft/), "admin: the course is created as a draft");
await ap.reload();
await ap.waitForLoadState("networkidle");
check(await ap.getByRole("button", { name: "Publish" }).isDisabled(), "admin: a course without questions cannot be published");

await ap.getByText("Add a question").first().click();
await ap.fill('input[name="prompt"]', "How long is the Graduate visa for a master's graduate applying from 1 January 2027?");
await ap.fill('input[name="option0"]', "18 months");
await ap.getByRole("button", { name: "Add question" }).click();
await ap.waitForTimeout(1000);
check(/At least two answers/.test(await main(ap)), "admin: a question needs two answers");
await ap.fill('input[name="option1"]', "3 years");
await ap.check('input[name="correct"][value="0"]');
await ap.getByRole("button", { name: "Add question" }).click();
check(await toast(ap, /Question added/), "admin: a question is added");
await ap.reload();
await ap.waitForLoadState("networkidle");
check(/✓ 18 months · 3 years/.test(await main(ap)), "admin: the right answer is marked");
await ap.getByRole("button", { name: "Publish" }).click();
await ap.waitForTimeout(1500);
check(/Published/.test(await main(ap)), "admin: published");

const counsellor = await signIn("uk.docs@medcity.test", "10.78.1.2");
const cp = counsellor.page;
await cp.getByRole("link", { name: "Training" }).first().click();
await cp.waitForURL(/\/training$/);
check(/UK Graduate visa basics/.test(await main(cp)) && /Not started/.test(await main(cp)), "counsellor: sees the course");
await cp.getByRole("link", { name: /UK Graduate visa basics/ }).click();
await cp.waitForURL(/\/training\/[^/]+$/);
await cp.waitForLoadState("networkidle");
await cp.getByRole("button", { name: "Submit answers" }).click();
await cp.waitForTimeout(1000);
check(/Answer every question/.test(await main(cp)), "quiz: every question must be answered");
await cp.getByLabel("3 years").check();
await cp.getByRole("button", { name: "Submit answers" }).click();
await cp.waitForURL(/attempt=/, { timeout: 15000 }).catch(() => {});
check(/0%: not a pass yet/.test(await main(cp)), "quiz: a wrong answer is not a pass");
await cp.waitForLoadState("networkidle");
await cp.getByLabel("18 months").check();
await cp.getByRole("button", { name: "Submit answers" }).click();
await cp.waitForFunction(() => document.body.innerText.includes("Passed with 100%"), null, { timeout: 15000 }).catch(() => {});
check(/Passed with 100%/.test(await main(cp)), "quiz: the retake passes");
await cp.getByRole("link", { name: "Open your certificate" }).click();
await cp.waitForURL(/\/certificate\//);
const certUrl = cp.url();
const cert = await main(cp);
check(/Certificate of completion/.test(cert) && /UK Documentation/.test(cert) && /UK Graduate visa basics/.test(cert) && /100%/.test(cert), "certificate: names the person, the course and the score");

const head = await signIn("kottayam@medcity.test", "10.78.1.3");
const text = await go(head.page, "/training");
check(/Your team/.test(text) && /UK Documentation\s*Passed/.test(text), "branch head: sees who passed");
const other = await signIn("kochi@medcity.test", "10.78.1.4");
const r = await other.page.goto(certUrl);
check(r && r.status() === 404, "another branch cannot open the certificate");

for (const [who, e] of [["admin", admin.errors], ["counsellor", counsellor.errors], ["head", head.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
