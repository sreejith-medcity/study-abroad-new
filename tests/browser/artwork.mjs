import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-artwork";
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
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});

// A square PNG and a wide SVG, enough to tell the two apart on the page.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAO0lEQVR42u3OMQEAAAgDoC251a3gLwqgOTdVAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAxA1gwAAGZ3sYRAAAAAElFTkSuQmCC",
  "base64",
);
const LOGO = `${OUT}/logo.svg`;
const FAVICON = `${OUT}/favicon.png`;
fs.writeFileSync(LOGO, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 64"><rect width="240" height="64" fill="#0466af"/><text x="16" y="40" fill="#fff" font-size="26" font-family="sans-serif">SMOKE</text></svg>');
fs.writeFileSync(FAVICON, PNG);

{
  const { ctx, page, errors } = await signIn("sreejith@miak.in", "10.40.3.11");
  await page.goto(`${BASE}/settings/platform`);
  await settle(page);
  (await page.locator("main").innerText()).toLowerCase().includes("logo and favicon")
    ? ok("the artwork panel is on the platform tab")
    : bad("no artwork panel");

  // The uploader is a popup, and Escape should close it without uploading.
  await page.getByRole("button", { name: /Upload|Replace/ }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await dialog.first().waitFor({ timeout: 8000 }).catch(() => {});
  (await dialog.first().isVisible()) ? ok("the upload popup opens") : bad("upload popup did not open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  (await dialog.count()) === 0 ? ok("the popup closes on Escape") : bad("popup stayed open after Escape");

  // Upload a logo.
  await page.getByRole("button", { name: /Upload|Replace/ }).first().click();
  await dialog.first().waitFor({ timeout: 8000 });
  await page.locator('input[type="file"]').first().setInputFiles(LOGO);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/01-popup.png` });
  await dialog.getByRole("button", { name: "Upload" }).click();
  await page.waitForTimeout(3000);
  (await page.locator('[role="status"]').innerText().catch(() => "")).toLowerCase().includes("logo updated")
    ? ok("the logo uploads")
    : bad("no confirmation after uploading a logo");

  // It should be served, and it should be the file we sent.
  const served = await page.request.get(`${BASE}/api/brand/logo`);
  const type = served.headers()["content-type"] ?? "";
  served.status() === 200 && type.includes("svg") ? ok("the logo is served back as an SVG") : bad(`logo served as ${served.status()} ${type}`);
  (await served.text()).includes("SMOKE") ? ok("the served logo is the uploaded file") : bad("the served logo is not what was uploaded");

  // And it should replace the drawn mark in the header.
  await page.goto(`${BASE}/dashboard`);
  await settle(page);
  (await page.locator('header img[src*="/api/brand/logo"]').count()) ? ok("the header shows the uploaded logo") : bad("header still shows the drawn mark");
  await page.screenshot({ path: `${OUT}/02-header.png` });

  // Favicon next.
  await page.goto(`${BASE}/settings/platform`);
  await settle(page);
  await page.getByRole("button", { name: /Upload|Replace/ }).nth(1).click();
  await dialog.first().waitFor({ timeout: 8000 });
  await page.locator('input[type="file"]').first().setInputFiles(FAVICON);
  await dialog.getByRole("button", { name: "Upload" }).click();
  await page.waitForTimeout(3000);
  const icon = await page.request.get(`${BASE}/api/brand/favicon`);
  (icon.headers()["content-type"] ?? "").includes("png") ? ok("the favicon is served as a PNG") : bad("favicon not served as a PNG");

  // A browser asks for /favicon.ico on its own, so that has to reach the upload too.
  const ico = await page.request.get(`${BASE}/favicon.ico`);
  (ico.headers()["content-type"] ?? "").includes("png")
    ? ok("/favicon.ico serves the uploaded icon")
    : bad(`/favicon.ico served ${ico.headers()["content-type"]}`);

  // And it must be allowed to change: no immutable caching on the plain URL.
  const control = icon.headers()["cache-control"] ?? "";
  control.includes("must-revalidate") && !control.includes("immutable")
    ? ok("the plain favicon URL revalidates, so a replacement shows at once")
    : bad(`favicon cache-control is "${control}"`);
  (await page.request.get(`${BASE}/api/brand/favicon?v=1`)).headers()["cache-control"]?.includes("immutable")
    ? ok("the versioned URL still caches hard")
    : bad("versioned favicon is not cached");

  // An unchanged icon should answer 304 rather than resend itself.
  const tag = icon.headers()["etag"];
  const again = await page.request.get(`${BASE}/api/brand/favicon`, { headers: { "if-none-match": tag } });
  again.status() === 304 ? ok("an unchanged favicon answers 304") : bad(`revalidation returned ${again.status()}`);

  // Clearing puts the drawn mark back.
  await page.goto(`${BASE}/settings/platform`);
  await settle(page);
  await page.getByRole("button", { name: "Remove" }).first().click();
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/dashboard`);
  await settle(page);
  (await page.locator('header img[src*="/api/brand/logo"]').count()) === 0
    ? ok("removing the logo brings the drawn mark back")
    : bad("the logo is still in the header after removal");

  errors.length ? bad(`page errors: ${errors.join(" | ")}`) : ok("no page errors");
  await ctx.close();
}

// Only a super admin may change the artwork, and the files stay public to read.
{
  const { ctx, page } = await signIn("admin@medcityoverseas.test", "10.40.3.12");
  await page.goto(`${BASE}/settings/platform`);
  await settle(page);
  (await page.locator("main").innerText()).toLowerCase().includes("only a super admin")
    ? ok("an admin cannot reach the artwork panel")
    : bad("an admin reached the artwork panel");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.40.3.13" } });
  const page = await ctx.newPage();
  const r = await page.request.get(`${BASE}/api/brand/favicon`);
  r.status() === 200 ? ok("the favicon is readable signed out") : bad(`favicon returned ${r.status()} signed out`);
  const bogus = await page.request.get(`${BASE}/api/brand/anything`);
  bogus.status() === 404 ? ok("only the two known kinds are served") : bad(`an unknown kind returned ${bogus.status()}`);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall artwork checks passed");
process.exit(fails.length ? 1 : 0);
