// The students list, fifty at a time.
//
// It used to draw two hundred rows at once and stop there: slow to open on a
// big branch, and everybody past the two hundredth could not be reached from
// the list at all. Now it draws fifty, says how many there are, and offers the
// next fifty, keeping whatever filters were on.
// Wants the plain seed; adds its own students.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const n = (q) => Number(sql(q));
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = "kottayam@medcity.test";
const org = sql(`select org_id from users where email = '${email}'`);
// 230 more students in the branch, so the old cap of two hundred is passed.
sql(`insert into students (id, org_id, portal_token, first_name, last_name, phone, created_at)
     select 'pg_s' || g, '${org}', 'pg_t' || g, 'Paging', 'Student ' || lpad(g::text, 3, '0'), '91000' || lpad(g::text, 5, '0'), now() - (g || ' minutes')::interval
     from generate_series(1, 230) g`);
const total = n(`select count(*) from students where org_id = '${org}' and not archived`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.244.7.11" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 120)); });
page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});

const open = async (path) => {
  await page.goto(`${BASE}${path}`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
};
const rows = () => page.locator("main tbody tr").count();
const foot = async () => (await page.locator("[data-list-foot]").innerText()).replace(/\s+/g, " ");

await open("/students");
check((await rows()) === 50, `the list opens on fifty (${await rows()})`);
check((await foot()).includes(`of ${total.toLocaleString("en-IN")}`), `and says how many there are (${await foot()})`);

await page.getByRole("link", { name: /Show 50 more/ }).click();
await page.waitForURL(/show=100/, { timeout: 15000 });
await hydrated(page);
check((await rows()) === 100, `"show more" adds the next fifty (${await rows()})`);

await open(`/students?show=${total + 50}`);
check((await rows()) === total, `everybody can be reached, past the old two hundred (${await rows()} of ${total})`);
check((await page.getByRole("link", { name: /more$/ }).count()) === 0, "and there is no 'more' once the end is reached");

// The filters stay on while paging.
const matching = n(`select count(*) from students where org_id = '${org}' and not archived and last_name like 'Student 1%'`);
await open(`/students?q=${encodeURIComponent("Student 1")}`);
check((await foot()).includes(`of ${matching}`), `a search counts only what it finds (${await foot()}, ${matching} in the database)`);
if (matching > 50) {
  await page.getByRole("link", { name: /more$/ }).click();
  await page.waitForURL(/show=100/, { timeout: 15000 });
  await hydrated(page);
  const href = page.url();
  check(href.includes("q=Student"), "and 'show more' keeps the search");
  check((await rows()) === Math.min(100, matching), `and draws the next of them (${await rows()})`);
}

// A nonsense page size is read as the first page, not as an error.
await open("/students?show=banana");
check((await rows()) === 50, "a page size that is not a number opens the first fifty");

check(errors.length === 0, `no errors ${errors.slice(0, 2).join(" | ")}`);
await ctx.close();

/* ---------------- A counsellor's list is their own: assigned to them, or registered by them ---------------- */
// Sreekutty's list at her branch held thirteen: ten given to her, two she
// registered herself that nobody had been given, and one a colleague
// registered that nobody had been given. The last one is not hers; it is the
// branch head's to hand out. Her list holds twelve, "Nobody yet" narrows it
// to the two she registered, and the colleague's walk-in is not among them.
const counsellor = "germany@medcity.test";
const colleague = "uk.docs@medcity.test";
const me = sql(`select id from users where email = '${counsellor}'`);
const them = sql(`select id from users where email = '${colleague}'`);
sql("delete from students where id in ('sl_own', 'sl_theirs', 'sl_given')");
sql(`insert into students (id, org_id, created_by_id, assigned_to_id, portal_token, first_name, last_name, phone)
     values ('sl_own', '${org}', '${me}', null, 'sl_t_own', 'Listcheck', 'Walkin', '9100000801'),
            ('sl_theirs', '${org}', '${them}', null, 'sl_t_theirs', 'Listcheck', 'Colleague', '9100000802'),
            ('sl_given', '${org}', '${them}', '${me}', 'sl_t_given', 'Listcheck', 'Given', '9100000803')`);
// Exactly the rule the portal applies, written out: inside the branch, and
// registered by them, assigned to them, or worked by them in a recorded way.
const own = (id) => n(`select count(*) from students s where s.org_id = '${org}' and not s.archived and (
  s.created_by_id = '${id}' or s.assigned_to_id = '${id}'
  or exists (select 1 from applications a where a.student_id = s.id and a.officer_id = '${id}')
  or exists (select 1 from checklist_items c where c.student_id = s.id and (c.claimed_by_id = '${id}' or c.decided_by_id = '${id}'))
  or exists (select 1 from student_people p where p.student_id = s.id and p.user_id = '${id}'))`);
const ownUnassigned = (id) => n(`select count(*) from students s where s.org_id = '${org}' and not s.archived and s.assigned_to_id is null and (
  s.created_by_id = '${id}'
  or exists (select 1 from applications a where a.student_id = s.id and a.officer_id = '${id}')
  or exists (select 1 from checklist_items c where c.student_id = s.id and (c.claimed_by_id = '${id}' or c.decided_by_id = '${id}'))
  or exists (select 1 from student_people p where p.student_id = s.id and p.user_id = '${id}'))`);
const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.244.7.12" } });
await ctx2.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const cpage = await ctx2.newPage();
const cerrors = [];
cpage.on("pageerror", (e) => { if (knownWarning(e, cpage.url())) return; cerrors.push(String(e).slice(0, 120)); });
cpage.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) cerrors.push(`${r.status()} ${r.url()}`); });
await cpage.goto(`${BASE}/login`);
await cpage.fill('input[name="email"]', counsellor);
await cpage.fill('input[name="password"]', "Password@123");
await cpage.click('button[type="submit"]');
await cpage.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
const copen = async (path) => {
  await cpage.goto(`${BASE}${path}`);
  await cpage.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(cpage);
};
const names = async () => (await cpage.locator("main tbody tr").allInnerTexts()).join(" | ");
const cfoot = async () => (await cpage.locator("[data-list-foot]").innerText()).replace(/\s+/g, " ");

await copen(`/students?show=${total + 100}`);
const mine = own(me);
const listed = await cpage.locator("main tbody tr").count();
check(listed === mine, `a counsellor's list holds their own students and no more (${listed} against ${mine} in the database)`);
check((await cfoot()).includes(`of ${mine}`), `and says so under the list (${await cfoot()})`);
let shown = await names();
check(shown.includes("Listcheck Walkin"), "it lists the student they registered that nobody has been given");
check(shown.includes("Listcheck Given"), "and the student a colleague registered and gave to them");
check(!shown.includes("Listcheck Colleague"), "and not the student a colleague registered that nobody has been given");
check(mine < total + 3, "which is fewer than the branch has, so the scoping is doing something");

await copen("/students?assignedTo=none");
const loose = ownUnassigned(me);
const looseListed = await cpage.locator("main tbody tr").count();
check(looseListed === loose, `"Nobody yet" narrows to the ones of their own with no counsellor named (${looseListed} against ${loose})`);
shown = await names();
check(shown.includes("Listcheck Walkin") && !shown.includes("Listcheck Colleague"), "which is the one they registered, not the colleague's");

// The colleague's walk-in does not open by its address either, so the list
// is not hiding something the file would show.
await cpage.goto(`${BASE}/students/sl_theirs/profile`);
await cpage.waitForTimeout(800);
check(!/Listcheck Colleague/.test(await cpage.locator("body").innerText()), "a colleague's unassigned student does not open by its address");
check(cerrors.length === 0, `no errors for the counsellor ${cerrors.slice(0, 2).join(" | ")}`);
await ctx2.close();
sql("delete from students where id in ('sl_own', 'sl_theirs', 'sl_given')");

await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
