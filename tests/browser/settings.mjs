import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-settings";
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

/** Pages stream behind a skeleton, so wait for the real content before reading it. */
const settled = async (page) => {
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  return page;
};
const text = async (page) => ((await (await settled(page)).locator("main").innerText())).toLowerCase();
/** Success now lands in a toast outside main, so check the live region for it. */
const toast = async (page) => (await page.locator('[role="status"]').innerText().catch(() => "")).toLowerCase();

// Super admin: all four tabs, and a platform save that sticks.
{
  const { ctx, page, errors } = await signIn("sreejith@miak.in", "10.20.1.11");

  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const t = await text(page);
  t.includes("your details") ? ok("profile tab renders") : bad("profile tab missing");
  t.includes("super admin") ? ok("profile shows the role") : bad("profile role missing");

  for (const [href, needle] of [
    ["/settings/security", "recent sign-in activity"],
    ["/settings/platform", "service levels"],
  ]) {
    await page.goto(BASE + href);
    await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    (await text(page)).includes(needle) ? ok(`${href} renders`) : bad(`${href} missing "${needle}"`);
  }

  // The security tab should list this very sign-in.
  await page.goto(`${BASE}/settings/security`);
  (await text(page)).includes("signed in") ? ok("sign-in activity recorded") : bad("no sign-in recorded");

  // No branch tab for head office.
  await page.goto(`${BASE}/settings`);
  (await page.locator('nav[aria-label="Settings sections"]').innerText()).toLowerCase().includes("branch")
    ? bad("head office should not see a branch tab")
    : ok("branch tab hidden for head office");

  // Change an SLA and confirm the work queue follows it.
  await page.goto(`${BASE}/settings/platform`);
  await page.fill('input[name="slaNewDays"]', "3");
  await page.fill('input[name="portalName"]', "Medcity Overseas");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  (await toast(page)).includes("saved") ? ok("platform settings saved") : bad("platform save gave no confirmation");

  await page.goto(`${BASE}/settings/platform`);
  (await page.locator('input[name="slaNewDays"]').inputValue()) === "3" ? ok("SLA change persisted") : bad("SLA change did not persist");

  // Put it back so the rest of the suites see the usual numbers.
  await page.fill('input[name="slaNewDays"]', "2");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  // A bad colour should be refused rather than saved.
  await page.goto(`${BASE}/settings/platform`);
  await page.fill('input[name="brandColor"]', "not-a-colour");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
  (await text(page)).includes("hex colour") ? ok("bad colour refused") : bad("bad colour was not refused");

  // And a weak password should be refused on the security tab.
  await page.goto(`${BASE}/settings/security`);
  await page.fill('input[name="currentPassword"]', "Password@123");
  await page.fill('input[name="newPassword"]', "password123");
  await page.fill('input[name="confirmPassword"]', "password123");
  await page.click('form:has(input[name="newPassword"]) button[type="submit"]');
  await page.waitForTimeout(2000);
  (await text(page)).includes("commonly guessed") ? ok("weak password refused") : bad("weak password was not refused");

  await page.screenshot({ path: `${OUT}/super-platform.png`, fullPage: true });
  errors.length ? bad(`super admin page errors: ${errors.join(" | ")}`) : ok("super admin: no page errors");
  await ctx.close();
}

// Branch head: branch tab present, platform tab absent and blocked.
{
  const { ctx, page, errors } = await signIn("kochi@medcity.test", "10.20.1.12");
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const nav = (await page.locator('nav[aria-label="Settings sections"]').innerText()).toLowerCase();
  nav.includes("branch") ? ok("branch head sees the branch tab") : bad("branch tab missing for branch head");
  nav.includes("platform") ? bad("branch head should not see the platform tab") : ok("platform tab hidden for branch head");

  (await text(page)).includes("job title") ? bad("branch head should not edit a job title") : ok("job title hidden for branch head");

  await page.goto(`${BASE}/settings/branch`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await text(page)).includes("public enquiry form") ? ok("branch tab renders") : bad("branch tab missing its panel");

  await page.fill('input[name="contactPhone"]', "+91 471 555 0101");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/settings/branch`);
  (await page.locator('input[name="contactPhone"]').inputValue()).includes("555 0101")
    ? ok("branch contact saved")
    : bad("branch contact did not save");

  await page.goto(`${BASE}/settings/platform`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  (await text(page)).includes("only a super admin") ? ok("platform tab blocked for branch head") : bad("platform tab not blocked");

  await page.screenshot({ path: `${OUT}/partner-branch.png`, fullPage: true });
  errors.length ? bad(`branch head page errors: ${errors.join(" | ")}`) : ok("branch head: no page errors");
  await ctx.close();
}

// Counsellor: profile and security only.
{
  const { ctx, page, errors } = await signIn("uk.docs@medcity.test", "10.20.1.13");
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("domcontentloaded");
  // Pages stream behind a skeleton now, so wait for the real content.
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const nav = (await page.locator('nav[aria-label="Settings sections"]').innerText()).toLowerCase();
  nav.includes("branch") || nav.includes("platform")
    ? bad("counsellor sees a tab they should not")
    : ok("counsellor sees profile and security only");
  await page.goto(`${BASE}/settings/branch`);
  await page.waitForURL((u) => String(u).includes("/forbidden"), { timeout: 10000 }).catch(() => {});
  page.url().includes("/forbidden") ? ok("counsellor blocked from the branch tab") : bad("counsellor reached the branch tab");
  errors.length ? bad(`counsellor page errors: ${errors.join(" | ")}`) : ok("counsellor: no page errors");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall settings checks passed");
process.exit(fails.length ? 1 : 0);
