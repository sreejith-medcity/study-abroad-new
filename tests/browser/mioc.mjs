// The MIOC app's catalogue: checked in the browser first with nothing
// written, then loaded in batches as drafts. A course the team researched by
// hand is left alone, a register's course only has its blanks filled, and a
// second run adds nothing and undoes nobody's corrections.
// Wants the plain seed.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import zlib from "node:zlib";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const n = (q) => Number(sql(q));
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const SAMPLE = fs.readFileSync("tests/fixtures/mioc-sample.sql");
const GZ = zlib.gzipSync(SAMPLE);

// A university already here, with one course from a register that lacks what the app knows.
const gb = sql("select id from countries where code = 'GB'");
sql(`insert into universities (id, name, city, country_id) values ('u_mioc_wb', 'Westbridge Mioc University', null, '${gb}') on conflict do nothing`);
sql(`insert into programs (id, name, university_id, level, source, external_code, status) values ('p_mioc_reg', 'MSc Data Science', 'u_mioc_wb', 'PG', 'REGISTER', 'REG-TEST-1', 'DRAFT')`);
const aston = () => sql("select row(p.tuition_per_year, p.min_ielts, p.intake_months, p.entry_requirements, p.status, p.updated_at)::text from programs p join universities u on u.id = p.university_id where u.name = 'Aston University' and p.name = 'MSc Business Analytics'");
const astonBefore = aston();
check(astonBefore !== "", "the hand-researched course the sample repeats is in the seed");
const miocRows = () => n("select count(*) from programs where source = 'MIOC'");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.247.9.21" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 120)); });
page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', "admin@medcityoverseas.test");
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});

async function open() {
  await page.goto(`${BASE}/admin/programs`);
  await hydrated(page);
}
async function checkFile(file) {
  await page.locator("#mioc-file").setInputFiles(file);
  await page.getByRole("button", { name: "Check the file" }).click();
  await page.locator("[data-mioc-check], [data-mioc] [role=alert]").first().waitFor({ timeout: 30000 }).catch(() => {});
}
async function load() {
  await page.locator("[data-mioc-load]").click();
  await page.locator("[data-mioc-done], [data-mioc] [role=alert]").first().waitFor({ timeout: 60000 }).catch(() => {});
  return (await page.locator("[data-mioc-done]").innerText().catch(() => "")).trim();
}

/* ---------------- Check writes nothing ---------------- */
await open();
await checkFile({ name: "mioc.sql", mimeType: "application/sql", buffer: SAMPLE });
const box = page.locator("[data-mioc-check]");
check((await box.count()) === 1, "the check reports on the file");
check((await box.locator('[data-mioc-count="programs"]').innerText()).trim() === "8", "eight courses once repeats, orphans and switched-off places are left out");
check((await box.locator('[data-mioc-count="universities-new"]').innerText()).trim() === "2", "two universities are new; the two already here are matched by name");
check((await box.innerText()).includes("Countries to add: Vietnam"), "and Vietnam is named as a country to add");
check(miocRows() === 0 && n("select count(*) from countries where code = 'VN'") === 0, "the check wrote nothing");
check(!(await page.content()).includes("Never Kept"), "the students in the file never reach the page");

/* ---------------- Load ---------------- */
const said = await load();
check(said.includes("5 new programs added as drafts"), `five new courses come in as drafts (${said.slice(0, 160)})`);
check(said.includes("2 left alone because the team researched them by hand"), "the hand-researched course is left alone, even where the app files it at another level");
check(said.includes("1 already here had empty fields filled"), "the register's course is named as filled");
check(miocRows() === 5 && n("select count(*) from programs where source = 'MIOC' and status <> 'DRAFT'") === 0, "five MIOC rows, every one a draft");
check(sql("select currency from countries where code = 'VN'") === "VND", "Vietnam is added with its own currency");
check(aston() === astonBefore, "the hand-researched course is exactly as it was");
check(sql("select row(min_ielts, min_ielts_band, tuition_per_year, intake_months, study_area, source)::text from programs where id = 'p_mioc_reg'") === '(6.5,6,17500,"{1,9}","Computer Science and IT",REGISTER)', "the register's course gains the app's IELTS, fee, intakes and area, and stays the register's");
check(n("select count(*) from programs p join universities u on u.id = p.university_id where u.name = 'Westbridge Mioc University'") === 2, "no MIOC twin beside the register's course");
check(sql("select city from universities where id = 'u_mioc_wb'") === "Leeds, England", "a university with no city gains the app's");
check(sql("select tuition_per_year is null from programs where external_code = 'MIOC:106'") === "t", "dollars at a Vietnamese institute are not taken as a fee");
check(sql("select entry_requirements from programs where external_code = 'MIOC:103'").includes("Tuition in the MIOC app: £ 14,250 for 3 semester pathway."), "a semester fee is kept in words");
check(sql("select fee_waiver from programs where external_code = 'MIOC:103'") === "Application fee waiver recorded in the MIOC app", "a waiver is recorded as one");
check(n("select count(*) from universities where name in ('Closed Mioc College', 'Empty Mioc College', 'Ljubljana Mioc School')") === 0, "switched-off and empty universities do not come over");
check(n("select count(*) from audit_logs where action = 'programs.mioc_load'") === 1, "the load is recorded");

/* ---------------- A second run, from the gzip export, after somebody corrects a row ---------------- */
sql("update programs set tuition_per_year = 33000, min_ielts = null where external_code = 'MIOC:105'");
await open();
await checkFile({ name: "mioc.sql.gz", mimeType: "application/gzip", buffer: GZ });
check((await page.locator('[data-mioc-check] [data-mioc-count="universities-new"]').innerText()).trim() === "0", "the gzip export reads the same, and every university is now here");
const again = await load();
check(again.includes("0 new programs added"), `a second run adds nothing (${again.slice(0, 160)})`);
check(miocRows() === 5, "still five MIOC rows");
check(sql("select row(tuition_per_year, min_ielts)::text from programs where external_code = 'MIOC:105'") === "(33000,)", "a corrected fee stays corrected, and a score cleared as wrong stays cleared");
check(again.includes("6 already here and left as they are"), "the second run says what it left alone: its own five, and the register course it already filled");
check(n("select count(*) from countries where code = 'VN'") === 1 && n("select count(*) from universities where name = 'Lakeshore Mioc College'") === 1, "nothing is made twice");

/* ---------------- A file that is not an export ---------------- */
await open();
await checkFile({ name: "notes.sql", mimeType: "application/sql", buffer: Buffer.from("-- nothing here\nSELECT 1;\n") });
check((await page.locator("[data-mioc]").innerText()).includes("has no tb_destinations"), "a file without the tables says which tables it needs");
await checkFile({ name: "mioc.zip", mimeType: "application/zip", buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]) });
check((await page.locator("[data-mioc]").innerText()).includes("This is a zip file"), "a zip is turned away with what to do instead");

check(errors.length === 0, `no errors ${errors.slice(0, 3).join(" | ")}`);
await ctx.close();

/* ---------------- Only the desk ---------------- */
{
  const c = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.247.9.22" } });
  const p = await c.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', "germany@medcity.test");
  await p.fill('input[name="password"]', "Password@123");
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  await p.goto(`${BASE}/admin/programs`);
  await p.waitForLoadState("domcontentloaded");
  check((await p.locator("[data-mioc]").count()) === 0, "a counsellor is not offered the MIOC load");
  await c.close();
}

await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
