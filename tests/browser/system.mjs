import { chromium } from "playwright";
import { knownWarning } from "./_errors.mjs";
import fs from "node:fs";

/**
 * The System screen: the owner sees the release, the database counts, the
 * documents and the scheduled jobs; Run now on the day end report records a
 * run started by hand; an Overseas admin reads the same screen without Run now;
 * a counsellor is kept off it.
 */

const OUT = "/tmp/smoke-system";
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:3000";
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
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(`${page.url()}: ${String(e).slice(0, 120)}`); });
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
const text = async (page) => { await settle(page); return page.locator("main").innerText(); };

// The owner: everything, and Run now.
{
  const { ctx, page, errors } = await signIn("sreejith@miak.in", "10.60.1.11");

  // It is in the menu.
  await page.goto(`${BASE}/dashboard`);
  await settle(page);
  (await page.locator("nav").getByText("System", { exact: true }).count()) > 0 ? ok("System is in the owner's menu") : bad("System is not in the menu");

  await page.goto(`${BASE}/admin/system`);
  const t = await text(page);
  await page.screenshot({ path: `${OUT}/00-system.png`, fullPage: true });

  // Release: the version is the number from package.json, or "dev" without a build.
  /version\s*\n?\s*(\d+\.\d+\.\d+|dev)/i.test(t) ? ok("the version is shown") : bad("no version on the screen");
  /what's new/i.test(t) ? ok("it links to What's new") : bad("no What's new link");
  (await page.getByRole("link", { name: /what's new/i }).getAttribute("href")) === "/whats-new" ? ok("the What's new link goes to the page") : bad("the What's new link goes elsewhere");

  // Database: reachable, a Postgres version, the six counts, the migrations line.
  /reachable/i.test(t) ? ok("the database is reported reachable") : bad("the database is not reported reachable");
  /postgres version\s*\n?\s*\d+/i.test(t) ? ok("the Postgres version is shown") : bad("no Postgres version");
  for (const label of ["Students", "Applications", "Documents", "Programs", "Universities", "Users"]) {
    new RegExp(`${label}\\s*\\n?\\s*\\d+`).test(t) ? ok(`${label} are counted`) : bad(`${label} are not counted`);
  }
  /\d+ recorded, \d+ in this build/i.test(t) ? ok("migrations recorded are compared with the build") : bad("no migrations comparison");
  // A seeded development database was migrated by drizzle-kit, so the two should agree.
  (await page.locator("[data-migrations]").getAttribute("data-migrations")) === "in-step"
    ? ok("the database and the build are in step")
    : bad("the migrations are reported out of step: " + (await page.locator("[data-migrations]").innerText()).replace(/\s+/g, " "));

  // Documents: a storage mode and a write test, and a folder when on disk.
  /supabase storage|disk/i.test(t) ? ok("the storage mode is named") : bad("no storage mode");
  /a file was written and removed/i.test(t) ? ok("the write test passed") : bad("the write test did not pass");
  if (/stored in a folder/i.test(t)) {
    /folder\s*\n?\s*\//i.test(t) ? ok("the upload folder is shown") : bad("no upload folder");
    /free of/i.test(t) ? ok("free space is shown") : bad("no free space figure");
    /of the latest \d+ documents/i.test(t) ? ok("the sample of files on disk is counted") : bad("no sample count");
    /a sample/i.test(t) ? ok("it says the file check is a sample") : bad("it does not say the check is a sample");
  }

  // Scheduled jobs: all five, each with a standing, and a Run now per job.
  for (const job of ["crm", "documents", "cricos", "journal", "ausbildung"]) {
    (await page.locator(`tr[data-job="${job}"]`).count()) === 1 ? ok(`the ${job} job is listed`) : bad(`the ${job} job is missing`);
  }
  /on time|overdue/i.test(t) ? ok("each job has a standing") : bad("no standings");
  (await page.locator("[data-run-now] button").count()) === 5 ? ok("the owner has Run now on every job") : bad("Run now is not on every job");

  // Health and the clock.
  /\{"ok":true\}/.test(t) ? ok("the health answer is the one /api/health gives") : bad("no health answer");
  /server clock, utc/i.test(t) && /server clock, india/i.test(t) && /IST/.test(t) ? ok("the clock is shown in UTC and India time") : bad("no clock");

  // Nothing secret.
  /postgres(ql)?:\/\//i.test(t) ? bad("a connection string is on the screen") : ok("no connection string on the screen");
  // The page says it holds no password, so the check is for the shapes a leaked value would take, not the word.
  /CRON_SECRET=|AUTH_SECRET=|service_role|Bearer\s+\S{20,}|eyJ[A-Za-z0-9_-]{20,}/.test(t) ? bad("the screen shows a secret value") : ok("no secret value on the screen");

  // Run now on the day end report records a run started by hand.
  const before = await page.locator('tr[data-job="journal"] [data-manual-run]').count();
  await page.locator('[data-run-now="journal"] button').click();
  await page.locator('[role="status"]').getByText(/The day end report ran in \d+ ms/).waitFor({ timeout: 30000 }).then(
    () => ok("Run now reports the job ran"),
    () => bad("Run now gave no answer"),
  );
  await page.waitForTimeout(1500);
  await page.reload();
  const after = await text(page);
  (await page.locator('tr[data-job="journal"] [data-manual-run]').count()) > before || /run by hand/i.test(after)
    ? ok("the run is recorded as started by hand")
    : bad("no record of the manual run on the row");
  await page.screenshot({ path: `${OUT}/01-after-run.png`, fullPage: true });

  // The run is in the audit log as this person's, not the scheduler's.
  await page.goto(`${BASE}/admin/audit?action=cron.ran`);
  await settle(page);
  const log = await page.locator("main").innerText();
  /cron\.ran/.test(log) && /sreejith|journal/i.test(log) ? ok("the manual run is in the audit log") : bad("the audit log has no cron.ran entry for the run");

  // Copy report: the text is there and holds the sections.
  await page.goto(`${BASE}/admin/system`);
  await settle(page);
  await page.getByRole("button", { name: /show as text/i }).click();
  const report = await page.locator("[data-system-report]").innerText();
  /system report/i.test(report) && /Release/.test(report) && /Database/.test(report) && /Scheduled jobs/.test(report) && /Health/.test(report)
    ? ok("the text report carries every section")
    : bad("the text report is incomplete");
  /postgres(ql)?:\/\//i.test(report) ? bad("the text report holds a connection string") : ok("the text report holds no connection string");
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  await page.getByRole("button", { name: /^copy report$/i }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
  copied.includes("system report") || /report copied|clipboard access/i.test(await page.locator('[role="status"]').innerText().catch(() => ""))
    ? ok("Copy report puts the report on the clipboard, or says why it could not")
    : bad("Copy report did nothing");

  errors.length ? bad(`page errors: ${errors.join(" | ")}`) : ok("no page errors for the owner");
  await ctx.close();
}

// An Overseas admin reads it, without Run now.
{
  const { ctx, page, errors } = await signIn("admin@medcityoverseas.test", "10.60.1.12");
  await page.goto(`${BASE}/admin/system`);
  const t = await text(page);
  page.url().includes("/admin/system") && /scheduled jobs/i.test(t) ? ok("an admin opens the System screen") : bad("an admin could not open System");
  /version/i.test(t) && /students/i.test(t) ? ok("an admin sees the version and the counts") : bad("an admin is missing the version or counts");
  (await page.locator("[data-run-now] button").count()) === 0 ? ok("an admin has no Run now") : bad("an admin was offered Run now");
  /a super admin can run one by hand/i.test(t) ? ok("an admin is told who can run a job") : bad("no note on who can run a job");
  await page.screenshot({ path: `${OUT}/02-admin.png`, fullPage: true });
  errors.length ? bad(`page errors: ${errors.join(" | ")}`) : ok("no page errors for the admin");
  await ctx.close();
}

// A counsellor cannot open it.
{
  const { ctx, page } = await signIn("uk.docs@medcity.test", "10.60.1.13");
  await page.goto(`${BASE}/admin/system`);
  await settle(page);
  const body = (await page.locator("body").innerText()).toLowerCase();
  page.url().includes("/forbidden") || (!page.url().includes("/admin/system") && !body.includes("scheduled jobs")) || body.includes("forbidden")
    ? ok("a counsellor is kept off the System screen")
    : bad("a counsellor reached the System screen");
  (await page.locator("nav").getByText("System", { exact: true }).count()) === 0 ? ok("System is not in a counsellor's menu") : bad("System is in a counsellor's menu");
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall system checks passed");
process.exit(fails.length ? 1 : 0);
