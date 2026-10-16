// A destination with universities on file and no courses yet must say so.
// Written after the Course finder answered "No programs match these filters"
// for Austria, where 80 universities were loaded and no course had been added.
// A counsellor reads that as "Medcity does not do Austria".
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const unis = Number(sql("select count(*) from universities u join countries c on c.id = u.country_id where c.code = 'AT'"));
const progs = Number(sql("select count(*) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where c.code = 'AT'"));
if (unis === 0 || progs > 0) {
  console.log(`This suite needs Austrian universities and no Austrian courses. Found ${unis} universities and ${progs} courses.`);
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.252.7.11" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', sql("select email from users where role = 'SUPER_ADMIN' and active limit 1"));
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/search?country=AT`);
const body = await page.locator("body").innerText();
check(!/No programs match these filters/.test(body), "the dead end is gone");
check(/No courses are recorded for Austria yet/.test(body), "it says Austria has no courses yet");
check(new RegExp(`${unis} Austria universit`).test(body), `it says how many universities are on file (${unis})`);
check((await page.locator('a[href="/universities?country=AT"]').count()) > 0, "it links to the Austrian universities");

// The universities list must offer Austria even though it has no courses.
await page.goto(`${BASE}/universities`);
check((await page.locator('select[name="country"] option', { hasText: "Austria" }).count()) > 0, "the universities list offers Austria");
await page.goto(`${BASE}/universities?country=AT`);
const uniBody = await page.locator("body").innerText();
check(/Universitaet Wien/.test(uniBody), "and shows an Austrian university");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
