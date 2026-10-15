// A finished part of the student profile folds away; a part still wanting
// something stays open; and the jump links at the top still reach either.
//
// Written after the profile was four and a half screens tall for an admin,
// almost all of it already filled in and read-only.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
// A student with a filled-in file, not whichever one a test made last: an
// empty file has nothing finished in it, so nothing would fold.
const studentId = sql(`
  select s.id from students s
  where not s.archived
  order by (select count(*) from academic_records a where a.student_id = s.id) desc, s.created_at desc
  limit 1`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.250.4.4" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/students/${studentId}/profile`);
await page.waitForTimeout(300);

const ids = ["personal", "academics", "work", "tests", "background", "contacts"];
for (const id of ids) check((await page.locator(`#${id} details`).count()) === 1, `${id} is a folding part`);

// Whatever the data, a part reading Complete must be folded and one reading
// Incomplete must be open. That is the rule, checked against the real page.
let folded = 0;
for (const id of ids) {
  const state = (await page.locator(`#${id} summary`).innerText()).trim();
  const open = await page.locator(`#${id} details`).evaluate((d) => d.open);
  if (/Complete/.test(state)) { check(!open, `${id} is done so it is folded`); folded += 1; }
  if (/Incomplete/.test(state)) check(open, `${id} still wants something so it is open`);
}
check(folded > 0, `at least one part was folded away (${folded})`);

// The page must be shorter than it was. Four and a half screens was the
// complaint; anything approaching that again is a regression.
const screens = await page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
check(screens < 3, `the profile is under three screens tall (${screens.toFixed(1)})`);

// The jump row still has to reach a folded part, which means opening it.
const target = ids.find(async (id) => !(await page.locator(`#${id} details`).evaluate((d) => d.open))) ?? "contacts";
await page.goto(`${BASE}/students/${studentId}/profile#${target}`);
await page.waitForTimeout(400);
check(await page.locator(`#${target} details`).evaluate((d) => d.open), `arriving on #${target} opens it`);

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
