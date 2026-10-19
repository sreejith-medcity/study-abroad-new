// Getting rid of a team or a branch added by mistake.
//
// Teams could only be retired and branches could do nothing at all, so three
// NCLEX teams typed while setting the portal up sat on the screen for good,
// and a branch added in error was in every dropdown forever.
//
// The rule, for both: anything nothing has used is a mistake and goes for
// good; anything that has carried work is retired or closed, so what it did
// still reads. This checks both halves, and that the screen offers whichever
// one applies rather than making somebody guess. Wants the plain seed.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));

// Every card on these screens folds, and some of them start open. Clicking
// a summary blind shuts the ones that were already showing, so this opens
// the shut ones and leaves the rest alone, the way a person reading the
// screen would.
const openAll = async (page, rounds = 3) => {
  for (let i = 0; i < rounds; i++) {
    const shut = page.locator("main details:not([open]) > summary");
    const n = await shut.count();
    if (n === 0) break;
    for (let k = 0; k < n; k++) await shut.nth(k).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(150);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.203.6.1" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e)); });
page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', "sreejith@miak.in");
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.locator("aside[data-nav]").first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});

/* ---------------- A team nobody has used ---------------- */

const typo = "NCLEX RN processesing";
sql(`insert into teams (id, name, note) values ('team-typo-test', '${typo}', 'Typed twice while setting up') on conflict (id) do update set active = true, name = excluded.name`);
await page.goto(`${BASE}/admin/teams`);
await hydrated(page);

const card = page.locator("details").filter({ hasText: typo }).first();
await openAll(page);
check((await card.getByRole("button", { name: "Delete this team" }).count()) > 0, "a team nobody has used offers to be deleted");
check((await card.getByRole("button", { name: /Retire this team/ }).count()) === 0, "and is not offered the retire that keeps it");
await card.getByRole("button", { name: "Delete this team" }).click();
for (let t0 = Date.now(); sql(`select count(*) from teams where id = 'team-typo-test'`) !== "0" && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
check(sql(`select count(*) from teams where id = 'team-typo-test'`) === "0", "and deleting it takes it away for good");
check(sql(`select count(*) from audit_logs where entity_id = 'team-typo-test' and action = 'team.delete'`) !== "0", "and it is in the audit log");

/* ---------------- A team that carries a student ---------------- */

const student = sql("select id from students where not archived limit 1");
sql(`insert into teams (id, name) values ('team-used-test', 'Carries a student') on conflict (id) do update set active = true`);
sql(`update students set team_id = 'team-used-test' where id = '${student}'`);
await page.goto(`${BASE}/admin/teams`);
await hydrated(page);
const used = page.locator("details").filter({ hasText: "Carries a student" }).first();
await openAll(page);
check((await used.getByRole("button", { name: "Delete this team" }).count()) === 0, "a team carrying a student is not offered a delete");
check((await used.getByRole("button", { name: /Retire this team/ }).count()) > 0, "it is offered the retire that keeps it");
await used.getByRole("button", { name: /Retire this team/ }).click();
for (let t0 = Date.now(); sql(`select active from teams where id = 'team-used-test'`) !== "f" && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
check(sql(`select active from teams where id = 'team-used-test'`) === "f", "retiring it puts it away");
check(sql(`select count(*) from students where team_id = 'team-used-test'`) === "1", "and the student it carries still says so");

// And the guard holds even if the form is posted by hand for one it should refuse.
sql(`update teams set active = true where id = 'team-used-test'`);
const before = sql("select count(*) from teams");
await page.request.post(`${BASE}/admin/teams`, { form: { teamId: "team-used-test" }, failOnStatusCode: false }).catch(() => {});
check(sql("select count(*) from teams") === before, "a delete posted by hand for a team in use changes nothing");
sql(`update students set team_id = null where id = '${student}'`);
sql(`delete from teams where id = 'team-used-test'`);

/* ---------------- A branch nobody has touched ---------------- */

sql(`
  insert into organizations (id, name, type, city)
  values ('org-typo-test', 'Branch Typed By Mistake', 'BRANCH', 'Nowhere')
  on conflict (id) do update set active = true, name = excluded.name`);
sql(`
  insert into users (id, org_id, name, email, password_hash, role, locale)
  values ('user-typo-test', 'org-typo-test', 'Never Signed In', 'never.signed.in@example.test', 'x', 'PARTNER', 'en')
  on conflict (id) do update set last_sign_in_at = null`);
await page.goto(`${BASE}/admin/partners`);
await hydrated(page);
const branch = page.locator("details").filter({ hasText: "Branch Typed By Mistake" }).first();
await openAll(page);
check((await branch.getByRole("button", { name: "Delete this branch" }).count()) > 0, "a branch nobody has touched offers to be deleted");
await branch.getByRole("button", { name: "Delete this branch" }).click();
for (let t0 = Date.now(); sql(`select count(*) from organizations where id = 'org-typo-test'`) !== "0" && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
check(sql(`select count(*) from organizations where id = 'org-typo-test'`) === "0", "and deleting it takes it away");
check(sql(`select count(*) from users where id = 'user-typo-test'`) === "0", "and the account that never signed in goes with it");

/* ---------------- A branch that has done something ---------------- */

const live = sql("select id from organizations where type = 'BRANCH' and id in (select org_id from students) limit 1");
const liveName = sql(`select name from organizations where id = '${live}'`);
await page.goto(`${BASE}/admin/partners`);
await hydrated(page);
const working = page.locator("details").filter({ hasText: liveName }).first();
await openAll(page);
check((await working.getByRole("button", { name: "Delete this branch" }).count()) === 0, `a branch with students is not offered a delete (${liveName})`);
check((await working.getByRole("button", { name: /Close this branch/ }).count()) > 0, "it is offered the close that keeps everything");

const students = sql(`select count(*) from students where org_id = '${live}'`);
await working.getByRole("button", { name: /Close this branch/ }).click();
for (let t0 = Date.now(); sql(`select active from organizations where id = '${live}'`) !== "f" && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
check(sql(`select active from organizations where id = '${live}'`) === "f", "closing it puts it away");
check(sql(`select count(*) from students where org_id = '${live}'`) === students, `and every one of its students is still there (${students})`);

// A closed branch is not offered on a new student.
await page.goto(`${BASE}/students/new`);
await hydrated(page);
const offered = (await page.locator("main").innerText()).includes(liveName);
check(!offered, "and it is not offered when registering a student");

// Open it again, and it is back.
await page.goto(`${BASE}/admin/partners`);
await hydrated(page);
const shut = page.locator("details").filter({ hasText: liveName }).first();
await openAll(page);
await shut.getByRole("button", { name: /Open it again/ }).click();
for (let t0 = Date.now(); sql(`select active from organizations where id = '${live}'`) !== "t" && Date.now() - t0 < 15000; ) await page.waitForTimeout(300);
check(sql(`select active from organizations where id = '${live}'`) === "t", "and it can be opened again");

// The head office is neither closed nor deleted: there is only one of it.
await page.goto(`${BASE}/admin/partners`);
await hydrated(page);
const hqName = sql("select name from organizations where type = 'HQ' limit 1");
const hq = page.locator("details").filter({ hasText: hqName }).first();
await openAll(page);
check((await hq.getByRole("button", { name: /Close this branch|Delete this branch/ }).count()) === 0, "the head office is offered neither");

check(errors.length === 0, `no page errors or 500s ${errors.slice(0, 3).join(" | ")}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
