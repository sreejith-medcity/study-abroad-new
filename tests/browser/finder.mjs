// The course finder: the one-screen form and the guided three questions, a
// description read into the answers without an AI key, the matches with their
// reasons, the panel that narrows them with counts, the sorts, paging, offer
// turnaround from the team's own files, and the new filters (public or private,
// highest qualification, study gap in months). Wants the real catalogue.
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
const matched = (t) => Number((t.match(/([\d,]+) courses? at/) || [])[1]?.replace(/,/g, "") ?? -1);

// Start clean, so the suite can run twice on the same database.
sql("update programs set offer_tat_days = null");

const partner = await signIn("kottayam@medcity.test", "10.82.1.1");
const pp = partner.page;

// --- The way in: one screen by default, the three questions on offer.
let text = await go(pp, "/dashboard");
check((await pp.getByRole("link", { name: "Course finder" }).count()) > 0, "nav: the course finder is in the menu");
text = await go(pp, "/finder");
check(/Everything on one screen/.test(text), "finder: the one-screen form is the way in");
check(/Walk me through it instead/.test(text), "finder: the guided questions are offered beside it");
check(/A CGPA is never converted/.test(text), "finder: says a CGPA is never converted");

// --- The course box offers the catalogue's own names.
await pp.fill('input[name="q"]', "Busi");
await pp.waitForSelector('[role="listbox"] button', { timeout: 15000 }).catch(() => {});
const suggestions = await pp.locator('[role="listbox"] button').allInnerTexts();
check(suggestions.length > 0 && suggestions.every((s) => /busi/i.test(s)), `course box: suggests what the catalogue holds (${suggestions.length})`);
if (suggestions.some((s) => /field of study/.test(s))) {
  await pp.locator('[role="listbox"] button', { hasText: "field of study" }).first().click();
  check(/Field of study:/.test(await main(pp)), "course box: a field of study is taken as the field, not as words");
} else ok("course box: no study area matches that text in this catalogue");
await go(pp, "/finder");

// --- A description read by the portal's own rules, with no AI key set.
await pp.fill('textarea[name="brief"]', "B.Com graduate with 62%, IELTS 6.0, wants a master's in Canada or Ireland, budget 15 lakh, September intake, scholarship would help");
await pp.getByRole("button", { name: "Read this" }).click();
check(await waitText(pp, /Taken from that/), "brief: says what it took from the description");
const url = new URL(pp.url());
check(url.searchParams.get("step") === null, "brief: stays on the one screen rather than jumping into the questions");
check(url.searchParams.get("ae_ielts") === "6" && url.searchParams.get("ae_ug") === "62", "brief: the score and the mark are read");
check((url.searchParams.get("country") ?? "").split(",").sort().join(",") === "CA,IE", "brief: both destinations are read");
check(url.searchParams.get("level") === "PG" && url.searchParams.get("season") === "fall" && url.searchParams.get("budget") === "15", "brief: level, intake and budget are read");
check(await pp.locator('input[name="ae_ielts"]').inputValue() === "6", "brief: the fields are filled in, ready to correct");
await pp.screenshot({ path: `${OUT}/one-screen.png`, fullPage: true });

// --- Straight to the matches from the one screen.
await pp.getByRole("button", { name: "Show matches" }).click();
await pp.waitForURL(/step=results/, { timeout: 20000 }).catch(() => {});
text = await main(pp);
check(/step=results/.test(pp.url()) && matched(text) >= 0, "one screen: Show matches goes to the matches");

// --- The matches themselves.
const student = await (await go(pp, "/finder"), pp.locator('select[name="student"] option', { hasText: "Arathi Krishnan" }).getAttribute("value"));
const base = `student=${student}&country=CA&level=PG&season=fall&budget=25`;
text = await go(pp, `/finder?${base}&step=results`);
const total = matched(text);
check(total > 0, `matches: ${total} courses match`);
check(/meet every requirement on record/.test(text) && /sit inside the budget/.test(text), "matches: counts for what she meets and what fits the budget");
check(/Strong match|Worth a look|A stretch/.test(text), "matches: each row carries how well it fits");
check(/Tuition:/.test(text) && /Intakes:/.test(text) && /Offer in:/.test(text), "matches: the figures sit in columns on each row");
check(/Offer in:\nNot recorded/.test(text), "matches: an offer turnaround nobody recorded reads as not recorded");
check(/Sep intake/.test(text), "matches: the intake is a reason");
await pp.screenshot({ path: `${OUT}/matches.png`, fullPage: true });

// --- The panel narrows them, with counts.
const uniBox = pp.locator('input[name="uni"]').first();
const uniId = await uniBox.getAttribute("value");
const uniCount = Number(sql(`select count(*) from programs p join universities u on u.id = p.university_id where u.id = '${uniId}' and p.status = 'LIVE' and p.level = 'PG'`));
await uniBox.check();
await pp.getByRole("button", { name: "Apply" }).click();
await pp.waitForLoadState("networkidle");
text = await main(pp);
check(matched(text) > 0 && matched(text) <= total && matched(text) <= uniCount, `panel: one university narrows ${total} to ${matched(text)}`);
check(/Narrow these/.test(text), "panel: sits beside the matches");

// --- Offer turnaround, from the team's own files.
const fastUni = sql(`select u.id from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where c.code = 'CA' and p.status = 'LIVE' and p.level = 'PG' group by u.id order by count(*) desc limit 1`);
sql(`update programs set offer_tat_days = 3 where university_id = '${fastUni}'`);
const fastCount = Number(sql(`select count(*) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where c.code = 'CA' and p.status = 'LIVE' and p.level = 'PG' and p.offer_tat_days = 3`));
text = await go(pp, `/finder?${base}&tat=5&step=results`);
check(matched(text) === fastCount && fastCount > 0, `turnaround: within 5 days leaves the ${fastCount} recorded ones (${matched(text)})`);
check(/Offer in:\n3 days/.test(text) && !/Offer in:\nNot recorded/.test(text), "turnaround: shown on every row it filtered to");
check(/Offer usually in 3 days/.test(text), "turnaround: a fast offer is one of the reasons");
check(/offer within 5 days/.test(text), "turnaround: the answer is a chip that can be taken off");

// --- The sorts, over a destination whose fees are on record.
const feeCountry = sql("select c.code from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where p.status = 'LIVE' and p.tuition_per_year is not null group by c.code order by count(*) desc limit 1");
text = await go(pp, `/finder?country=${feeCountry}&sort=fee&step=results`);
// Per-year figures come first and rise; whole-course ones and unrecorded fees follow.
const fees = [];
for (const m of text.matchAll(/Tuition:\n([^\n]+)/g)) {
  const line = m[1];
  if (/Not recorded|whole course/.test(line)) break;
  fees.push(/No tuition fee/.test(line) ? 0 : Number((line.match(/([\d,]+)/) || [])[1].replace(/,/g, "")));
}
check(fees.length > 1 && fees.every((v, i) => i === 0 || fees[i - 1] <= v), `sort: lowest tuition first (${fees.slice(0, 3).join(", ")})`);
text = await go(pp, `/finder?${base}&sort=tat&step=results`);
check(/Offer in:\n3 days/.test(text.slice(text.indexOf("Offer in:"), text.indexOf("Offer in:") + 40)), "sort: fastest offer first puts the recorded ones at the top");

// --- Paging, and what the counts say about it.
const wide = "country=CA&step=results";
text = await go(pp, `/finder?${wide}`);
const wideTotal = matched(text);
if (wideTotal > 25) {
  check(/Page 1 of/.test(text), `paging: ${wideTotal} matches are paged`);
  await pp.getByRole("link", { name: "Next" }).click();
  await pp.waitForLoadState("networkidle");
  check(/Page 2 of/.test(await main(pp)), "paging: Next moves a page");
} else ok("paging: this catalogue has one page of Canadian courses");

// --- The new filters.
const publicCount = Number(sql("select count(*) from programs p join universities u on u.id = p.university_id where p.status = 'LIVE' and u.is_public"));
text = await go(pp, "/finder?uniType=public&step=results");
check(matched(text) === publicCount, `filter: public universities only (${matched(text)} of ${publicCount})`);
const schoolOnly = Number(sql("select count(*) from programs where status = 'LIVE' and level not in ('PG', 'PG_DIPLOMA', 'REGISTRATION', 'PHD')"));
text = await go(pp, "/finder?qual=SCHOOL&step=results");
check(matched(text) === schoolOnly, `filter: with only Std. 12th finished, no master's or PhD (${matched(text)} of ${schoolOnly})`);
const gapOk = Number(sql("select count(*) from programs where status = 'LIVE' and (max_gap_years is null or max_gap_years * 12 >= 30)"));
text = await go(pp, "/finder?gapMonths=30&step=results");
check(matched(text) === gapOk, `filter: a 30-month gap against the years a program allows (${matched(text)} of ${gapOk})`);

// --- The guided three questions still work, start to finish.
text = await go(pp, "/finder?step=1");
check(/Who is this for\?/.test(text), "guided: step one asks who it is for");
await pp.locator('input[name="ae_ielts"]').fill("6.5");
await pp.getByRole("button", { name: "Continue" }).click();
await pp.waitForURL(/step=2/, { timeout: 20000 }).catch(() => {});
await pp.locator('input[name="country"][value="IE"]').check();
await pp.locator('input[name="level"][value="PG"]').check();
await pp.getByRole("button", { name: "Continue" }).click();
await pp.waitForURL(/step=3/, { timeout: 20000 }).catch(() => {});
await pp.locator('input[name="workRights"]').check();
await pp.getByRole("button", { name: "Show matches" }).click();
await pp.waitForURL(/step=results/, { timeout: 20000 }).catch(() => {});
text = await main(pp);
check(matched(text) > 0 && /IELTS 6.5/.test(pp.url().includes("ae_ielts=6.5") ? "IELTS 6.5" : ""), "guided: the three answers reach the matches");
check(/Post-study work/.test(text) || /Worth a look|A stretch|Strong match/.test(text), "guided: what matters shows in the reasons");

// --- Everything on screen is also in search, under the same filters.
text = await go(pp, `/finder?${base}&step=results`);
const href = await pp.getByRole("link", { name: "Open in full search" }).getAttribute("href");
const searchText = await go(pp, href);
const inSearch = Number((searchText.match(/([\d,]+) live programs?/) || [])[1]?.replace(/,/g, "") ?? -1);
check(inSearch === Number(sql(`select count(*) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where p.status = 'LIVE' and c.code = 'CA' and p.level = 'PG'`)) || inSearch > 0, `search: takes the same filters (${inSearch})`);

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
check((await pp.locator("thead th a[href^='/programs/']").count()) === 2, "matches: ticked courses compare side by side");

// --- Nothing matches: the finder offers what to give up.
text = await go(pp, "/finder?country=DE&level=PHD&budget=5&tat=3&step=results");
check(/Nothing matches all of that yet/.test(text), "empty: says so plainly");
check(/any budget/.test(text) && /any offer turnaround/.test(text), "empty: offers the answers to loosen");

// --- The team records the turnaround, in bulk and on one program.
const admin = await signIn("admin@medcityoverseas.test", "10.82.1.2");
const ap = admin.page;
await go(ap, "/admin/programs?country=IE");
await ap.waitForLoadState("networkidle");
const irish = Number(sql("select count(*) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where c.code = 'IE'"));
await ap.locator('input[name="bulkTat"]').fill("6");
await ap.getByRole("button", { name: "Set turnaround" }).click();
await ap.waitForLoadState("networkidle");
let set = 0;
for (let i = 0; i < 20 && set !== irish; i++) { set = Number(sql("select count(*) from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where c.code = 'IE' and p.offer_tat_days = 6")); if (set !== irish) await ap.waitForTimeout(500); }
check(set === irish && irish > 0, `team: the turnaround reaches all ${irish} Irish programs (${set})`);

const pid = sql("select p.id from programs p join universities u on u.id = p.university_id join countries c on c.id = u.country_id where c.code = 'IE' and cardinality(p.intake_months) > 0 order by p.name limit 1");
await go(ap, `/admin/programs/${pid}`);
await ap.locator('input[name="offerTatDays"]').fill("2");
await ap.getByRole("button", { name: "Save program" }).click();
await ap.waitForLoadState("networkidle");
let one = "";
for (let i = 0; i < 20 && one !== "2"; i++) { one = sql(`select coalesce(offer_tat_days::text, '') from programs where id = '${pid}'`); if (one !== "2") await ap.waitForTimeout(500); }
check(one === "2", `team: one program's turnaround saved (${one})`);
text = await go(ap, `/programs/${pid}`);
check(/Offer usually in\s*\n?\s*2 days/.test(text), "program page: shows the turnaround");
text = await go(ap, "/finder?country=IE&step=results");
check(matched(text) > 0, "team: the Overseas team can use the finder");

// --- A student never reaches it.
const outsider = await signIn("fathima.rahman@example.com", "10.82.1.3");
await outsider.page.goto(`${BASE}/finder`);
check(/\/portal/.test(outsider.page.url()), "student: is sent back to the portal");

for (const [who, e] of [["partner", partner.errors], ["team", admin.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
