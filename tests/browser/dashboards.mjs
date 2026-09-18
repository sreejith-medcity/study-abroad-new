import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-dash";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const ROLES = [
  { file: "01-super-admin", email: "sreejith@miak.in", expect: ["Platform owner", "Accounts by role", "Accounts that need an owner"], nav: "Audit log" },
  { file: "02-admin", email: "admin@medcityoverseas.test", expect: ["Processing desk", "Lane health", "Partner activity"], nav: "Work queue" },
  { file: "03-management", email: "management@medcityoverseas.test", expect: ["Management view", "Conversion funnel", "Partner performance"], nav: "Performance" },
  { file: "04-partner", email: "kottayam@medcity.test", expect: ["Branch workspace", "Your team", "Benefits level"], nav: "Students" },
  { file: "05-counsellor", email: "uk.docs@medcity.test", expect: ["Your desk", "Waiting on you", "Student replies"], nav: "My desk" },
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
  page.on("pageerror", (e) => errors.push(String(e)));
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
  t.includes("one sign in, five views") ? ok("login page updated") : bad("login page not updated");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
