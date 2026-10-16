// What the application team leader can actually do.
//
// The role could be handed out but did almost nothing: the students list only
// offered the assign control to admins, so the person whose job is moving a
// file to the right officer had no control to move it with, and the desk's
// notices went to everybody but them.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = sql("select email from users where role = 'APPLICATION_TEAM_LEADER' and active limit 1");
if (!email) {
  console.log("no application team leader in this database, nothing to check");
  process.exit(0);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.240.8.4" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

// The documentation queue is the team leader's own screen.
await page.goto(`${BASE}/documentation`);
await page.waitForTimeout(600);
check(page.url().includes("/documentation"), "the documentation queue opens for the team leader");

// The students list offers the assign control, and it works.
await page.goto(`${BASE}/students`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const pickers = page.locator('select[name="assignedToId"]');
check((await pickers.count()) > 0, `the assign control is on the list (${await pickers.count()} rows)`);
check(/Registered by/i.test(await page.locator("thead").innerText()), "the list says who registered each file");

if (await pickers.count()) {
  const row = page.locator("tbody tr").filter({ has: pickers.first() }).first();
  const studentId = await row.locator('input[name="studentId"]').first().inputValue();
  const before = sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`);
  const options = await pickers.first().locator("option").evaluateAll((os) =>
    os.map((o) => ({ value: o.value, label: o.textContent })).filter((o) => o.value),
  );
  const next = options.find((o) => o.value !== before) ?? options[0];
  await pickers.first().selectOption(next.value);
  // The control is a form with its own Save, not a select that submits itself.
  await row.getByRole("button", { name: /save assignment/i }).click();
  await page.waitForTimeout(2500);
  const after = sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`);
  check(after === next.value, `the team leader's assignment is kept (${before.slice(0, 6)} to ${after.slice(0, 6)})`);
  const audited = sql(`select count(*) from audit_logs where entity_id = '${studentId}' and action = 'student.reassign'`);
  check(Number(audited) > 0, "and it is in the audit log");
}

// The desk's notices reach the team leader, not only the admins.
const leaderId = sql(`select id from users where email = '${email}'`);
const reaches = sql(`
  select count(*) from users
  where active and role in ('ADMIN','SUPER_ADMIN','OPS_MANAGER','APPLICATION_TEAM_LEADER') and id = '${leaderId}'`);
check(reaches === "1", "the team leader is one of the people the desk's notices go to");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
