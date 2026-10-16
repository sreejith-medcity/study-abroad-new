// Uploading a document that is too big must say so, not kill the screen.
//
// Written after a counsellor hit "This screen stopped working / An unexpected
// response was received from the server" while uploading documents. Whatever
// refuses an oversize file between the browser and the app, the answer the
// counsellor gets should name the file and its size.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "upl-"));
const big = path.join(dir, "passport-scan.pdf");
fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024, 0x20));
const small = path.join(dir, "small.pdf");
fs.writeFileSync(small, Buffer.from("%PDF-1.4\n% tiny\n"));

const email = sql("select u.email from users u join organizations o on o.id = u.org_id where u.role in ('COUNSELLOR','SENIOR_COUNSELLOR','PARTNER') and u.active and o.type <> 'HQ' limit 1");
const studentId = sql(`select s.id from students s join users u on u.id = s.created_by_id where u.email = '${email}' limit 1`)
  || sql("select id from students where not archived limit 1");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.254.3.9" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/students/${studentId}/documents`);
const form = page.locator("form", { has: page.locator('input[type="file"][name="file"]') }).first();
check((await form.count()) > 0, "the upload form is on the documents screen");

const typePicker = form.locator('select[name="typeCode"]');
if ((await typePicker.count()) > 0) await typePicker.selectOption({ index: 1 });
await form.locator('input[type="file"][name="file"]').setInputFiles(big);
await form.locator('button[type="submit"]').click();
await page.waitForTimeout(1200);

const body = await page.locator("body").innerText();
check(!/screen stopped working/i.test(body), "the screen does not die");
check(/11\.0 MB and the limit is 10 MB/.test(body), "it says how big the file is and what the limit is");
check(Number(sql(`select count(*) from documents where student_id = '${studentId}' and file_name = 'passport-scan.pdf'`)) === 0, "nothing was saved");

// And a normal file still goes up, so the guard has not broken the thing itself.
// Counted as a difference rather than an exact number: this suite is run again
// and again against the same database, and an exact count fails on the second.
const before = Number(sql(`select count(*) from documents where student_id = '${studentId}'`));
await form.locator('input[type="file"][name="file"]').setInputFiles(small);
await form.locator('button[type="submit"]').click();
await page.waitForTimeout(2500);
const after = Number(sql(`select count(*) from documents where student_id = '${studentId}'`));
check(after === before + 1, `a normal file still uploads (${before} to ${after})`);

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
