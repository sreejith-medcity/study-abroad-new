// Menus that shut themselves.
//
// "notification tab doesnt close by its own". Both header menus were plain
// <details>, which opens on its button and closes on its button and does
// nothing else: a click on the page left the notification list hanging over
// whatever was underneath it, Escape did nothing, and opening the account
// menu left the notifications open behind it.
//
// This drives all four ways out of a menu, on the two in the header and on
// the filter dropdowns that share the behaviour. Wants the plain seed.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.204.7.1" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', "sreejith@miak.in");
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.locator("aside[data-nav]").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
await hydrated(page);

const bell = page.locator('header details').filter({ has: page.locator('summary[aria-label^="Notifications"]') }).first();
const account = page.locator('header details').filter({ has: page.locator('summary[aria-label$="account menu"]') }).first();
const isOpen = (menu) => menu.evaluate((el) => el.open);
const open = async (menu) => { await menu.locator("summary").first().click(); await page.waitForTimeout(200); };

/* ---------------- A click on the page ---------------- */

await open(bell);
check(await isOpen(bell), "the bell opens the notification list");
// Somewhere harmless and well clear of the menu, which hangs on the right.
await page.mouse.click(400, 700);
await page.waitForTimeout(250);
check(!(await isOpen(bell)), "and a click on the page shuts it again");

/* ---------------- Escape ---------------- */

await open(bell);
await page.keyboard.press("Escape");
await page.waitForTimeout(250);
check(!(await isOpen(bell)), "Escape shuts it");
check(
  await page.evaluate(() => document.activeElement?.getAttribute("aria-label")?.startsWith("Notifications") ?? false),
  "and leaves the focus on the button it came from",
);

/* ---------------- One at a time ---------------- */

await open(bell);
await open(account);
check(await isOpen(account), "the account menu opens");
check(!(await isOpen(bell)), "and opening it shuts the notification list");
await page.keyboard.press("Escape");

/* ---------------- Going somewhere ---------------- */

// A menu whose whole job is links has to let go of the screen it sends you
// to. The header does not reload between screens, so this is not free.
await open(account);
await page.getByRole("link", { name: "Settings", exact: true }).first().click();
await page.waitForURL(/\/settings/, { timeout: 15000 }).catch(() => {});
await hydrated(page);
await page.waitForTimeout(400);
check(!(await isOpen(account)), "picking something from a menu shuts it on the way");

/* ---------------- And the same on a filter ---------------- */

await page.goto(`${BASE}/search`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
await hydrated(page);
const filters = page.locator("main details").filter({ has: page.locator("fieldset") });
const many = await filters.count();
if (many >= 1) {
  await filters.first().locator("summary").click();
  await page.waitForTimeout(200);
  check(await isOpen(filters.first()), `a filter with several values opens (${many} of them)`);
  // A box inside it is the point of the thing and must not shut it.
  const box = filters.first().locator('input[type="checkbox"]').first();
  if (await box.count()) {
    await box.click();
    await page.waitForTimeout(200);
    check(await isOpen(filters.first()), "ticking a box inside it leaves it open");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(!(await isOpen(filters.first())), "and Escape shuts it");
  if (many >= 2) {
    await filters.first().locator("summary").click();
    await page.waitForTimeout(150);
    await filters.nth(1).locator("summary").click();
    await page.waitForTimeout(250);
    check(!(await isOpen(filters.first())), "two filters side by side no longer hang open over each other");
  }
} else {
  bad("no filter dropdown to check on the course search");
}

check(errors.length === 0, `no page errors or 500s ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
