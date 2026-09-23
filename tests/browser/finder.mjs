// The course finder: the three steps, reading a counsellor's description into
// the answers without an AI key, the ranked matches with their reasons and
// cautions, the budget headroom, shortlisting and comparing from the matches,
// handing the same filters to search, and loosening an answer that finds
// nothing. Wants the real catalogue loaded and published.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-finder";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (cond, m) => (cond ? ok(m) : bad(m));

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync"],
});
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, path) { await page.goto(BASE + path); return main(page); }
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (re.test(await page.locator("main").innerText())) return true; await page.waitForTimeout(300); }
  return false;
}
const matched = (t) => Number((t.match(/([\d,]+) programs? match/) || [])[1]?.replace(/,/g, "") ?? -1);

const partner = await signIn("kottayam@medcity.test", "10.82.1.1");
const pp = partner.page;

// --- The nav takes a counsellor there, and the first step asks about the student.
let text = await go(pp, "/dashboard");
check((await pp.getByRole("link", { name: "Course finder" }).count()) > 0, "nav: the course finder is in the menu");
text = await go(pp, "/finder");
check(/Who is this for\?/.test(text), "step 1: asks who it is for");
check(/A CGPA is never converted/.test(text), "step 1: says a CGPA is never converted");

// --- The description is read by the portal's own rules, with no AI key set.
await pp.fill('textarea[name="brief"]', "B.Com graduate with 62%, IELTS 6.0, wants a master's in Canada or Ireland, budget 15 lakh, September intake, scholarship would help");
await pp.getByRole("button", { name: "Read this" }).click();
check(await waitText(pp, /Taken from that/), "brief: says what it took from the description");
text = await main(pp);
check(await pp.locator('input[name="ae_ielts"]').inputValue() === "6", "brief: the fields below are filled in, ready to correct");
const url = new URL(pp.url());
check(url.searchParams.get("ae_ielts") === "6" && url.searchParams.get("ae_ug") === "62", "brief: the score and the mark are read");
check((url.searchParams.get("country") ?? "").split(",").sort().join(",") === "CA,IE", "brief: both destinations are read");
check(url.searchParams.get("level") === "PG" && url.searchParams.get("season") === "fall" && url.searchParams.get("budget") === "15", "brief: level, intake and budget are read");
check(url.searchParams.get("scholarship") === "1", "brief: what the family asks for is read");
check(/Taken from that: IELTS 6 · .*bachelor's 62%.*scholarship available/.test(text), "brief: the reading is shown in plain words");
await pp.screenshot({ path: `${OUT}/step1-read.png`, fullPage: true });

// --- The second step shows the answers already ticked.
await pp.getByRole("button", { name: "Continue" }).click();
await pp.waitForURL(/step=2/, { timeout: 20000 }).catch(() => {});
await main(pp);
check(/step=2/.test(pp.url()), "step 1: Continue moves on with the answers");
check(await pp.locator('input[name="country"][value="CA"]').isChecked(), "step 2: Canada is ticked");
check(await pp.locator('input[name="level"][value="PG"]').isChecked(), "step 2: master's is ticked");
check(await pp.locator('select[name="budget"]').inputValue() === "15", "step 2: the budget carried over");

// --- A CGPA is never turned into a percentage.
await go(pp, "/finder");
await pp.fill('textarea[name="brief"]', "degree with 7.4 CGPA, looking at Germany");
await pp.getByRole("button", { name: "Read this" }).click();
check(await waitText(pp, /A CGPA cannot be turned into a percentage/), "brief: says why the CGPA was left alone");
check(new URL(pp.url()).searchParams.get("ae_ug") === null, "brief: a CGPA is not turned into a percentage");

// --- Matches, with their reasons.
const student = await (await go(pp, "/finder"), pp.locator('select[name="student"] option', { hasText: "Arathi Krishnan" }).getAttribute("value"));
check(!!student, "step 1: the student's file is offered");
const base = `student=${student}&country=CA&level=PG&season=fall&budget=25`;
text = await go(pp, `/finder?${base}&step=results`);
const total = matched(text);
check(total > 0, `matches: ${total} programs match`);
check(/meet every requirement on record/.test(text) && /sit inside the budget/.test(text), "matches: counts for what she meets and what fits the budget");
check(/Strong match|Worth a look|A stretch/.test(text), "matches: grouped by how well they fit");
check(/Sep intake/.test(text), "matches: the intake is a reason");
check(/inside the budget/.test(text) || /over the budget/.test(text), "matches: the budget is spoken to");
check(!/Tuition not recorded.*a year/.test(text), "matches: an unrecorded fee is never made into a figure");
await pp.screenshot({ path: `${OUT}/matches.png`, fullPage: true });

// The headroom: something a little over the budget is shown and marked, not hidden.
const over = sql(`select count(*) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id
  where p.status = 'LIVE' and c.code = 'CA' and p.level = 'PG' and p.tuition_per_year is not null and p.tuition_per_year * 62 > 2500000 and p.tuition_per_year * 62 <= 3125000`);
if (Number(over) > 0) {
  check(/over the budget/.test(text), `matches: ${over} a little over the budget are shown and marked`);
} else ok("matches: nothing sits in the budget headroom in this catalogue");

// --- Everything on screen is also in search, under the same filters.
const href = await pp.getByRole("link", { name: /^Open all/ }).getAttribute("href");
check(/country=CA/.test(href ?? "") && /budget=25/.test(href ?? "") && !/step=/.test(href ?? ""), "matches: hands the same filters to search");
const searchText = await go(pp, href);
const inSearch = Number((searchText.match(/([\d,]+) live programs?/) || [])[1]?.replace(/,/g, "") ?? -1);
check(inSearch === total, `search: finds the same ${total} programs (${inSearch})`);

// --- Shortlisting and comparing from the matches.
await go(pp, `/finder?${base}&step=results`);
await pp.waitForLoadState("networkidle");
const before = Number(sql(`select count(*) from shortlists where student_id = '${student}'`));
await pp.getByRole("button", { name: /^Shortlist for/ }).first().click();
check(await waitText(pp, /Shortlisted ✓/), "matches: a match goes onto the student's shortlist");
let after = before;
for (let i = 0; i < 20 && after === before; i++) { after = Number(sql(`select count(*) from shortlists where student_id = '${student}'`)); if (after === before) await pp.waitForTimeout(500); }
check(after === before + 1, `matches: the shortlist is one longer (${before} to ${after})`);

await pp.locator('input[name="id"]').first().check();
await pp.locator('input[name="id"]').nth(1).check();
await pp.getByRole("button", { name: "Compare" }).click();
await pp.waitForURL(/\/compare/, { timeout: 20000 }).catch(() => {});
check((await pp.locator("thead th a[href^='/programs/']").count()) === 2, "matches: ticked programs compare side by side");

// --- Without a student, the finder still works and says how to shortlist.
text = await go(pp, "/finder?ae_ielts=6.5&country=IE&level=PG&step=results");
check(matched(text) > 0 && /Pick a student on step one to shortlist/.test(text), "matches: typed scores need no student file");
check(/Meets every requirement on record|On track|Entry requirements are not recorded/.test(text), "matches: says how the typed scores measure up");

// --- Nothing matches: the finder offers what to give up.
text = await go(pp, "/finder?country=DE&level=PHD&field=Nursing&budget=5&step=results");
check(/Nothing matches all of that yet/.test(text), "empty: says so plainly");
check(/any budget/.test(text) && /any field/.test(text), "empty: offers the answers to loosen");
const loosen = await pp.getByRole("link", { name: "any budget" }).getAttribute("href");
check(/step=results/.test(loosen ?? "") && !/budget=/.test(loosen ?? ""), "empty: loosening keeps the rest of the answers");

// --- The team sees it too, and a student never does.
const admin = await signIn("admin@medcityoverseas.test", "10.82.1.2");
text = await go(admin.page, "/finder?country=GB&level=PG&step=results");
check(matched(text) > 0, "team: the Overseas team can use the finder");
const outsider = await signIn("fathima.rahman@example.com", "10.82.1.3");
await outsider.page.goto(`${BASE}/finder`);
check(/\/portal/.test(outsider.page.url()), "student: is sent back to the portal");

for (const [who, e] of [["partner", partner.errors], ["team", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
