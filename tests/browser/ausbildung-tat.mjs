// The Ausbildung turnaround follow-through.
//
// An Ausbildung file that has sat at its step longer than the written process
// allows is followed up once a morning: one task on the desk that owns the
// step, and the desk told, naming the student, the step and the days over,
// with a link to the application. Once per stay in a step, so a second run
// raises nothing twice and a task the desk has ticked off does not come back.
// Then the tracker's "Over turnaround" filter and tile, and the documentation
// dashboard's tile. Wants the plain seed, and CRON_SECRET set in .env (the
// scheduler's calls are skipped, and said so, where it is not).
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const ENV = fs.readFileSync(".env", "utf8");
const DB = (ENV.match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
// Read for the Authorization header only, the way the scheduler sends it; never printed.
const SECRET = (ENV.match(/^CRON_SECRET="?([^"\n]*)"?/m) || [])[1] ?? "";
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));
const skip = (m) => console.log("skip  " + m);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 60;
const all = [];
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, extraHTTPHeaders: { "x-forwarded-for": `10.241.7.${ip++}` } });
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
  all.push({ email, errors });
  return { ctx, page, errors };
}
const go = async (page, path) => {
  await page.goto(BASE + path);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};

/** The scheduler's call, with the secret the way GitHub sends it. */
const runCron = async () => {
  const res = await fetch(`${BASE}/api/cron/ausbildung`, { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

/* ---------------- The file under test ---------------- */
// Akshara's open Ausbildung application sits at the employer interview: step
// 10, the placement desk, T+30. Pushed back to forty-five days ago, which the
// tracker reads as fifteen days over.
const akshara = sql("select id from students where first_name = 'Akshara'");
const app = sql(`select a.id from applications a join programs p on p.id = a.program_id join status_definitions sd on sd.id = a.status_id where a.student_id = '${akshara}' and p.pathway = 'AUSBILDUNG' and sd.code = 'EMPLOYER_INTERVIEW' order by a.status_changed_at desc limit 1`);
const statusBefore = sql(`select status_id || '|' || status_changed_at from applications where id = '${app}'`);
const href = `/students/${akshara}/applications?app=${app}`;
const taskCount = () => sql(`select count(*) from tasks where application_id = '${app}' and auto_key like 'ausbildung-tat:%'`);
const toldCount = (email) => sql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = '${email}' and n.href = '${href}' and n.title like '%over its turnaround%'`);
const clean = () => {
  sql(`delete from tasks where application_id = '${app}' and auto_key like 'ausbildung-tat:%'`);
  sql(`delete from notifications where href = '${href}' and title like '%over its turnaround%'`);
};

check(!!app, "the seed has Akshara's application at the employer interview");
clean();
sql(`update applications set status_changed_at = now() - interval '45 days' where id = '${app}'`);

/* ---------------- The scheduler's endpoint ---------------- */
{
  const res = await fetch(`${BASE}/api/cron/ausbildung`, { method: "POST" });
  check(res.status === 401, "the scheduler's endpoint refuses a call without the secret");
}

const cronOn = SECRET.length >= 24;
if (!cronOn) skip("CRON_SECRET is not set in .env, so the scheduled run itself is not exercised here");

/* ---------------- One task, one notice each, on the placement desk ---------------- */
if (cronOn) {
  const first = await runCron();
  check(first.status === 200 && first.body.ok === true, `the run answers ok (${first.status})`);
  check(Number(first.body.tasksRaised) >= 1, `and says it raised at least one task (${first.body.tasksRaised})`);

  check(taskCount() === "1", "one follow-up task is raised on the application");
  const task = sql(`select t.title || '|' || t.source || '|' || t.kind || '|' || u.email || '|' || coalesce(t.detail, '') from tasks t join users u on u.id = t.assigned_to_id where t.application_id = '${app}' and t.auto_key like 'ausbildung-tat:%'`);
  check(/^Step 10 is over its turnaround: Akshara Anilkumar\|the Ausbildung turnaround\|APPLICATION\|/.test(task), `named for the step and the student, raised by the turnaround (${task.slice(0, 90)})`);
  check(/\|germany\.desk@medcityoverseas\.test\|/.test(task), "and put on the officer carrying the file, who is on the placement desk");
  check(/15 days over the guide's T\+30/.test(task) && /45 days/.test(task), "with the days in the step and the days over in the detail");

  check(toldCount("teamlead@medcityoverseas.test") === "1", "the application team leader is told once");
  check(toldCount("germany.desk@medcityoverseas.test") === "1" && toldCount("sreejith@miak.in") === "1", "and so are the admins");
  check(toldCount("documentation@medcityoverseas.test") === "0", "the documentation officer is not told about the placement desk's step");
  check(toldCount("germany@medcity.test") === "0" && toldCount("kottayam@medcity.test") === "0", "nor are the counsellor and the branch head");
  const notice = sql(`select n.title || '|' || coalesce(n.body, '') from notifications n join users u on u.id = n.user_id where u.email = 'teamlead@medcityoverseas.test' and n.href = '${href}' limit 1`);
  check(/^Akshara Anilkumar: step 10 is 15 days over its turnaround\|/.test(notice), `the notice names the student, the step and the days over (${notice.slice(0, 80)})`);
  check(/Interview scheduling/.test(notice) && /placement desk/.test(notice), "and the step's title and desk in the body");

  // The run the day after: nothing is raised or sent twice.
  const second = await runCron();
  check(second.status === 200 && second.body.ok === true, "a second run answers ok");
  check(taskCount() === "1", "and raises no second task for the same stay");
  check(toldCount("teamlead@medcityoverseas.test") === "1", "and tells nobody twice");

  // The desk ticks the task off; the file is still late, and still not nagged again.
  sql(`update tasks set done_at = now(), done_note = 'Chased the employer' where application_id = '${app}' and auto_key like 'ausbildung-tat:%'`);
  const third = await runCron();
  check(third.status === 200 && taskCount() === "1", "a task ticked off does not come back while the file stays at the step");
}

/* ---------------- The tracker: the tile and the filter ---------------- */
const admin = await signIn("sreejith@miak.in");
{
  const page = admin.page;
  await go(page, "/ausbildung");
  const tile = page.locator("[data-over-turnaround]");
  check((await tile.count()) === 1, "the tracker has the over-turnaround tile");
  const n = Number(await tile.getAttribute("data-over-turnaround"));
  check(n >= 1, `and it counts at least Akshara's file (${n})`);
  check(new RegExp(`${n} files? over (its|their) turnaround`).test((await tile.innerText()).replace(/\s+/g, " ")), "worded as files over their turnaround");
  check((await tile.getAttribute("href")) === "/ausbildung?show=over", "and it opens the filtered list");
  check((await page.locator('select[name="show"] option', { hasText: "Over turnaround" }).count()) === 1, "'Show' offers 'Over turnaround'");

  let text = await go(page, "/ausbildung?show=over");
  check(text.includes("Akshara"), "'Over turnaround' shows the late file");
  const row = (await page.locator(`[data-tracker-row="${akshara}"]`).innerText().catch(() => "")).replace(/\s+/g, " ");
  check(/Step 10, 45 days here; guide: T\+30/.test(row), `with its days against the guide (${row.slice(-220)})`);
  check(Number(await page.locator("[data-over-turnaround]").getAttribute("data-over-turnaround")) === (await page.locator("[data-tracker-row]").count()), "the tile's figure is the number of rows the filter shows");
  const nclex = await go(page, "/ausbildung?tab=nclex");
  check(!/Over turnaround/.test(await page.locator('select[name="show"]').innerText().catch(() => "")) && !nclex.includes("over their turnaround"), "the other tabs have neither the option nor the tile");
}

/* ---------------- The documentation dashboard ---------------- */
{
  const docs = await signIn("documentation@medcityoverseas.test");
  await go(docs.page, "/dashboard");
  const tile = docs.page.locator('[data-tile="over-turnaround"]');
  check((await tile.count()) === 1, "the documentation dashboard has an over-turnaround tile while a file is late");
  check((await tile.getAttribute("href")) === "/ausbildung?show=over", "linking to the filtered tracker");
  check(Number((await tile.locator("[data-figure]").innerText()).replace(/\D/g, "")) >= 1, "with the count on it");
  await docs.ctx.close();
}

/* ---------------- A counselling step: the branch is told, not the desk ---------------- */
// Document collection is the counsellor's step, T+7. The same file is moved
// there and pushed back ten days. The earlier task is removed first, because
// a stay raised afterwards would otherwise read as already followed up: in
// use the move stamps the status with now, and nothing is backdated.
const collection = sql("select id from status_definitions where pathway = 'AUSBILDUNG' and code = 'DOCUMENT_COLLECTION'");
if (cronOn && collection) {
  clean();
  sql(`update applications set status_id = '${collection}', status_changed_at = now() - interval '10 days' where id = '${app}'`);
  const run = await runCron();
  check(run.status === 200 && taskCount() === "1", "a counselling step over its turnaround raises one task");
  const who = sql(`select u.email from tasks t join users u on u.id = t.assigned_to_id where t.application_id = '${app}' and t.auto_key like 'ausbildung-tat:%'`);
  check(who === "germany@medcity.test", `on the student's own counsellor (${who})`);
  check(toldCount("germany@medcity.test") === "1" && toldCount("kottayam@medcity.test") === "1", "the counsellor and the branch head are told");
  check(toldCount("teamlead@medcityoverseas.test") === "0" && toldCount("documentation@medcityoverseas.test") === "0", "and the Overseas desk is not");
  const notice = sql(`select n.title from notifications n join users u on u.id = n.user_id where u.email = 'kottayam@medcity.test' and n.href = '${href}' limit 1`);
  check(/step 3 is 3 days over its turnaround/.test(notice), `ten days at a T+7 step reads as three days over (${notice})`);
}

/* ---------------- A documentation step: the documentation desk is told ---------------- */
const preparation = sql("select id from status_definitions where pathway = 'AUSBILDUNG' and code = 'DOCUMENT_PREPARATION'");
if (cronOn && preparation) {
  clean();
  sql(`update applications set status_id = '${preparation}', status_changed_at = now() - interval '9 days' where id = '${app}'`);
  const run = await runCron();
  check(run.status === 200 && taskCount() === "1", "a documentation step over its turnaround raises one task");
  const who = sql(`select u.email from tasks t join users u on u.id = t.assigned_to_id where t.application_id = '${app}' and t.auto_key like 'ausbildung-tat:%'`);
  check(who === "teamlead@medcityoverseas.test", `on the application team leader, who runs the documentation desk (${who})`);
  check(toldCount("teamlead@medcityoverseas.test") === "1", "the team leader is told");
  check(toldCount("germany.desk@medcityoverseas.test") === "0" && toldCount("kottayam@medcity.test") === "0", "the admins and the branch are not");
}

/* ---------------- Back to the seed, and the file is no longer late ---------------- */
{
  const [statusId, changedAt] = statusBefore.split("|");
  sql(`update applications set status_id = '${statusId}', status_changed_at = '${changedAt}' where id = '${app}'`);
  clean();
  const page = admin.page;
  const text = await go(page, "/ausbildung?show=over");
  check(!text.includes("Akshara"), "with the status back where the seed left it, the file leaves 'Over turnaround'");
  const n = Number(await page.locator("[data-over-turnaround]").getAttribute("data-over-turnaround"));
  check(n === (await page.locator("[data-tracker-row]").count()), `and the tile's figure follows (${n})`);
  if (n === 0) {
    check(/No files over their turnaround/.test(await page.locator("[data-over-turnaround]").innerText()), "a zero is said in words");
    const docs = await signIn("documentation@medcityoverseas.test");
    await go(docs.page, "/dashboard");
    check((await docs.page.locator('[data-tile="over-turnaround"]').count()) === 0, "and the dashboard tile is not drawn when nothing is late");
    await docs.ctx.close();
  }
}

for (const a of all) check(a.errors.length === 0, `${a.email}: no page errors or 500s ${a.errors.slice(0, 2).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
