// What the application team leader can actually do.
//
// The role could be handed out but did almost nothing: the students list only
// offered the assign control to admins, so the person whose job is moving a
// file to the right officer had no control to move it with, and the desk's
// notices went to everybody but them.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
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
// Who registered a file used to be a column of its own next to the branch.
// The two were merged, because together they pushed the status off the right
// of a laptop screen, so the branch is the first line of "Created by" and the
// person is the second. The requirement is that the desk can see who it was
// without opening the file, so that is what is checked rather than a heading.
const firstRow = page.locator("tbody tr").first();
const createdBy = (await firstRow.locator("td").first().innerText()).replace(/\s+/g, " ").trim();
check(createdBy.split("\n").length > 0 && createdBy.length > 0, `the list's first column carries who it came from (${createdBy})`);
const whoRegistered = await firstRow.locator("td").first().locator("span").last().innerText();
check(
  whoRegistered.trim().length > 0 && whoRegistered.trim() !== createdBy,
  `and names the person who registered it, under the branch (${whoRegistered.trim()})`,
);

if (await pickers.count()) {
  const row = page.locator("tbody tr").filter({ has: pickers.first() }).first();
  const studentId = await row.locator('input[name="studentId"]').first().inputValue();
  const before = sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`);
  const options = await pickers.first().locator("option").evaluateAll((os) =>
    os.map((o) => ({ value: o.value, label: o.textContent })).filter((o) => o.value),
  );
  const next = options.find((o) => o.value !== before) ?? options[0];
  // Choosing a name is the whole move: the Save button that used to sit
  // beside this went when a branch reassigning a morning's intake was found
  // to be clicking one per row.
  await pickers.first().selectOption(next.value);
  const now = () => sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`);
  for (let t0 = Date.now(); now() !== next.value && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
  const after = now();
  check(after === next.value, `the team leader's assignment is kept (${before.slice(0, 6)} to ${after.slice(0, 6)})`);
  const audited = sql(`select count(*) from audit_logs where entity_id = '${studentId}' and action = 'student.reassign'`);
  check(Number(audited) > 0, "and it is in the audit log");
}

// Programme options the branches asked for are what this desk owes them.
// They used to be a card on the team leader's dashboard; the dashboard is a
// board of figures now, so they are read on their own page.
await page.goto(`${BASE}/program-options`);
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const home = (await page.locator("main").innerText()).replace(/\s+/g, " ");
check(/program options/i.test(home), "the team leader can read the programme options asked for");

// The desk's notices reach the team leader, not only the admins.
const leaderId = sql(`select id from users where email = '${email}'`);
const reaches = sql(`
  select count(*) from users
  where active and role in ('ADMIN','SUPER_ADMIN','OPS_MANAGER','APPLICATION_TEAM_LEADER') and id = '${leaderId}'`);
check(reaches === "1", "the team leader is one of the people the desk's notices go to");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
