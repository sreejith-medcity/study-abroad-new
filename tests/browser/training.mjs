// Training: the team builds a course with a quiz and publishes it; a counsellor
// fails, retakes, passes and opens a certificate; the branch head sees the
// team's progress; another branch cannot open the certificate. The two staff
// guides the sample data seeds are listed as courses and in the library, and a
// course's reading opens the guide page.
// Wants the sample data (npm run db:seed).
import { chromium } from "playwright";
import { hydrated, knownWarning } from "./_errors.mjs";
import { clickInMenu } from "./_menu.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
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
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
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
await hydrated(ap);
await ap.fill('input[name="title"]', "UK Graduate visa basics");
await ap.fill('input[name="passMark"]', "150");
await ap.getByRole("button", { name: "Create course" }).click();
await ap.waitForTimeout(1000);
check(/Between 1 and 100/.test(await main(ap)), "admin: the pass mark must be a percentage");
await ap.fill('input[name="passMark"]', "100");
await ap.getByRole("button", { name: "Create course" }).click();
check(await toast(ap, /Course created as a draft/), "admin: the course is created as a draft");
await ap.reload();
await hydrated(ap);
// The seeded guide courses sit on the same screen, each with its own forms and
// an Unpublish button, so everything below is scoped to the new course's card.
const card = () => ap.locator('h2:text-is("UK Graduate visa basics")').locator("xpath=ancestor::div[contains(@class, 'shadow-card')][1]");
check(await card().getByRole("button", { name: "Publish", exact: true }).isDisabled(), "admin: a course without questions cannot be published");

await card().getByText("Add a question").click();
await card().locator('input[name="prompt"]').fill("How long is the Graduate visa for a master's graduate applying from 1 January 2027?");
await card().locator('input[name="option0"]').fill("18 months");
await card().getByRole("button", { name: "Add question" }).click();
await ap.waitForTimeout(1000);
check(/At least two answers/.test(await main(ap)), "admin: a question needs two answers");
await card().locator('input[name="option1"]').fill("3 years");
await card().locator('input[name="correct"][value="0"]').check();
await card().getByRole("button", { name: "Add question" }).click();
check(await toast(ap, /Question added/), "admin: a question is added");
await ap.reload();
await hydrated(ap);
check(/✓ 18 months · 3 years/.test(await card().innerText()), "admin: the right answer is marked");
await card().getByRole("button", { name: "Publish", exact: true }).click();
await ap.waitForTimeout(1500);
check(/Published/.test(await card().innerText()), "admin: published");

const counsellor = await signIn("uk.docs@medcity.test", "10.78.1.2");
const cp = counsellor.page;
await clickInMenu(cp, "Training");
await cp.waitForURL(/\/training$/);
check(/UK Graduate visa basics/.test(await main(cp)) && /Not started/.test(await main(cp)), "counsellor: sees the course");

// The staff guides seeded with the sample data: a course each, whose reading is
// the guide's row in the library, which opens the guide page under /learning.
const listed = await main(cp);
check(/The day end report/.test(listed) && /The Ausbildung process in the portal/.test(listed), "counsellor: the two staff guide courses are listed");
await cp.getByRole("link", { name: /The Ausbildung process in the portal/ }).click();
await cp.waitForURL(/\/training\/[^/]+$/);
await hydrated(cp);
const reading = cp.locator("main a", { hasText: "The Ausbildung process in the portal" }).first();
check((await reading.count()) > 0 && /\/learning\/guides\/ausbildung-process$/.test((await reading.getAttribute("href")) ?? ""), "guide course: Read first links to the guide page");
const guide = await go(cp, "/learning/guides/ausbildung-process");
check(/Hand to the documentation desk/.test(guide) && /does not send the hand-over emails/.test(guide), "guide page: the Ausbildung guide reads for a counsellor");
check((await cp.locator('main a[href^="/training/"]', { hasText: "Take the course" }).count()) === 1, "guide page: links to its course");
const library = await go(cp, "/learning");
check(/The day end report/.test(library) && /The Ausbildung process in the portal/.test(library), "library: both guides are listed for a counsellor");
check((await cp.locator('main a[href="/learning/guides/day-end-report"]').count()) === 1, "library: the day end guide's card opens the guide page");
await go(cp, "/training");
await hydrated(cp);
await cp.getByRole("link", { name: /UK Graduate visa basics/ }).click();
await cp.waitForURL(/\/training\/[^/]+$/);
await hydrated(cp);
await cp.getByRole("button", { name: "Submit answers" }).click();
await cp.waitForTimeout(1000);
check(/Answer every question/.test(await main(cp)), "quiz: every question must be answered");
await cp.getByLabel("3 years").check();
await cp.getByRole("button", { name: "Submit answers" }).click();
await cp.waitForURL(/attempt=/, { timeout: 15000 }).catch(() => {});
check(/0%: not a pass yet/.test(await main(cp)), "quiz: a wrong answer is not a pass");
await hydrated(cp);
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
// The row reads across the courses in title order, so the pass sits after the two guide courses' "Not yet".
check(/Your team/.test(text) && /UK Documentation(?:\s*Not yet)*\s*Passed/.test(text), "branch head: sees who passed");
const other = await signIn("kochi@medcity.test", "10.78.1.4");
const r = await other.page.goto(certUrl);
check(r && r.status() === 404, "another branch cannot open the certificate");

for (const [who, e] of [["admin", admin.errors], ["counsellor", counsellor.errors], ["head", head.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
