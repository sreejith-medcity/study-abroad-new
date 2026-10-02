import { chromium } from "playwright";
import fs from "node:fs";

const OUT = "/tmp/smoke-golive";
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
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${String(e).slice(0, 120)}`));
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

// Only a super admin may even see it.
{
  const { ctx, page } = await signIn("admin@medcityoverseas.test", "10.50.1.12");
  await page.goto(`${BASE}/admin/go-live`);
  await settle(page);
  (await page.locator("main").innerText()).toLowerCase().includes("only a super admin")
    ? ok("an admin cannot open go live")
    : bad("an admin reached the go live screen");
  await ctx.close();
}

{
  const { ctx, page, errors } = await signIn("sreejith@miak.in", "10.50.1.11");

  // What is still unset is the tab the page opens on.
  await page.goto(`${BASE}/admin/go-live`);
  await settle(page);
  let r = await page.locator("main").innerText();
  /what is still unset/i.test(r) ? ok("the readiness tab is the one it opens on") : bad("the readiness tab is not the default");
  /needed/i.test(r) && /can wait/i.test(r) ? ok("the three severities are on the screen") : bad("no severities shown");
  // A seeded portal has demo accounts and no real billing company, so the screen
  // must be saying so rather than claiming everything is done.
  /sample accounts can no longer sign in/i.test(r) ? ok("the sample accounts are raised") : bad("the sample accounts are not raised");
  /billing company/i.test(r) ? ok("the sample billing company is raised") : bad("the billing company is not raised");
  /has never run|last ran/i.test(r) ? ok("the schedulers report whether they have run") : bad("the schedulers are not reported");
  /\d+ of \d+/.test(r) ? ok("it counts what is done against the whole list") : bad("no count of what is done");
  await page.screenshot({ path: `${OUT}/00-readiness.png`, fullPage: true });

  // Each outstanding row offers a way to the screen that settles it.
  const open = page.getByRole("link", { name: /^Open$/ });
  (await open.count()) > 0 ? ok("outstanding rows link to where they are fixed") : bad("nothing links anywhere");

  await page.goto(`${BASE}/admin/go-live?tab=sample-data`);
  await settle(page);
  let t = await page.locator("main").innerText();
  /what would be removed/i.test(t) ? ok("the review screen lists what would go") : bad("no inventory on the screen");
  /medcity kottayam/i.test(t) ? ok("sample organisations are named") : bad("organisations not listed");
  /uk\.docs@medcity\.test/i.test(t) ? ok("sample accounts are named") : bad("accounts not listed");
  /what stays/i.test(t) ? ok("it also says what stays") : bad("no 'what stays' panel");

  // The real account must never be on the removal list.
  /sreejith@miak\.in/i.test(t) ? bad("the real super admin is on the removal list") : ok("the real super admin is not on the list");
  await page.screenshot({ path: `${OUT}/01-review.png`, fullPage: true });

  // It refuses without the typed confirmation.
  await page.fill('input[name="confirm"]', "yes");
  await page.getByRole("button", { name: /Remove the sample data/i }).click();
  await page.waitForTimeout(2000);
  (await page.locator("main").innerText()).includes("Type REMOVE")
    ? ok("it refuses without the typed confirmation")
    : bad("it ran without a proper confirmation");

  // And then it runs.
  await page.fill('input[name="confirm"]', "REMOVE");
  await page.getByRole("button", { name: /Remove the sample data/i }).click();
  await page.waitForTimeout(6000);
  t = await page.locator("main").innerText();
  /sample data removed/i.test(t) ? ok("the cleanup runs and reports what is left") : bad(`no result, saw: ${t.slice(0, 200)}`);
  await page.screenshot({ path: `${OUT}/02-done.png`, fullPage: true });

  // The portal has to still work with nothing in it.
  for (const [path, needle] of [
    ["/dashboard", "platform"],
    ["/students", "no students"],
    ["/applications", "no applications"],
    ["/admin/partners", "organisations"],
    ["/admin/commission", "commission"],
    ["/enquiries", "enquiries"],
  ]) {
    await page.goto(BASE + path);
    await settle(page);
    (await page.locator("main").innerText()).toLowerCase().includes(needle)
      ? ok(`${path} still renders when empty`)
      : bad(`${path} looks wrong when empty`);
  }

  // The catalogue and the library are not sample data and must survive.
  await page.goto(`${BASE}/admin/programs`);
  await settle(page);
  /\d+ match/.test(await page.locator("main").innerText()) ? ok("the program catalogue survived") : bad("the catalogue was removed");
  await page.goto(`${BASE}/learning`);
  await settle(page);
  (await page.locator("main tbody tr, main li").count()) > 0 ? ok("the learning library survived") : bad("the library was removed");

  // Running it again must be a clean no-op.
  await page.goto(`${BASE}/admin/go-live?tab=sample-data`);
  await settle(page);
  const after = await page.locator("main").innerText();
  after.toLowerCase().includes("nothing found") ? ok("a second run has nothing left to do") : bad("it still thinks there is sample data");
  /already run/i.test(after) ? ok("the page still accounts for the run afterwards") : bad("no record of the run on the page");

  // And the readiness tab has to agree that the sample accounts are gone.
  await page.goto(`${BASE}/admin/go-live`);
  await settle(page);
  /none left/i.test(await page.locator("main").innerText())
    ? ok("readiness notices the sample accounts have gone")
    : bad("readiness still counts sample accounts after the cleanup");

  errors.length ? bad(`page errors: ${errors.join(" | ")}`) : ok("no page errors");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall go live checks passed");
process.exit(fails.length ? 1 : 0);
