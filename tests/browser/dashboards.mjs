// Every role lands on its own dashboard, with its own menu behind it.
//
// One dashboard per job, drawn three ways: leadership and finance read an
// executive summary, the processing desk a command centre, and the
// documentation desk, a branch and a counsellor a pipeline board. This checks
// that each role lands on the one meant for it, that it is drawn, and that the
// menu behind it is still the one their job needs. The figures on each are
// checked against the database in dashboard.mjs.
import { chromium } from "playwright";
import { knownWarning } from "./_errors.mjs";
import fs from "node:fs";

const OUT = "/tmp/smoke-dash";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const ROLES = [
  { file: "01-super-admin", email: "sreejith@miak.in", expect: ["Total registrations", "How students flow through", "Needs attention"], nav: "Audit log" },
  { file: "02-admin", email: "admin@medcityoverseas.test", expect: ["Total registrations", "Deadlines this week", "Who is carrying what"], nav: "Work queue" },
  { file: "03-management", email: "management@medcityoverseas.test", expect: ["Total registrations", "Needs attention", "Branches compared"], nav: "Performance" },
  { file: "04-partner", email: "kottayam@medcity.test", expect: ["Applications by stage", "Waiting on you", "The team"], nav: "Students" },
  { file: "05-counsellor", email: "uk.docs@medcity.test", expect: ["My pipeline", "My students", "Follow-ups"], nav: "My desk" },
  { file: "06-documentation", email: "documentation@medcityoverseas.test", expect: ["Documents by stage", "Waiting for a check", "Who has what"], nav: "Work queue" },
  { file: "07-finance", email: "finance@medcityoverseas.test", expect: ["Earned, not invoiced", "How late the money is", "Latest money in"], nav: "Invoices" },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-features=OptimizationHints,Translate,AutofillServerCommunication",
  ],
});

/** Google Fonts and friends are blocked in this sandbox, so keep every request local. */
async function localOnly(ctx) {
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
}

for (const [i, role] of ROLES.entries()) {
  // A separate caller address per role, so the sign-in rate limiter does not
  // count one role's attempts against the next.
  const ctx = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    extraHTTPHeaders: { "x-forwarded-for": `10.9.0.${i + 20}` },
  });
  await localOnly(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', role.email);
  await page.fill('input[name="password"]', role.password ?? "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await page.locator("main").first().waitFor({ timeout: 15000 }).catch(() => {});

  if (page.url().endsWith("/dashboard")) ok(`${role.email} lands on the dashboard`);
  else bad(`${role.email} landed on ${page.url()}`);

  // innerText applies CSS text-transform, so compare without case.
  const text = (await page.locator("main").innerText().catch(() => "")).toLowerCase();
  for (const phrase of role.expect) {
    text.includes(phrase.toLowerCase()) ? ok(`${role.file}: "${phrase}"`) : bad(`${role.file}: missing "${phrase}"`);
  }
  (await page.locator("main [data-stat-tiles], main [data-exec-hero]").count()) === 1
    ? ok(`${role.file}: lands on its figures`)
    : bad(`${role.file}: no figures on the dashboard`);

  const nav = page.locator('nav[aria-label="Main"]');
  (await nav.getByText(role.nav, { exact: true }).count()) ? ok(`${role.file}: nav has ${role.nav}`) : bad(`${role.file}: nav missing ${role.nav}`);

  await page.screenshot({ path: `${OUT}/${role.file}.png`, fullPage: true });
  errors.length === 0 ? ok(`${role.file}: no client errors`) : bad(`${role.file}: ${errors.slice(0, 2).join(" | ")}`);
  await ctx.close();
}

// the sign-in page itself
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.9.0.99" } });
  await localOnly(ctx);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.screenshot({ path: `${OUT}/00-login.png` });
  const t = (await page.locator("body").innerText()).toLowerCase();
  t.includes("one sign in, every desk") ? ok("login page updated") : bad("login page not updated");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
