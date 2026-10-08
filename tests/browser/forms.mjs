// What a form says about what you typed, and when it stops saying it.
//
// Reported as "it will not accept a valid contact": the row had a phone and an
// email in it and still showed "Give a phone number or an email" under the
// phone. The row was fine. The complaint was from the attempt before and had
// simply never gone away.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const student = sql("select coalesce((select a.student_id from applications a where a.handed_over_at is not null limit 1), (select id from students where not archived limit 1))");
sql(`update students set profile_locked = false where id = '${student}'`);
const before = Number(sql(`select count(*) from student_contacts where student_id = '${student}'`));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": "10.254.1.9" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', "documentation@medcityoverseas.test");
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
await page.goto(`${BASE}/students/${student}/profile`, { waitUntil: "domcontentloaded" });
await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});

const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add contact" }) }).first();
check(await form.count() > 0, "the contacts row is on the profile");

// A name and nothing to reach them on: refused, and it says why.
await form.locator('input[name="name"]').fill("Dawn Willson");
await form.getByRole("button", { name: "Add contact" }).click();
await page.waitForTimeout(1500);
check(await form.getByText("Give a phone number or an email").count() > 0, "a contact with no phone and no email is refused, under the field it concerns");

// Typing the phone puts that right, and the complaint goes with it, before any
// second press.
await form.locator('input[name="phone"]').fill("7012777503");
await page.waitForTimeout(400);
check((await form.getByText("Give a phone number or an email").count()) === 0, "and the complaint clears as soon as the phone is typed, rather than sitting there looking like a refusal");
check((await form.getByText("Check the highlighted fields.").count()) === 0, "the banner above it goes too");

// And the row that was complained about saves.
await form.locator('input[name="email"]').fill("dawnnwillson@gmail.com");
await form.getByRole("button", { name: "Add contact" }).click();
await page.waitForTimeout(2000);
const after = Number(sql(`select count(*) from student_contacts where student_id = '${student}'`));
check(after === before + 1, `a contact with a ten-digit Indian mobile and an email is accepted (${before} to ${after})`);
const saved = sql(`select phone || '|' || coalesce(email, '') from student_contacts where student_id = '${student}' order by created_at desc limit 1`);
check(saved.startsWith("7012777503|dawnnwillson@gmail.com"), `and both are on the record (${saved})`);

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
