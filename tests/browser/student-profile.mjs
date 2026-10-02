// Student profile additions: mailing address, second citizenship, background
// questions and their rules, important contacts, the ACT, the section and tab
// status, the pre-submission warning, and application priority on the file,
// the list, its filter, sort and export. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-student-profile";
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
const main = (page) => page.locator("main").innerText();
async function go(page, p) { await page.goto(BASE + p); return main(page); }
const toast = (page, re) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);

const sid = sql("select s.id from students s join organizations o on o.id = s.org_id where o.name ilike '%kottayam%' and s.first_name = 'Aswin'");
const appId = sql(`select id from applications where student_id = '${sid}'`);
// Start as a student would be before anyone answered the questions.
sql(`update students set background = '{}'::jsonb, mailing_same_as_permanent = true, mailing_address = null, other_citizenship = null where id = '${sid}'; delete from student_contacts where student_id = '${sid}'; update applications set priority = 'NORMAL'`);

const partner = await signIn("kottayam@medcity.test", "10.97.1.2");
const pp = partner.page;
let text = await go(pp, `/students/${sid}/profile`);
check(/Background\s*Incomplete/i.test(text) && /Contacts\s*Optional/i.test(text), "profile: new sections show their status");
await go(pp, `/students/${sid}/shortlist`);
check(await pp.locator('a[href$="/profile"] span').filter({ hasText: "✓" }).count() === 0, "tab: profile not ticked while background is unanswered");
await go(pp, `/students/${sid}/profile`);

// Background: every question needs an answer, a yes needs details.
const bg = pp.locator("#background");
await bg.getByRole("button", { name: "Save background answers" }).click();
check(await bg.getByText("Answer yes or no").first().waitFor({ timeout: 10000 }).then(() => true, () => false), "background: unanswered questions are refused");
const groups = bg.getByRole("radiogroup");
for (let i = 0; i < 4; i++) await groups.nth(i).getByLabel(i === 0 ? "Yes" : "No", { exact: true }).check();
await bg.getByRole("button", { name: "Save background answers" }).click();
check(await bg.getByText(/Give the details/).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "background: a yes without details is refused");
await bg.getByLabel("Details").fill("UK student visa refused in 2022, financial evidence");
await bg.getByRole("button", { name: "Save background answers" }).click();
check(await toast(pp, /Background answers saved/), "background: saved");
const saved = sql(`select background->'visaRefused'->>'answer', background->'visaRefused'->>'details', background->'medicalCondition'->>'answer' from students where id = '${sid}'`);
check(saved === "true|UK student visa refused in 2022, financial evidence|false", `background: stored as answered (${saved})`);

// Mailing address and second citizenship.
await go(pp, `/students/${sid}/profile`);
const personal = pp.locator("#personal");
await personal.getByLabel("Mailing address is the same as the permanent address").uncheck();
await personal.getByRole("button", { name: "Save personal details" }).click();
check(await personal.getByText(/Enter the mailing address/).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "mailing: a different address must be given");
await personal.getByLabel("Mailing address", { exact: true }).fill("Hostel B, Room 12, Bengaluru 560001");
await personal.getByLabel("Other citizenship").fill("Canada");
await personal.getByRole("button", { name: "Save personal details" }).click();
check(await toast(pp, /Saved/), "personal: saved");
check(sql(`select mailing_same_as_permanent || '|' || mailing_address || '|' || other_citizenship from students where id = '${sid}'`) === "false|Hostel B, Room 12, Bengaluru 560001|Canada", "personal: mailing address and citizenship stored");

// Contacts.
const contacts = pp.locator("#contacts");
await contacts.getByLabel("Contact name").fill("Suresh Kumar");
await contacts.getByRole("button", { name: "Add contact" }).click();
check(await contacts.getByText("Give a phone number or an email").waitFor({ timeout: 10000 }).then(() => true, () => false), "contacts: needs a phone or an email");
await contacts.getByLabel("Contact phone").fill("+91 94470 12345");
await contacts.getByLabel("Emergency contact").check();
await contacts.getByRole("button", { name: "Add contact" }).click();
await contacts.getByText("Suresh Kumar (Father)").waitFor({ timeout: 10000 }).catch(() => {});
text = await contacts.innerText();
check(/Suresh Kumar \(Father\)/.test(text) && /Emergency/.test(text), "contacts: listed with the emergency mark");

// ACT.
const tests = pp.locator("#tests");
await tests.locator('select[name="test"]').selectOption("ACT");
await tests.locator('input[name="overall"]').fill("29");
await tests.getByRole("button", { name: "Add test score" }).click();
await tests.getByText("ACT 29").waitFor({ timeout: 10000 }).catch(() => {});
check(await tests.getByText("ACT 29").isVisible(), "tests: ACT recorded");

text = await go(pp, `/students/${sid}/profile`);
check(/Background\s*Complete/i.test(text) && /Contacts\s*Complete/i.test(text), "profile: sections complete");
await pp.screenshot({ path: `${OUT}/profile.png`, fullPage: true });

// Pre-submission warning and priority on the application.
text = await go(pp, `/students/${sid}/applications?app=${appId}`);
check(/earlier visa refusal is recorded/i.test(text), "check: the visa refusal is flagged before submission");
check(await pp.locator('a[href$="/profile"] span').filter({ hasText: "✓" }).count() === 1, "tab: profile ticked once everything is answered");
await pp.getByLabel("Priority", { exact: true }).selectOption("HIGH");
await pp.getByRole("button", { name: "Set", exact: true }).click();
await pp.getByText("High priority").first().waitFor({ timeout: 10000 }).catch(() => {});
check(sql(`select priority from applications where id = '${appId}'`) === "HIGH", "priority: saved");
text = await go(pp, "/applications?priority=HIGH");
const ack = sql(`select ack_no from applications where id = '${appId}'`);
check(text.includes(ack) && /High priority/.test(text), "applications: the priority filter finds it");
text = await go(pp, "/applications?sort=priority");
const firstAck = (await pp.locator("tbody tr").first().locator("td").first().innerText()).split("\n")[0].trim();
check(firstAck === ack, `applications: high priority first (${firstAck})`);
const csv = await (await pp.request.get(`${BASE}/api/applications/export?priority=HIGH`)).text();
check(/Priority/.test(csv.split("\r\n")[0]) && csv.includes(ack) && /"High"/.test(csv), "export: carries the priority");

// Another branch cannot set it.
const other = await signIn("kochi@medcity.test", "10.97.1.3");
const res = await other.page.goto(`${BASE}/students/${sid}/applications?app=${appId}`);
check(res.status() === 404, "isolation: another branch cannot open the file");

// --- Registering one student by hand, from both sides of the desk.
// A branch registers into itself; the Overseas team has to say which branch,
// because a student on the head office belongs to nobody.
const tagR = String(Date.now()).slice(-5);
await partner.page.goto(`${BASE}/students`);
check((await partner.page.getByRole("link", { name: /Register (a |your first )?student/ }).count()) > 0, "register: a branch is offered the button");
await partner.page.goto(`${BASE}/students/new`);
check((await partner.page.locator('input[name="firstName"]').count()) > 0, "register: and the form");
check((await partner.page.locator('select[name="orgId"]').count()) === 0, "register: with no branch to choose, because it is their own");

const desk = await signIn("admin@medcityoverseas.test", "10.97.1.4");
await desk.page.goto(`${BASE}/students`);
check((await desk.page.getByRole("link", { name: /Register (a |your first )?student/ }).count()) > 0, "register: the Overseas team is offered it too");
await desk.page.goto(`${BASE}/students/new`);
check((await desk.page.locator('input[name="firstName"]').count()) > 0, "register: the desk can open the form");
check((await desk.page.locator('select[name="orgId"]').count()) > 0, "register: and is asked which branch");
await desk.page.fill('input[name="firstName"]', "Desk");
await desk.page.fill('input[name="lastName"]', `Registered${tagR}`);
await desk.page.fill('input[name="phone"]', `+91 98700${tagR}`);
await desk.page.locator('input[name="consent"]').check();
await desk.page.locator('button[type="submit"]').first().click();
await desk.page.waitForTimeout(2500);
check(/Choose the branch this student belongs to/.test(await desk.page.locator("main").innerText()), "register: without a branch it is refused, not filed against the head office");
check(sql(`select count(*) from students where last_name = 'Registered${tagR}'`) === "0", "register: and nothing is written");
const branchId = sql("select id from organizations where name = 'Medcity Kottayam'");
await desk.page.locator('select[name="orgId"]').selectOption(branchId);
await desk.page.locator('button[type="submit"]').first().click();
await desk.page.waitForURL((u) => /\/students\/[^/]+\/profile/.test(String(u)), { timeout: 20000 }).catch(() => {});
check(sql(`select org_id from students where last_name = 'Registered${tagR}'`) === branchId, "register: with one chosen, the student belongs to that branch");
check(sql(`select coalesce(medcity_id, '') ~ '^MC-KOT-' from students where last_name = 'Registered${tagR}'`) === "t", "register: and carries that branch's letters in their Medcity ID");
check(sql(`select count(*) from notifications where title = 'A student registered for you'`) !== "0", "register: the branch is told, so the file is not left unassigned and unwatched");

for (const [who, e] of [["partner", partner.errors], ["desk", desk.errors]]) check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
