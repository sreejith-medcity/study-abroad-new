// The students list, fifty at a time.
//
// It used to draw two hundred rows at once and stop there: slow to open on a
// big branch, and everybody past the two hundredth could not be reached from
// the list at all. Now it draws fifty, says how many there are, and offers the
// next fifty, keeping whatever filters were on.
// Wants the plain seed; adds its own students.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const n = (q) => Number(sql(q));
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = "kottayam@medcity.test";
const org = sql(`select org_id from users where email = '${email}'`);
// 230 more students in the branch, so the old cap of two hundred is passed.
sql(`insert into students (id, org_id, portal_token, first_name, last_name, phone, created_at)
     select 'pg_s' || g, '${org}', 'pg_t' || g, 'Paging', 'Student ' || lpad(g::text, 3, '0'), '91000' || lpad(g::text, 5, '0'), now() - (g || ' minutes')::interval
     from generate_series(1, 230) g`);
const total = n(`select count(*) from students where org_id = '${org}' and not archived`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.244.7.11" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 120)); });
page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});

const open = async (path) => {
  await page.goto(`${BASE}${path}`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
};
const rows = () => page.locator("main tbody tr").count();
const foot = async () => (await page.locator("[data-list-foot]").innerText()).replace(/\s+/g, " ");

await open("/students");
check((await rows()) === 50, `the list opens on fifty (${await rows()})`);
check((await foot()).includes(`of ${total.toLocaleString("en-IN")}`), `and says how many there are (${await foot()})`);

await page.getByRole("link", { name: /Show 50 more/ }).click();
await page.waitForURL(/show=100/, { timeout: 15000 });
await hydrated(page);
check((await rows()) === 100, `"show more" adds the next fifty (${await rows()})`);

await open(`/students?show=${total + 50}`);
check((await rows()) === total, `everybody can be reached, past the old two hundred (${await rows()} of ${total})`);
check((await page.getByRole("link", { name: /more$/ }).count()) === 0, "and there is no 'more' once the end is reached");

// The filters stay on while paging.
const matching = n(`select count(*) from students where org_id = '${org}' and not archived and last_name like 'Student 1%'`);
await open(`/students?q=${encodeURIComponent("Student 1")}`);
check((await foot()).includes(`of ${matching}`), `a search counts only what it finds (${await foot()}, ${matching} in the database)`);
if (matching > 50) {
  await page.getByRole("link", { name: /more$/ }).click();
  await page.waitForURL(/show=100/, { timeout: 15000 });
  await hydrated(page);
  const href = page.url();
  check(href.includes("q=Student"), "and 'show more' keeps the search");
  check((await rows()) === Math.min(100, matching), `and draws the next of them (${await rows()})`);
}

// A nonsense page size is read as the first page, not as an error.
await open("/students?show=banana");
check((await rows()) === 50, "a page size that is not a number opens the first fifty");

check(errors.length === 0, `no errors ${errors.slice(0, 2).join(" | ")}`);
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
