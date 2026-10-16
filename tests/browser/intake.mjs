// Registering a student, and the things the branch could not do.
//
// Every check here is something the counselling team reported: a destination
// missing from the list so the student could not be recorded at all, an email
// refused as taken with no way to find who has it, a test with no result yet
// that had to be entered as a nought, a master's transcript with nowhere to
// go, and a course the catalogue did not have and nobody could add.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 80;
const sessions = new Map();
const signIn = async (email) => {
  if (sessions.has(email)) return sessions.get(email);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": `10.248.1.${ip++}` } });
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
const settle = (p) => p.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});

// --- A student bound for a destination that was not on the list.
const counsellor = await signIn("uk.docs@medcity.test");
await counsellor.goto(`${BASE}/students/new`, { waitUntil: "domcontentloaded" });
await settle(counsellor);
const places = await counsellor.locator('select[name="preferredCountry"] option').evaluateAll((e) => e.map((o) => o.textContent.trim()));
check(places.includes("Austria"), "Austria is a destination you can record");
check(places.includes("Malaysia"), "and so is Malaysia");
check(places.length > 30, `the destination list is no longer sixteen long (${places.length})`);

// --- Registering somebody whose email is already on an archived file.
// Must be in the counsellor's own branch: the duplicate check is per branch,
// and so is the list they cannot find the student in.
const branch = sql("select org_id from users where email = 'uk.docs@medcity.test'");
const archived = sql(`select id from students where org_id = '${branch}' order by created_at desc limit 1`);
sql(`update students set archived = true, email = 'taken.archived@example.test' where id = '${archived}'`);
const who = sql(`select first_name || ' ' || last_name from students where id = '${archived}'`);
await counsellor.goto(`${BASE}/students/new`, { waitUntil: "domcontentloaded" });
await settle(counsellor);
await counsellor.fill('input[name="firstName"]', "Nisha");
await counsellor.fill('input[name="lastName"]', "Varghese");
await counsellor.fill('input[name="email"]', "taken.archived@example.test");
await counsellor.fill('input[name="phone"]', `98765${String(Date.now()).slice(-5)}`);
await counsellor.locator('input[name="consent"]').click();
await counsellor.getByRole("button", { name: "Create student" }).first().click();
await counsellor.waitForTimeout(2000);
const said = await counsellor.locator('[role="alert"]').first().innerText().catch(() => "");
check(said.includes(who.split(" ")[0]), `the refusal names who holds the email (${said.slice(0, 80)})`);
check(/archived/i.test(said), "and says the file is archived, which is why it is not in the list");

// --- A test the student has not sat.
const mine = sql("select coalesce((select id from students where assigned_to_id = (select id from users where email = 'uk.docs@medcity.test') and not archived limit 1), (select id from students where not archived limit 1))");
sql(`update students set profile_locked = false where id = '${mine}'`);
await counsellor.goto(`${BASE}/students/${mine}/profile`, { waitUntil: "domcontentloaded" });
await settle(counsellor);
const testForm = counsellor.locator("form").filter({ has: counsellor.getByRole("button", { name: /Add test score|Record it as pending/ }) }).first();
check(await testForm.locator('input[name="writing"]').count() > 0, "IELTS asks for the four sections, not just an overall");
await testForm.locator('input[name="listening"]').fill("7.0");
await testForm.locator('input[name="writing"]').fill("6.0");
await testForm.locator('input[name="overall"]').fill("6.5");
await testForm.getByRole("button", { name: "Add test score" }).click();
await counsellor.waitForTimeout(2000);
check(sql(`select coalesce(writing, '') from test_scores where student_id = '${mine}' order by id desc limit 1`) === "6.0", "and keeps the writing score, which is the one universities fail people on");

await counsellor.goto(`${BASE}/students/${mine}/profile`, { waitUntil: "domcontentloaded" });
await settle(counsellor);
const form2 = counsellor.locator("form").filter({ has: counsellor.getByRole("button", { name: /Add test score|Record it as pending/ }) }).first();
await form2.locator('select[name="state"]').selectOption("NOT_TAKEN");
await form2.getByRole("button", { name: "Record it as pending" }).click();
await counsellor.waitForTimeout(2000);
const pending = sql(`select state || '|' || coalesce(overall, 'none') from test_scores where student_id = '${mine}' order by id desc limit 1`);
check(pending === "NOT_TAKEN|none", `a test not taken yet is recorded without a score, so nobody types a nought (${pending})`);

// --- A master's transcript, and a document that needs naming.
await counsellor.goto(`${BASE}/students/${mine}/documents`, { waitUntil: "domcontentloaded" });
await settle(counsellor);
const types = await counsellor.locator('select[name="typeCode"] option').evaluateAll((e) => e.map((o) => o.textContent.trim()));
check(types.some((t) => /Master's individual marksheets/.test(t)), "a master's marksheet has a place of its own");
check(types.some((t) => /Diploma certificate/.test(t)), "and so does a diploma certificate");
check(types.some((t) => /say what it is/.test(t)), "and Something else asks what it is");

// --- The desk can add a course the catalogue has not got.
const desk = await signIn("documentation@medcityoverseas.test");
await desk.goto(`${BASE}/admin/programs/new`, { waitUntil: "domcontentloaded" });
await settle(desk);
check(!desk.url().includes("/forbidden"), "the desk can open Add a course");
await desk.locator('select[name="countryCode"]').selectOption("GB");
await desk.getByRole("button", { name: /not in the list, add it/i }).click();
await desk.fill('input[name="newUniversity"]', "Teesside University");
await desk.fill('input[name="city"]', "Middlesbrough");
await desk.fill('input[name="name"]', "MSc Aviation Management");
await desk.locator('select[name="level"]').selectOption("PG");
await desk.fill('input[name="studyArea"]', "Aviation");
await desk.getByRole("button", { name: "Add the course" }).click();
await desk.waitForTimeout(3000);
const made = sql("select count(*) from programs p join universities u on u.id = p.university_id where u.name = 'Teesside University' and p.name = 'MSc Aviation Management'");
check(made === "1", `the course and its university are in the catalogue (${made})`);
check(sql("select status from programs where name = 'MSc Aviation Management'") === "DRAFT", "as a draft, so nothing reaches a counsellor's search unchecked");

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
