// Search upgrades: labels (bulk and per program), multi-level and season
// filters, chip counts, open or closed by deadline, eligibility from typed
// scores, the universities view, compare and download of ticked programs,
// the new program-page fields and the "Something's not right?" link.
// Wants the real catalogue loaded and published, and psql on PATH.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-search-upgrades";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p); return main(page); }
const count = (t) => Number((t.match(/([\d,]+) live programs?/) || [])[1]?.replace(/,/g, "") ?? -1);
const live = (where) => Number(sql(`select count(*) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where p.status = 'LIVE' and ${where}`));

// Start clean, so the test can run again on the same database.
sql("update programs set tags = '{}', program_url = null, typical_scholarship = null, min_ielts_band = null, entry_requirements = null, balance_deposit = null; delete from program_deadlines");
const waitCount = (page, n) => page.getByText(new RegExp(`^${n.toLocaleString("en-IN")} live programs?`)).first().waitFor({ timeout: 15000 }).catch(() => {});

// --- Admin: bulk label, then one program's details.
const admin = await signIn("admin@medcityoverseas.test", "10.95.1.1");
const ap = admin.page;
const gbTotal = live("c.code = 'GB'");
await go(ap, "/admin/programs?country=GB");
await ap.waitForLoadState("networkidle");
await ap.getByLabel("Label to apply").selectOption("STEM");
await ap.getByRole("button", { name: "Add label" }).click();
await ap.waitForLoadState("networkidle");
let stem = 0;
for (let i = 0; i < 20 && stem === 0; i++) { stem = live("'STEM' = any(p.tags)"); if (!stem) await ap.waitForTimeout(500); }
check(stem === gbTotal && gbTotal > 0, `admin: bulk label reaches all ${gbTotal} UK programs (${stem})`);
let text = await go(ap, "/admin/programs?tag=STEM");
check(new RegExp(`${gbTotal}`).test(text), "admin: label filter finds them");

const pid = sql("select p.id from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where c.code = 'GB' and p.min_ielts is not null order by p.name limit 1");
const pname = sql(`select name from programs where id = '${pid}'`);
await go(ap, `/admin/programs/${pid}`);
await ap.waitForLoadState("networkidle");
await ap.getByLabel("Typical scholarship").fill("Up to 20% of first-year tuition");
await ap.getByLabel("IELTS lowest band").fill("5.5");
await ap.getByLabel("Program page on the institution's site").fill("javascript:alert(1)");
await ap.getByRole("button", { name: "Save program" }).click();
await ap.getByText(/http|web address|link/i).first().waitFor({ timeout: 10000 }).catch(() => {});
check(sql(`select coalesce(program_url, '') from programs where id = '${pid}'`) === "", "admin: a non-web program link is refused");
await ap.getByLabel("Program page on the institution's site").fill("https://www.example.ac.uk/courses/test");
await ap.getByLabel("Entry requirements, in the institution's words").fill("A 2:2 honours degree or equivalent.");
await ap.getByLabel("Balance deposit").fill("3000");
await ap.locator("label").filter({ hasText: /^Faster offer$/ }).click();
await ap.getByRole("button", { name: "Save program" }).click();
await ap.locator('[role="status"]').filter({ hasText: /Saved/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
const saved = sql(`select typical_scholarship || '|' || min_ielts_band || '|' || program_url || '|' || balance_deposit || '|' || array_to_string(tags, ',') from programs where id = '${pid}'`);
check(/^Up to 20%.*\|5\.5\|https:\/\/www\.example\.ac\.uk\/courses\/test\|3000\|.*FAST_OFFER/.test(saved), `admin: details and labels save (${saved})`);

// --- Partner search.
const partner = await signIn("kottayam@medcity.test", "10.95.1.2");
const pp = partner.page;
const all = live("true");
text = await go(pp, "/search");
check(count(text) === all, `search: ${all} live programs`);
check(new RegExp(`STEM\\s*${gbTotal}`).test(text), "search: label chip shows its count");
check(/No GRE\s*[\d,]+/.test(text), "search: quick chips show counts");
await pp.getByRole("link", { name: new RegExp(`^STEM\\s*${gbTotal}$`) }).click();
await pp.waitForURL(/tags=STEM/, { timeout: 15000 }).catch(() => {});
await waitCount(pp, gbTotal);
text = await main(pp);
check(count(text) === gbTotal, `search: label chip filters to ${gbTotal} (${count(text)})`);

// Two levels at once, through the picker.
const ugpg = live("p.level in ('UG', 'PG')");
await go(pp, "/search");
await pp.getByTestId("level-picker").locator("summary").click();
await pp.getByTestId("level-picker").locator("label").filter({ hasText: /^\s*Bachelor's$/ }).click();
await pp.getByTestId("level-picker").locator("label").filter({ hasText: /^\s*Master's$/ }).click();
await pp.keyboard.press("Escape");
await pp.getByRole("button", { name: "Search", exact: true }).click();
await pp.waitForURL(/level=UG/, { timeout: 15000 }).catch(() => {});
await waitCount(pp, ugpg);
text = await main(pp);
check(count(text) === ugpg, `search: bachelor's and master's together (${count(text)} of ${ugpg})`);
check(/Bachelor's, Master's/.test(text), "search: the picker says what is ticked");

const spring = live("p.intake_months && array[1,2,3,4]");
text = await go(pp, "/search?season=spring");
check(count(text) === spring && spring > 0, `search: spring season (${count(text)} of ${spring})`);
const springFall = live("p.intake_months && array[1,2,3,4,9,10,11,12]");
text = await go(pp, "/search?season=spring,fall");
check(count(text) === springFall, "search: two seasons");

const noGre = live("p.min_gre is null and p.min_gmat is null");
text = await go(pp, "/search?noGre=1&noGmat=1");
check(count(text) === noGre, "search: without GRE and GMAT");

// Open or closed, from recorded deadlines.
const [openId, closedId] = sql("select id from programs where status = 'LIVE' order by name limit 2").split("\n");
sql(`delete from program_deadlines; insert into program_deadlines (id, program_id, intake_month, intake_year, deadline) values ('t-open', '${openId}', 9, 2027, current_date + 40), ('t-closed', '${closedId}', 1, 2026, current_date - 10)`);
text = await go(pp, "/search?apply=open");
check(count(text) === 1, "search: applications open");
text = await go(pp, "/search?apply=closed");
check(count(text) === 1, "search: closed for now");

// Eligibility from typed scores, no student file.
text = await go(pp, "/search?country=GB");
const gb = count(text);
await pp.getByText("Check eligibility from scores, without a student file").click();
await pp.getByLabel("IELTS overall").fill("5");
await pp.getByRole("button", { name: "Check these scores" }).click();
await pp.waitForURL(/ae_ielts=5/, { timeout: 15000 }).catch(() => {});
await pp.getByText(/Checking against IELTS 5/).first().waitFor({ timeout: 15000 }).catch(() => {});
text = await main(pp);
check(/Checking against IELTS 5/.test(text) && /Not yet/.test(text), "adhoc: typed scores check each row");
await pp.getByRole("link", { name: "Hide programs these scores cannot meet" }).click();
await pp.waitForURL(/fit=1/, { timeout: 15000 }).catch(() => {});
await pp.getByText("Show every program again").first().waitFor({ timeout: 15000 }).catch(() => {});
text = await main(pp);
check(count(text) < gb && count(text) >= 0 && !/Not yet/.test(text), `adhoc: hiding what IELTS 5 cannot meet (${count(text)} of ${gb})`);

// Universities view.
text = await go(pp, "/search?country=GB&view=universities");
const unis = Number(sql("select count(distinct u.id) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where p.status = 'LIVE' and c.code = 'GB'"));
check(new RegExp(`Universities \\(${unis}\\)`).test(text), `universities view: ${unis} universities`);
const firstUni = pp.locator("tbody tr").first().getByRole("link", { name: /programs?$/ });
const n = Number((await firstUni.innerText()).match(/\d+/)[0]);
await firstUni.click();
await pp.waitForURL(/uni=/, { timeout: 15000 }).catch(() => {});
await waitCount(pp, n);
text = await main(pp);
check(count(text) === n && /Showing one university/.test(text), `universities view: its programs (${n})`);

// Compare and download ticked programs.
await go(pp, "/search?country=GB&sort=name");
const names = [await pp.locator("tbody tr").nth(0).locator("td").nth(1).locator("a").first().innerText(), await pp.locator("tbody tr").nth(1).locator("td").nth(1).locator("a").first().innerText()];
await pp.locator("tbody tr").nth(0).locator('input[type="checkbox"]').check();
await pp.locator("tbody tr").nth(1).locator('input[type="checkbox"]').check();
await pp.getByRole("button", { name: "Compare", exact: true }).click();
await pp.waitForURL(/\/compare/, { timeout: 15000 }).catch(() => {});
text = await main(pp);
check(text.includes(names[0]) && text.includes(names[1]) && /2 programs/.test(text), "compare: both ticked programs side by side");
check(/Typical scholarship/i.test(text) && /Labels/i.test(text), "compare: shows the new rows");
await pp.screenshot({ path: `${OUT}/compare.png`, fullPage: true });
const ids = new URL(pp.url()).searchParams.getAll("id");
let csv = await (await pp.request.get(`${BASE}/api/programs/search-export?${ids.map((x) => `id=${x}`).join("&")}`)).text();
check(csv.trim().split("\r\n").length === 3 && !/commission/i.test(csv), "download: ticked programs, no commission column");
csv = await (await pp.request.get(`${BASE}/api/programs/search-export?country=GB&tags=STEM`)).text();
check(csv.trim().split("\r\n").length === Math.min(gbTotal, 500) + 1, "download: the top results of a search");

// Program page.
text = await go(pp, `/programs/${pid}`);
check(/Up to 20% of first-year tuition/.test(text) && /no band below 5\.5/.test(text) && /example\.ac\.uk/.test(text) && /A 2:2 honours degree/.test(text) && /Faster offer/.test(text), "program page: the new details show");
await pp.getByRole("link", { name: "Tell the Overseas team" }).click();
await pp.waitForURL(/\/support/, { timeout: 15000 }).catch(() => {});
await settle(pp);
const subject = await pp.getByLabel("Summary").inputValue();
check(subject.startsWith("Correction: ") && subject.includes(pname.slice(0, 20)), "program page: the report link opens a prefilled ticket");
check((await pp.getByLabel("What is it about").inputValue()) === "CATALOGUE", "program page: filed under the catalogue");

sql("delete from program_deadlines");
for (const [who, e] of [["admin", admin.errors], ["partner", partner.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
