import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-p4";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});

async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}

// insights for an admin
{
  const { ctx, page, errors } = await signIn("admin@medcityoverseas.test", "10.9.3.11");
  await page.goto(`${BASE}/admin/insights`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = (await page.locator("main").innerText()).toLowerCase();
  t.includes("conversion") ? ok("insights renders") : bad("insights missing conversion table");
  t.includes("median days to offer") ? ok("timing tile present") : bad("no timing tile");
  (await page.locator("main tbody tr").count()) > 0 ? ok("breakdown has rows") : bad("breakdown is empty");
  await page.screenshot({ path: `${OUT}/01-insights.png`, fullPage: true });

  // switch dimension
  await page.getByRole("link", { name: "Destination", exact: true }).click();
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await page.locator("main").innerText()).toLowerCase().includes("united kingdom") ? ok("destination breakdown works") : bad("destination breakdown empty");

  const res = await page.request.get(`${BASE}/api/insights/export?dim=partner`);
  const body = await res.text();
  res.status() === 200 && body.includes("Offer rate") ? ok("insights csv export works") : bad("csv export " + res.status());
  errors.length === 0 ? ok("insights: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// management may read insights
{
  const { ctx, page } = await signIn("management@medcityoverseas.test", "10.9.3.12");
  await page.goto(`${BASE}/admin/insights`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  page.url().includes("/admin/insights") ? ok("management can read insights") : bad("management got " + page.url());
  await ctx.close();
}

// partner cannot
{
  const { ctx, page } = await signIn("kottayam@medcity.test", "10.9.3.13");
  await page.goto(`${BASE}/admin/insights`);
  await page.waitForURL((u) => String(u).includes("/forbidden"), { timeout: 10000 }).catch(() => {});
  page.url().includes("/forbidden") ? ok("partner is kept out of insights") : bad("partner reached " + page.url());

  // library
  await page.goto(`${BASE}/learning`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = await page.locator("main").innerText();
  t.includes("UK student visa") ? ok("partner sees the library") : bad("library empty for the partner");
  t.includes("Counter posters") ? ok("partner-only resource visible to the owner") : bad("partner-only resource missing");
  (await page.locator("main").getByText("Add a resource").count()) === 0 ? ok("partner cannot add resources") : bad("partner sees the add form");
  await page.screenshot({ path: `${OUT}/02-learning-partner.png`, fullPage: true });
  await ctx.close();
}

// counsellor does not see the partner-only item
{
  const { ctx, page } = await signIn("uk.docs@medcity.test", "10.9.3.14");
  await page.goto(`${BASE}/learning`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = await page.locator("main").innerText();
  t.includes("UK student visa") ? ok("counsellor sees shared resources") : bad("counsellor sees nothing");
  !t.includes("Counter posters") ? ok("audience filter keeps partner-only items hidden") : bad("counsellor sees a partner-only item");
  await ctx.close();
}

// admin manages the library
{
  const { ctx, page, errors } = await signIn("admin@medcityoverseas.test", "10.9.3.15");
  await page.goto(`${BASE}/learning`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await page.locator("main").getByText("Add a resource").count()) ? ok("admin sees the add form") : bad("no add form for the admin");
  const tag = String(Date.now()).slice(-5);
  await page.fill('input[name="title"]', `Smoke test guide ${tag}`);
  await page.fill('textarea[name="summary"]', "Added by the smoke test.");
  await page.fill('input[name="url"]', "https://example.com/guide");
  await page.click('button[type="submit"]:has-text("Add to the library")');
  await page.locator("main").getByText(new RegExp(`Smoke test guide ${tag}`)).first().waitFor({ timeout: 12000 })
    .then(() => ok("resource added"))
    .catch(() => bad("resource did not appear"));
  await page.screenshot({ path: `${OUT}/03-learning-admin.png`, fullPage: true });
  errors.length === 0 ? ok("library: no client errors") : bad("errors: " + errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
