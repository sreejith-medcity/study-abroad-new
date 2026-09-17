import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-super";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

async function login(page, email, password = "Password@123") {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

// --- super admin
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await login(page, "sreejith@miak.in");
  console.log("super admin landed on", page.url());

  const nav = page.locator('nav[aria-label="Main"]');
  (await nav.getByText("Audit log").count()) ? ok("audit log in nav") : bad("audit log missing from nav");

  await page.goto(`${BASE}/admin/audit`);
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/admin/audit")) ok("audit page reachable"); else bad("audit page redirected to " + page.url());
  const rows = await page.locator("main tbody tr").count();
  rows > 0 ? ok(`audit page shows ${rows} entries`) : bad("audit page has no rows");
  await page.screenshot({ path: `${OUT}/01-audit.png`, fullPage: false });

  // filter by action
  await page.selectOption('select[aria-label="Action"]', { label: "Student created" }).catch(() => bad("action filter missing"));
  await page.click('main button[type="submit"]');
  await page.waitForLoadState("networkidle");
  const filtered = await page.locator("main tbody tr").count();
  filtered > 0 && filtered <= rows ? ok(`action filter narrowed to ${filtered}`) : bad(`action filter gave ${filtered}`);
  await page.screenshot({ path: `${OUT}/02-audit-filtered.png` });

  // csv export
  const res = await page.request.get(`${BASE}/api/audit/export`);
  const body = await res.text();
  res.status() === 200 && body.includes("Action code") ? ok("csv export works") : bad("csv export " + res.status());

  // partners and people
  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("networkidle");
  (await page.locator("main").getByText("Super admin").count()) ? ok("super admin chip on people table") : bad("no super admin chip");
  (await page.locator('main select[aria-label="Change role"]').count()) ? ok("role change control present") : bad("no role change control");
  (await page.locator("main").getByText("Reset password").count()) ? ok("reset password control present") : bad("no reset password control");
  await page.screenshot({ path: `${OUT}/03-partners.png`, fullPage: true });

  // health detail
  const h = await page.request.get(`${BASE}/api/health`);
  const hj = await h.json();
  hj.users != null && hj.storage ? ok("health detail visible to super admin") : bad("health detail hidden: " + JSON.stringify(hj));
  await ctx.close();
}

// --- plain admin must not see the audit log
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await login(page, "admin@medcityoverseas.test");
  const nav = page.locator('nav[aria-label="Main"]');
  (await nav.getByText("Audit log").count()) === 0 ? ok("admin does not see audit nav") : bad("admin sees audit nav");
  await page.goto(`${BASE}/admin/audit`);
  await page.waitForLoadState("networkidle");
  page.url().includes("/forbidden") ? ok("admin blocked from audit page") : bad("admin reached " + page.url());
  await page.screenshot({ path: `${OUT}/04-admin-forbidden.png` });
  const res = await page.request.get(`${BASE}/api/audit/export`);
  res.status() === 404 ? ok("admin blocked from audit export") : bad("admin export status " + res.status());
  (await page.locator('main select[aria-label="Change role"]').count()) === 0 || true;
  await page.goto(`${BASE}/admin/partners`);
  await page.waitForLoadState("networkidle");
  (await page.locator('main select[aria-label="Change role"]').count()) === 0 ? ok("admin cannot change roles") : bad("admin sees role control");
  (await page.locator("main").getByText("Only a super admin").count()) ? ok("admin sees the explanation alert") : bad("no explanation alert for admin");
  await page.screenshot({ path: `${OUT}/05-admin-partners.png`, fullPage: true });
  await ctx.close();
}

// --- partner must not reach admin pages at all
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await login(page, "kottayam@medcity.test");
  await page.goto(`${BASE}/admin/audit`);
  await page.waitForLoadState("networkidle");
  page.url().includes("/forbidden") ? ok("partner blocked from audit page") : bad("partner reached " + page.url());
  const res = await page.request.get(`${BASE}/api/audit/export`);
  res.status() === 404 ? ok("partner blocked from audit export") : bad("partner export status " + res.status());
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
