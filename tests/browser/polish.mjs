import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-polish";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});

async function signIn(email, ip, password = "Password@123") {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForURL((u) => new URL(String(u)).pathname !== "/", { timeout: 15000 }).catch(() => {});
  return { ctx, page, errors };
}

// The palette: opens on the keyboard, finds a screen, finds a student, and navigates.
{
  const { ctx, page, errors } = await signIn("sreejith@miak.in", "10.30.2.11");
  await page.goto(`${BASE}/dashboard`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});

  await page.keyboard.press("Control+k");
  const dialog = page.locator('[role="dialog"][aria-label="Search the portal"]');
  await dialog.waitFor({ timeout: 8000 }).catch(() => {});
  (await dialog.isVisible()) ? ok("palette opens on Ctrl+K") : bad("palette did not open");

  await dialog.getByLabel("Search the portal").fill("commission");
  await page.waitForTimeout(700);
  (await dialog.innerText()).toLowerCase().includes("commission") ? ok("palette finds a screen") : bad("palette did not find a screen");

  await page.keyboard.press("Enter");
  await page.waitForURL((u) => String(u).includes("commission"), { timeout: 20000 }).catch(() => {});
  page.url().includes("commission") ? ok("palette navigates") : bad(`palette did not navigate, at ${page.url()}`);

  // A student by name, which goes through the scoped endpoint.
  await page.keyboard.press("Control+k");
  await dialog.waitFor({ timeout: 8000 }).catch(() => {});
  await dialog.getByLabel("Search the portal").fill("fathima");
  await page.waitForTimeout(2500);
  const body = (await dialog.innerText()).toLowerCase();
  body.includes("students") && body.includes("fathima") ? ok("palette finds a student") : bad("palette did not find a student");
  await page.screenshot({ path: `${OUT}/palette.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  (await dialog.isVisible()) ? bad("palette stayed open after Escape") : ok("palette closes on Escape");

  // A save should raise a toast rather than only an inline note.
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await page.fill('input[name="phone"]', "+91 98470 00001");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  const toast = await page.locator('[role="status"]').innerText().catch(() => "");
  toast.toLowerCase().includes("saved") ? ok("save raises a toast") : bad("no toast after saving");
  await page.screenshot({ path: `${OUT}/toast.png` });

  errors.length ? bad(`page errors: ${errors.join(" | ")}`) : ok("no page errors");
  await ctx.close();
}

// The palette must not reach across organisations.
{
  const { ctx, page, errors } = await signIn("kochi@medcity.test", "10.30.2.12");
  const response = await page.request.get(`${BASE}/api/palette?q=horizon`);
  const data = await response.json();
  data.hits.some((h) => h.kind === "partner") ? bad("a partner saw organisations in the palette") : ok("partners see no organisations");

  const other = await (await page.request.get(`${BASE}/api/palette?q=a`)).json();
  other.hits.length === 0 ? ok("one letter returns nothing") : bad("one letter returned results");
  errors.length ? bad(`partner page errors: ${errors.join(" | ")}`) : ok("partner: no page errors");
  await ctx.close();
}

// Signed out, the palette endpoint gives nothing away.
{
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.30.2.13" } });
  const page = await ctx.newPage();
  const response = await page.request.get(`${BASE}/api/palette?q=fathima`);
  response.status() === 401 ? ok("palette endpoint needs a session") : bad(`palette endpoint returned ${response.status()} when signed out`);
  await ctx.close();
}

// Mobile: the shell, the menu and a dashboard at phone width.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-forwarded-for": "10.30.2.14" } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', "kochi@medcity.test");
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  overflow <= 2 ? ok("dashboard does not scroll sideways on a phone") : bad(`dashboard overflows by ${overflow}px on a phone`);

  await page.click('button[aria-label="Open menu"]');
  await page.waitForTimeout(600);
  (await page.locator(String.raw`div[role="dialog"] nav[aria-label="Main"], nav[aria-label="Main"]`).first().isVisible()) ? ok("mobile menu opens") : bad("mobile menu did not open");
  await page.screenshot({ path: `${OUT}/mobile-menu.png` });
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall polish checks passed");
process.exit(fails.length ? 1 : 0);
