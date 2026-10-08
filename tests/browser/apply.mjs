// The counsellor's and the desk's own day: find a course, start an application,
// put up what Medcity issues, and keep hold of the student while filtering.
//
// Written after the documentation team could not get past "Create application":
// the action let in branch roles and admins only, so the button they were shown
// sent them to the forbidden screen.
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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 60;
const sessions = new Map();
const signIn = async (email) => {
  const had = sessions.get(email);
  if (had) return had;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.252.1.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  sessions.set(email, page);
  return page;
};

// A student the desk may open, and a course nobody has applied to for them.
const student = sql("select coalesce((select a.student_id from applications a where a.handed_over_at is not null limit 1), (select id from students where not archived limit 1))");
const name = sql(`select first_name from students where id = '${student}'`);

for (const [email, label] of [["documentation@medcityoverseas.test", "documentation"], ["uk.docs@medcity.test", "counsellor"]]) {
  const who = label === "counsellor" ? sql(`select coalesce((select id from students where assigned_to_id = (select id from users where email = 'uk.docs@medcity.test') limit 1), '${student}')`) : student;
  const page = await signIn(email);
  await page.goto(`${BASE}/students/${who}/applications?tab=apply`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
  check(!page.url().includes("/forbidden"), `${label}: the apply tab opens`);

  const box = page.locator('input[role="combobox"]').first();
  const already = await page.locator('input[name="programId"]').inputValue().catch(() => "");
  if (!already) {
    check(await box.count() > 0, `${label}: the course picker is a search box, not a list of fifty`);
    await box.click();
    await box.fill("a");
    await page.locator('[role="option"]').first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    const hits = await page.locator('[role="option"]').count();
    check(hits > 0, `${label}: typing searches the catalogue (${hits} shown)`);
    await page.locator('[role="option"]').first().click();
  }
  const programId = await page.locator('input[name="programId"]').inputValue();
  check(!!programId, `${label}: picking one fills the form`);

  // Any future intake the picked course offers.
  await page.waitForFunction(() => (document.querySelector('select[name="intake"]')?.options.length ?? 0) > 1, null, { timeout: 10000 }).catch(() => {});
  const intakes = (await page.locator('select[name="intake"] option').evaluateAll((els) => els.map((e) => e.value))).filter(Boolean);
  check(intakes.length > 0, `${label}: the intakes come from the course (${intakes[0]})`);

  // Walks the intakes until one takes. The same course and intake twice is
  // refused on purpose, and on a database this suite has run against before,
  // the first one is often already taken.
  let before = 0;
  let after = 0;
  let said = [];
  for (const intake of intakes.slice(0, 5)) {
    await page.locator('select[name="intake"]').selectOption(intake);
    const reason = page.locator('input[name="gateReason"]');
    if (await reason.count()) await reason.fill("Documents are following this week; the institution has agreed to wait.");
    before = Number(sql(`select count(*) from applications where student_id = '${who}'`));
    await page.getByRole("button", { name: "Create application" }).click();
    await page.waitForTimeout(2500);
    if (page.url().includes("/forbidden")) break;
    after = Number(sql(`select count(*) from applications where student_id = '${who}'`));
    said = await page.locator('[role="alert"], [role="status"]').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter(Boolean)).catch(() => []);
    if (after > before) break;
    if (!said.some((t) => /already an open application/i.test(t))) break;
  }
  check(!page.url().includes("/forbidden"), `${label}: Create application is not the forbidden screen`);
  check(after === before + 1, `${label}: the application is on the student's file (${before} to ${after})${after === before && said.length ? ` - said: ${said[0].slice(0, 90)}` : ""}`);
}

// The desk puts up what Medcity Overseas issues.
{
  const page = await signIn("documentation@medcityoverseas.test");
  await page.goto(`${BASE}/students/${student}/documents?tab=team`, { waitUntil: "domcontentloaded" });
  const text = await page.locator("body").innerText();
  check(/Offer letter/i.test(text), "documentation: the offer letter has a place on the team tab");
  const uploads = await page.locator('input[type="file"]').count();
  check(uploads > 0, `documentation: and somewhere to put it (${uploads} upload controls)`);
}

// Arriving from a student's own file, the student survives a filter.
{
  const page = await signIn("uk.docs@medcity.test");
  const mine = sql("select coalesce((select id from students where assigned_to_id = (select id from users where email = 'uk.docs@medcity.test') limit 1), '')") || student;
  await page.goto(`${BASE}/search?student=${mine}`, { waitUntil: "domcontentloaded" });
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
  const held = await page.locator('input[name="student"]').inputValue().catch(() => "");
  check(held === mine, "search: the student arrives in the picker");
  await page.locator('select[aria-label="Country"]').selectOption({ index: 1 }).catch(() => {});
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1200);
  check(new URL(page.url()).searchParams.get("student") === mine, "search: and is still there after a filter, rather than being quietly dropped");
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
