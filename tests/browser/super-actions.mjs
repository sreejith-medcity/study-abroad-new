import { chromium } from "playwright";
import { hydrated } from "./_errors.mjs";
const BASE = process.env.BASE ?? "http://localhost:3000";
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const login = async (page, email, password) => {
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await hydrated(page);
};
const rowOf = (page, email) => page.locator("main li").filter({ hasText: email });
/**
 * A branch folds away on this screen unless something is waiting on it, so the
 * person in it has to be brought out before their controls can be pressed.
 * Opening every shut fold is what somebody hunting for a name does.
 */
const unfold = async (page) => {
  for (let i = 0; i < 3; i++) {
    const n = await page.evaluate(() => {
      const shut = [...document.querySelectorAll("main details:not([open]) > summary")];
      shut.forEach((e) => e.click());
      return shut.length;
    });
    await page.waitForTimeout(250);
    if (n === 0) break;
  }
};
const waitText = async (page, text, label) => {
  try {
    await page.locator('main, [role="status"]').getByText(text).first().waitFor({ timeout: 8000 });
    ok(label);
    return true;
  } catch {
    bad(label);
    return false;
  }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
await login(page, "sreejith@miak.in", "Password@123");
await page.goto(`${BASE}/admin/partners`);
await hydrated(page);
await unfold(page);

// 1. promote a desk admin to super admin, then back
{
  const row = rowOf(page, "germany.desk@medcityoverseas.test");
  await row.locator('select[aria-label="Change role"]').selectOption("SUPER_ADMIN");
  await row.getByRole("button", { name: "Set role" }).click();
  await waitText(page, "is now Super admin", "promoted to super admin");
  const after = rowOf(page, "germany.desk@medcityoverseas.test");
  (await after.getByText("Super admin").count()) ? ok("chip updated") : bad("chip not updated");
  await after.locator('select[aria-label="Change role"]').selectOption("ADMIN");
  await after.getByRole("button", { name: "Set role" }).click();
  await waitText(page, "is now Overseas admin", "demoted back to admin");
}

/** Passes the password rules: long, memorable, and not built on a common word. */
const NEW_PASSWORD = "Rainy-Kochi-Bus-72";

// 2. reset a password and walk the forced change
let temp = null;
{
  const row = rowOf(page, "uk.docs@medcity.test");
  await row.getByRole("button", { name: "Reset password" }).click();
  await waitText(page, /Temporary password for/, "reset password confirmation shown");
  // Read it from the page, where it now stays until dismissed.
  const msg = await page.locator("main").getByText(/Temporary password for/).first().textContent().catch(() => null);
  const m = msg?.match(/:\s*([A-Za-z0-9#@_-]{8,})/);
  temp = m?.[1] ?? null;
  temp ? ok(`temp password issued (${temp.length} chars)`) : bad("no temp password in the confirmation: " + msg);
  (await rowOf(page, "uk.docs@medcity.test").getByText("Temporary password").count()) ? ok("row flags the temporary password") : bad("no temporary password chip");
  await page.screenshot({ path: "/tmp/smoke-super/06-reset.png", fullPage: true });
}

if (temp) {
  const c2 = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const p2 = await c2.newPage();
  await login(p2, "uk.docs@medcity.test", temp);
  p2.url().includes("/change-password") ? ok("forced to change password") : bad("landed on " + p2.url());
  await p2.goto(`${BASE}/students`);
  await hydrated(p2);
  p2.url().includes("/change-password") ? ok("cannot use the app before changing it") : bad("reached " + p2.url());
  await p2.screenshot({ path: "/tmp/smoke-super/07-must-change.png" });
  await p2.fill('input[name="current"]', temp).catch(() => {});
  const fields = await p2.locator("main input[type=password]").count();
  const names = await p2.locator("main input[type=password]").evaluateAll((els) => els.map((e) => e.name));
  console.log("      password fields:", names.join(", "));
  for (const [i, n] of names.entries()) {
    await p2.locator("main input[type=password]").nth(i).fill(n.includes("current") || n.includes("old") ? temp : NEW_PASSWORD);
  }
  await p2.locator("main button[type=submit]").first().click();
  try {
    await p2.waitForURL((u) => !String(u).includes("change-password"), { timeout: 10000 });
    ok("password changed, app unlocked (" + p2.url() + ")");
  } catch {
    bad("still stuck at " + p2.url() + " with " + fields + " fields");
  }
  await c2.close();

  // the new password works and no longer forces a change
  const c4 = await browser.newContext();
  const p4 = await c4.newPage();
  await login(p4, "uk.docs@medcity.test", NEW_PASSWORD);
  !p4.url().includes("/login") && !p4.url().includes("/change-password")
    ? ok("new password signs in straight to the app (" + p4.url() + ")")
    : bad("new password landed on " + p4.url());
  await c4.close();

  // old temp password must no longer work
  const c3 = await browser.newContext();
  const p3 = await c3.newPage();
  await login(p3, "uk.docs@medcity.test", temp);
  p3.url().includes("/login") ? ok("old temporary password rejected") : bad("temp password still works: " + p3.url());
  await c3.close();
}

// 3. the audit log records all of it
await page.goto(`${BASE}/admin/audit`);
await hydrated(page);
const text = await page.locator("main").innerText();
["Role changed", "Password reset by admin"].forEach((label) =>
  text.includes(label) ? ok(`audit log shows "${label}"`) : bad(`audit log missing "${label}"`),
);
await page.screenshot({ path: "/tmp/smoke-super/08-audit-after.png", fullPage: false });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURES` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
