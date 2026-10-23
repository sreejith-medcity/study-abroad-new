// The MIOC app's catalogue: checked in the browser first with nothing
// written, then loaded in batches as drafts. A course the team researched by
// hand is left alone, a register's course only has its blanks filled, and a
// second run adds nothing and undoes nobody's corrections. University profiles
// and destination guides come with it, filling blanks only, shown as plain
// text, and never filled again once somebody edits or clears them.
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
async function until(q, want, ms = 10000) {
  const end = Date.now() + ms;
  let got = sql(q);
  while (got !== want && Date.now() < end) {
    await page.waitForTimeout(250);
    got = sql(q);
  }
  return got;
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
check((await box.locator('[data-mioc-count="profiles"]').innerText()).trim() === "2", "two university profiles: the switched-off and the vanished university bring none");
check((await box.locator('[data-mioc-count="guides"]').innerText()).trim() === "3", "three destination guides; switched-off Slovenia brings none");
check(n("select count(*) from universities where about is not null or cardinality(facts) > 0") === 0 && n("select count(*) from countries where guide is not null or jsonb_array_length(faqs) > 0") === 0, "the check wrote no profile and no guide");

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

/* ---------------- Profiles and guides ---------------- */
check(said.includes("about text for 2 universities, a website for 1, facts for 2"), `the load says which profiles it filled (${said.slice(0, 400)})`);
check(said.includes("Destination guides filled in for 3 countries"), "and that three destination guides were filled in");
check(sql("select about from universities where id = 'u_mioc_wb'") === "Westbridge Mioc University is invented for the suites.\n\nIts second paragraph is made up too.", "the about text keeps its paragraphs");
check(sql("select website from universities where id = 'u_mioc_wb'") === "https://www.westbridge-mioc.example", "the Web Url line becomes the website, as https");
check(sql("select array_to_string(facts, '|') from universities where id = 'u_mioc_wb'") === "Type: Public research university|QS World Ranking ; 1438|34 in Webometrics Mioc National Ranking", "the other lines are kept as facts, in the app's order");
check(sql("select row(qs_rank, the_rank, is_public)::text from universities where id = 'u_mioc_wb'") === "(,,f)", "a ranking or 'public' line sets no ranking and no public flag");
check(n("select count(*) from catalogue_changes where entity = 'university' and entity_id = 'u_mioc_wb' and source = 'mioc' and field in ('about', 'website', 'facts')") === 3, "each profile field filled is in the change history");
check(sql("select array_to_string(facts, '|') from universities where name = 'Lakeshore Mioc College'") === "Web Url : localhost|Established: 1901", "an address that does not read as one stays a fact");
check(sql("select row(capital, languages, climate, accommodation)::text from countries where code = 'GB'") === '("Mioc Capital Town","English, Mioc Welsh","1°C to 23°C","Invented halls and made-up shared flats.")', "the UK's guide is filled in from the app");
check(sql("select string_agg(f->>'question', '|' order by o) from countries, jsonb_array_elements(faqs) with ordinality as x(f, o) where code = 'GB'") === "What does a Mioc year cost?|How long is a Mioc master's?", "its questions keep the app's order, and one with no answer is left out");
check(sql("select guide from countries where code = 'VN'") === "A made-up line about Vietnam.", "Vietnam, added by this run, gets its guide too");

await page.goto(`${BASE}/universities/u_mioc_wb`);
const about = page.locator("[data-university-about]");
const aboutText = (await about.innerText().catch(() => "")).trim();
check(aboutText.includes("Westbridge Mioc University is invented for the suites.") && aboutText.includes("Its second paragraph is made up too."), "the university page has an About section");
check(aboutText.includes("Type: Public research university") && aboutText.includes("QS World Ranking ; 1438"), "with the facts as written");
check((await about.locator('a[href="https://www.westbridge-mioc.example"]').count()) === 1, "and a link to the website");
check((await page.locator("[data-destination-snapshot]").innerText().catch(() => "")).includes("Mioc Capital Town"), "the university page shows its country's guide in short");
await page.goto(`${BASE}/destinations/GB`);
const guideText = await page.locator("[data-destination-guide]").innerText().catch(() => "");
check(guideText.includes("An invented overview of studying in the UK") && guideText.includes("Invented halls and made-up shared flats."), "the UK's guide page has the overview and accommodation");
check(guideText.indexOf("What does a Mioc year cost?") !== -1 && guideText.indexOf("What does a Mioc year cost?") < guideText.indexOf("How long is a Mioc master's?"), "and the questions in the app's order");
await page.goto(`${BASE}/universities?country=GB`);
check((await page.locator("[data-destination-strip]").innerText().catch(() => "")).includes("Mioc Capital Town"), "the universities list filtered to the UK opens with its guide in a line");

/* ---------------- The desk finds the app's courses to review them ---------------- */
await page.goto(`${BASE}/admin/programs?source=MIOC&status=DRAFT`);
await hydrated(page);
check((await page.locator("main").innerText()).includes("All 5 matching"), "the programs list filters to the app's courses, ready to publish as one batch");

/* ---------------- A second run, from the gzip export, after somebody corrects a row ---------------- */
sql("update programs set tuition_per_year = 33000, min_ielts = null where external_code = 'MIOC:105'");
sql("update universities set about = 'Edited by the desk. <b>Kept as typed</b>' where id = 'u_mioc_wb'");
sql("update universities set about = null where name = 'Lakeshore Mioc College'");
sql("update countries set capital = 'Edited Mioc Capital' where code = 'GB'");
sql("update countries set guide = null where code = 'VN'");
await open();
await checkFile({ name: "mioc.sql.gz", mimeType: "application/gzip", buffer: GZ });
check((await page.locator('[data-mioc-check] [data-mioc-count="universities-new"]').innerText()).trim() === "0", "the gzip export reads the same, and every university is now here");
const again = await load();
check(again.includes("0 new programs added"), `a second run adds nothing (${again.slice(0, 160)})`);
check(miocRows() === 5, "still five MIOC rows");
check(sql("select row(tuition_per_year, min_ielts)::text from programs where external_code = 'MIOC:105'") === "(33000,)", "a corrected fee stays corrected, and a score cleared as wrong stays cleared");
check(again.includes("6 already here and left as they are"), "the second run says what it left alone: its own five, and the register course it already filled");
check(n("select count(*) from countries where code = 'VN'") === 1 && n("select count(*) from universities where name = 'Lakeshore Mioc College'") === 1, "nothing is made twice");
check(sql("select about from universities where id = 'u_mioc_wb'") === "Edited by the desk. <b>Kept as typed</b>", "an edited about text is not overwritten by the second run");
check(sql("select coalesce(about, 'none') from universities where name = 'Lakeshore Mioc College'") === "none", "an about text cleared as wrong is not filled again");
check(sql("select capital from countries where code = 'GB'") === "Edited Mioc Capital" && sql("select coalesce(guide, 'none') from countries where code = 'VN'") === "none", "an edited or cleared guide field stays as it was left");
check(again.includes("about text for 0 universities") && again.includes("Destination guides filled in for 0 countries"), "the second run fills no profile and no guide");
await page.goto(`${BASE}/universities/u_mioc_wb`);
check((await page.locator("[data-university-about]").innerText().catch(() => "")).includes("Edited by the desk. <b>Kept as typed</b>"), "the about text shows as typed, never as HTML");

/* ---------------- Editing a guide ---------------- */
await page.goto(`${BASE}/admin/destinations`);
await hydrated(page);
const gbGuide = page.locator("#guide-GB");
await gbGuide.locator("summary", { hasText: "Edit guide" }).click();
check((await gbGuide.locator('input[name="faqQuestion"]').first().inputValue()) === "What does a Mioc year cost?", "the guide form opens with the questions in order");
await gbGuide.locator('input[name="climate"]').fill("Edited climate");
await gbGuide.getByRole("button", { name: "Save guide" }).click();
check((await until("select climate from countries where code = 'GB'", "Edited climate")) === "Edited climate", "an admin edits a guide on the destinations page");
check(n("select jsonb_array_length(faqs) from countries where code = 'GB'") === 2, "saving leaves the questions as they were");

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
  await p.goto(`${BASE}/destinations/GB`);
  await p.waitForLoadState("domcontentloaded");
  const seen = await p.locator("main").innerText().catch(() => "");
  check(seen.includes("Edited Mioc Capital") && seen.includes("Edited climate"), "a counsellor reads the destination guide");
  check((await p.getByRole("link", { name: "Edit guide" }).count()) === 0, "but is not offered to edit it");
  await c.close();
}

await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
