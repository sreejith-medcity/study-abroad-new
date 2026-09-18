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
  await page.goto(`${BASE}/admin/go-live`);
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
  await page.goto(`${BASE}/admin/go-live`);
  await settle(page);
  const after = await page.locator("main").innerText();
  after.toLowerCase().includes("nothing found") ? ok("a second run has nothing left to do") : bad("it still thinks there is sample data");
  /already run/i.test(after) ? ok("the page still accounts for the run afterwards") : bad("no record of the run on the page");

  errors.length ? bad(`page errors: ${errors.join(" | ")}`) : ok("no page errors");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall go live checks passed");
process.exit(fails.length ? 1 : 0);
