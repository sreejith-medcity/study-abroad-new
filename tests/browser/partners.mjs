// The partners screen folds each organisation away, says enough about a
// folded one to answer the usual question, and searches the people inside the
// folds.
//
// Written after the screen was fifteen screens tall with nineteen
// organisations on it, every one of them stacked open.
import { chromium } from "playwright";
import { hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const email = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
const orgCount = Number(sql("select count(*) from organizations"));
// Somebody in a branch, so the search has to reach inside a fold to find them.
const hidden = sql(`
  select u.name from users u join organizations o on o.id = u.org_id
  where o.type <> 'HQ' and u.role <> 'STUDENT' and u.active and not u.must_change_password
  order by u.name limit 1`);
const hiddenOrg = sql(`
  select o.name from users u join organizations o on o.id = u.org_id
  where o.type <> 'HQ' and u.role <> 'STUDENT' and u.active and not u.must_change_password
  order by u.name limit 1`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "10.250.4.9" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

await page.goto(`${BASE}/admin/partners`);
await page.waitForTimeout(400);

const folds = page.locator("[id^='org-'] > details");
const foldCount = await folds.count();
check(foldCount === orgCount, `every organisation is a fold (${foldCount} of ${orgCount})`);
if (!foldCount) {
  console.log("\nnothing folds on this screen, so the rest cannot be checked");
  await browser.close();
  process.exit(1);
}

const open = await folds.evaluateAll((ds) => ds.filter((d) => d.open).length);
check(open > 0 && open < foldCount, `not everything is stacked open (${open} of ${foldCount} open)`);

// The head office is the desk's own team, so it is the one that starts open.
check(await folds.first().evaluate((d) => d.open), "the head office starts open");

// A folded organisation still has to answer the usual question without being
// opened: which tier and how many students, and for a sub-agent its seats.
// A branch has no seats: it is Medcity's own, staffed as Medcity decides.
const closed = page.locator("[id^='org-'] > details:not([open]) > summary");
const lines = (await closed.allInnerTexts()).map((t) => t.replace(/\s+/g, " "));
const branchLine = lines.find((l) => /Branch/.test(l)) ?? "";
const subLine = lines.find((l) => /Sub-agent/.test(l)) ?? "";
check(/students/.test(branchLine) && !/seats/.test(branchLine), `a folded branch says its students and no seats (${branchLine.slice(0, 90)})`);
check(!subLine || (/seats/.test(subLine) && /students/.test(subLine)), `a folded sub-agent says its seats and students (${subLine.slice(0, 90)})`);

// Fifteen screens was the complaint. Anything near that again is a regression.
const screens = await page.evaluate(() => document.documentElement.scrollHeight / window.innerHeight);
check(screens < 6, `the screen is under six screens tall (${screens.toFixed(1)})`);

// Folding hides names from the browser's own find, so the box has to search
// the people inside the folds.
await page.fill("input[placeholder*='Find a branch']", hidden);
await page.waitForTimeout(300);
const left = await page.locator("[id^='org-']").count();
check(left >= 1 && left < orgCount, `searching a branch person narrows the list to ${left}`);
check(await page.locator("[id^='org-'] > details").first().evaluate((d) => d.open), "the organisation found by the search is open");
check((await page.locator("[id^='org-']").first().innerText()).includes(hiddenOrg), `the one left is ${hiddenOrg}`);
check((await page.locator("[id^='org-'] li").filter({ hasText: hidden }).count()) >= 1, `${hidden} is on screen`);

// Clearing it puts everything back.
await page.fill("input[placeholder*='Find a branch']", "");
await page.waitForTimeout(300);
check((await page.locator("[id^='org-']").count()) === orgCount, "clearing the search brings every organisation back");

// Nonsense finds nobody rather than showing everybody.
await page.fill("input[placeholder*='Find a branch']", "zzqqxx");
await page.waitForTimeout(300);
check((await page.locator("[id^='org-']").count()) === 0, "a search matching nobody shows nothing");
await page.fill("input[placeholder*='Find a branch']", "");
await page.waitForTimeout(300);

// Opening a fold has to show the controls that live inside it.
const shut = page.locator("[id^='org-'] > details:not([open])").first();
const id = await shut.evaluate((d) => d.parentElement.id);
await page.locator(`#${id} > details > summary`).click();
await page.waitForTimeout(250);
check(await page.locator(`#${id} > details`).evaluate((d) => d.open), "clicking a folded organisation opens it");
check((await page.locator(`#${id} select[name='tier']`).count()) === 1, "the tier and seats form is inside the fold");
check((await page.locator(`#${id} li`).count()) >= 1, "its people are inside the fold");

// ---------------------------------------------------------------------------
// Editing a person, their department, and moving them to another branch.
//
// Written after the owner found he could not correct a name or an email, and
// could not move somebody who had changed branch without making them a new
// account and losing everything the old one had done.
// ---------------------------------------------------------------------------
const kottayam = sql("select id from organizations where name = 'Medcity Kottayam'");
const kochi = sql("select id from organizations where name = 'Medcity Kochi'");
const kottayamHead = sql("select id from users where email = 'kottayam@medcity.test'");
const senior = sql("select id from users where email = 'senior@medcity.test'");
const PERSON = "user-move-test";
const OLD_EMAIL = "move.test@medcity.test";
const NEW_EMAIL = "moved.test@medcity.test";
const seen = (q) => Number(sql(q));

// A counsellor of our own at Kottayam, so the suite can run again and again.
sql(`delete from student_people where user_id = '${PERSON}'`);
sql(`update students set assigned_to_id = '${kottayamHead}' where assigned_to_id = '${PERSON}'`);
sql(`delete from notifications where user_id = '${PERSON}'`);
sql(`delete from users where email in ('${OLD_EMAIL}', '${NEW_EMAIL}') and id <> '${PERSON}'`);
sql(`
  insert into users (id, org_id, name, email, password_hash, role, locale, desk_label)
  values ('${PERSON}', '${kottayam}', 'Move Me Counsellor', '${OLD_EMAIL}', (select password_hash from users where email = 'kottayam@medcity.test'), 'COUNSELLOR', 'en', 'Visa desk')
  on conflict (id) do update set org_id = excluded.org_id, name = excluded.name, email = excluded.email, role = 'COUNSELLOR', active = true,
    session_version = 1, must_change_password = false, department = null, desk_label = excluded.desk_label`);
const wards = sql(`select string_agg(id, ',') from (select id from students where org_id = '${kottayam}' and not archived order by created_at limit 2) s`).split(",").filter(Boolean);
sql(`update students set assigned_to_id = '${PERSON}' where id in (${wards.map((w) => `'${w}'`).join(",")})`);
sql(`insert into student_people (id, student_id, user_id, part) values ('sp-move-test', '${wards[0]}', '${PERSON}', 'Visa test') on conflict (id) do update set student_id = excluded.student_id, user_id = excluded.user_id`);
// Two tasks on their desk at Kottayam, one still open and one done, so the
// move can be seen to hand on the open one and leave the finished one alone.
sql(`delete from tasks where id in ('task-move-open', 'task-move-done')`);
sql(`insert into tasks (id, org_id, student_id, title, due_on, assigned_to_id, created_by_id, done_at, done_by_id)
     values ('task-move-open', '${kottayam}', '${wards[0]}', 'Move test open task', current_date, '${PERSON}', '${kottayamHead}', null, null),
            ('task-move-done', '${kottayam}', '${wards[1]}', 'Move test done task', current_date, '${PERSON}', '${kottayamHead}', now(), '${PERSON}')`);
check(wards.length === 2 && seen(`select count(*) from students where assigned_to_id = '${PERSON}' and org_id = '${kottayam}'`) === 2, "setup: two Kottayam students are assigned to the person");

// The person is signed in, so the edit can be seen to sign them out.
async function fresh(ip) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await c.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  return c;
}
async function trySignIn(ctx2, who) {
  const p = await ctx2.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill('input[name="email"]', who);
  await p.fill('input[name="password"]', "Password@123");
  await p.click('button[type="submit"]');
  await p.waitForURL((u) => !String(u).includes("/login"), { timeout: 8000 }).catch(() => {});
  return p;
}
const personCtx = await fresh("10.250.4.21");
const personPage = await trySignIn(personCtx, OLD_EMAIL);
check(!/\/login/.test(personPage.url()), "setup: the person is signed in with the old email");

// The row, found through the search so its fold is open.
async function findRow(who) {
  await page.goto(`${BASE}/admin/partners`);
  await hydrated(page);
  await page.fill("input[placeholder*='Find a branch']", who);
  await page.waitForTimeout(300);
  return page.getByTestId(`person-${who}`);
}
let row = await findRow(OLD_EMAIL);
check((await row.count()) === 1, "the person is listed with their email");
check((await row.locator("[data-edit-person]").count()) === 1 && (await row.locator("[data-move-person]").count()) === 1, "the row offers Edit details and Move to another branch");

// A taken email is refused, in any case.
await row.locator("[data-edit-person] summary").click();
await row.locator(`#email-${PERSON}`).fill("Kottayam@Medcity.Test");
await row.getByRole("button", { name: "Save details" }).click();
check(await row.getByText("Somebody else already signs in with that email.").waitFor({ timeout: 10000 }).then(() => true, () => false), "edit: an email somebody else signs in with is refused, whatever its case");
check(sql(`select email from users where id = '${PERSON}'`) === OLD_EMAIL, "edit: and nothing was saved");

// Name and email change together; the account keeps its id and its students.
const editsBefore = seen(`select count(*) from audit_logs where action = 'user.edit' and entity_id = '${PERSON}'`);
await row.locator(`#name-${PERSON}`).fill("Moved Person");
await row.locator(`#email-${PERSON}`).fill(`  ${NEW_EMAIL.toUpperCase()} `);
await row.getByRole("button", { name: "Save details" }).click();
check(await page.locator('[role="status"]').filter({ hasText: /now signs in with/ }).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "edit: the save says they now sign in with the new address");
check(sql(`select name || '|' || email || '|' || session_version from users where id = '${PERSON}'`) === `Moved Person|${NEW_EMAIL}|2`, "edit: name and email saved in lower case, sessions ended, same account");
check(seen(`select count(*) from students where assigned_to_id = '${PERSON}'`) === 2, "edit: their students are still theirs");
check(seen(`select count(*) from audit_logs where action = 'user.edit' and entity_id = '${PERSON}'`) === editsBefore + 1, "edit: audited");
check(sql(`select meta->'changes'->'email'->>'to' from audit_logs where action = 'user.edit' and entity_id = '${PERSON}' order by created_at desc limit 1`) === NEW_EMAIL, "edit: the audit row says what the email became");
check(seen(`select count(*) from notifications where user_id = '${PERSON}' and title = 'Your sign-in email changed'`) === 1, "edit: the person is told their sign-in email changed");

// Signed out at once, the old address no longer signs in, the new one does.
await personPage.goto(`${BASE}/dashboard`);
await personPage.waitForLoadState("domcontentloaded");
check(/\/login/.test(personPage.url()), "edit: the person's open session has ended");
const oldTry = await trySignIn(await fresh("10.250.4.22"), OLD_EMAIL);
check(/\/login/.test(oldTry.url()), "edit: the old email no longer signs in");
const newTry = await trySignIn(await fresh("10.250.4.23"), NEW_EMAIL);
check(!/\/login/.test(newTry.url()), "edit: the new email signs in");
await personCtx.close();

// Department: set on the person, shown on the row, and the list filters by it.
row = await findRow(NEW_EMAIL);
await row.locator("[data-edit-person] summary").click();
await row.locator(`#dept-${PERSON}`).selectOption("NCLEX-RN");
await row.getByRole("button", { name: "Save details" }).click();
await page.locator('[role="status"]').filter({ hasText: /Saved/ }).first().waitFor({ timeout: 10000 }).catch(() => {});
check(sql(`select coalesce(department, '') from users where id = '${PERSON}'`) === "NCLEX-RN", "department: saved on the person");
row = await findRow(NEW_EMAIL);
check((await row.innerText()).includes("NCLEX-RN"), "department: shown on their row");
await page.goto(`${BASE}/admin/partners`);
await hydrated(page);
await page.locator("#department-filter").selectOption("NCLEX-RN");
await page.locator("[data-department-filter]").getByRole("button", { name: "Show" }).click();
await page.waitForURL(/department=NCLEX-RN/, { timeout: 10000 }).catch(() => {});
await hydrated(page);
check(/department=NCLEX-RN/.test(page.url()) && (await page.locator("[data-department-shown]").count()) === 1, "department: the filter is in the address and says what it shows");
check((await page.getByTestId(`person-${NEW_EMAIL}`).count()) === 1, "department: the person in NCLEX-RN is listed");
check((await page.getByTestId("person-kottayam@medcity.test").count()) === 0, "department: somebody in no department is not");
check((await page.locator("[id^='org-']").count()) === orgCount, "department: every organisation is still listed, folded");

// A move: the students stay at Kottayam and go to a named colleague.
row = await findRow(NEW_EMAIL);
await row.locator("[data-move-person] summary").click();
const targets = await row.locator('select[name="toOrgId"] option').allInnerTexts();
check(targets.some((t) => /Medcity Kochi/.test(t)) && !targets.some((t) => /Overseas Corporation|Horizon/.test(t)), `move: only organisations a branch counsellor fits are offered (${targets.join(", ")})`);
check((await row.locator("[data-move-students]").getAttribute("data-move-students")) === "2", "move: the form says two students are assigned to them at Kottayam");
const peopleBefore = seen(`select count(*) from student_people where user_id = '${PERSON}'`);
const reassignBefore = seen(`select count(*) from audit_logs where action = 'student.reassign' and meta->>'via' = 'user.move' and meta->>'from' = '${PERSON}'`);
const noticesBefore = seen(`select count(*) from notifications where user_id = '${senior}' and title = 'Student assigned to you'`);
await row.locator('select[name="toOrgId"]').selectOption(kochi);
await row.locator('input[name="studentsChoice"][value="hand"]').check();
await row.locator('select[name="handToId"]').selectOption(senior);
const taskNoticesBefore = seen(`select count(*) from notifications where user_id = '${senior}' and title = 'Tasks handed to you'`);
await row.getByRole("button", { name: "Move Moved Person" }).click();
// The row leaves the Kottayam fold the moment the save lands, so the
// confirmation has to come from the toast host in the shell, not the form.
const moveToast = page.locator('[role="status"]').filter({ hasText: /is now at Medcity Kochi/ }).first();
check(await moveToast.waitFor({ timeout: 15000 }).then(() => true, () => false), "move: the save says where they are now");
check(/2 students handed to .+\. 1 open task handed to /.test((await moveToast.innerText().catch(() => "")).replace(/\s+/g, " ")), "move: and says the students and the open task went to the colleague");
check(sql(`select org_id || '|' || session_version from users where id = '${PERSON}'`) === `${kochi}|3`, "move: they are at Kochi, signed out again");
check(seen(`select count(*) from students where id in (${wards.map((w) => `'${w}'`).join(",")}) and assigned_to_id = '${senior}' and org_id = '${kottayam}'`) === 2, "move: both students went to the colleague and stayed at Kottayam");
check(peopleBefore === 1 && seen(`select count(*) from student_people where user_id = '${PERSON}'`) === 0, "move: taken off the Kottayam file they were named on");
check(seen(`select count(*) from audit_logs where action = 'user.move' and entity_id = '${PERSON}' and meta->>'to' = '${kochi}' and meta->>'handTo' = '${senior}'`) >= 1, "move: audited with where to and who took the students");
check(seen(`select count(*) from audit_logs where action = 'student.reassign' and meta->>'via' = 'user.move' and meta->>'from' = '${PERSON}'`) === reassignBefore + 2, "move: each hand-over is on the student's own record");
check(seen(`select count(*) from notifications where user_id = '${senior}' and title = 'Student assigned to you'`) === noticesBefore + 2, "move: the colleague is told about each student");
check(seen(`select count(*) from notifications where user_id = '${PERSON}' and title = 'You have been moved to Medcity Kochi'`) === 1, "move: the person is told");
check(sql(`select assigned_to_id || '|' || org_id from tasks where id = 'task-move-open'`) === `${senior}|${kottayam}`, "move: their open task at Kottayam went to the colleague and stayed at Kottayam");
check(sql(`select assigned_to_id from tasks where id = 'task-move-done'`) === PERSON, "move: the task they had finished stays on their record");
check(seen(`select count(*) from audit_logs where action = 'user.move' and entity_id = '${PERSON}' and meta->>'tasks' = '1' and meta->>'tasksTo' = '${senior}' and meta->>'tasksLeft' = '0'`) >= 1, "move: the audit row counts the task and says who took it");
check(seen(`select count(*) from notifications where user_id = '${senior}' and title = 'Tasks handed to you'`) === taskNoticesBefore + 1, "move: the colleague is told about the task");
check(/Medcity Kochi/.test(await (await findRow(NEW_EMAIL)).locator("xpath=ancestor::*[starts-with(@id, 'org-')]").innerText()), "move: listed under Kochi now");

// A branch keeps its head: the only active head of Kottayam cannot be moved
// away, and a head cannot be moved into a branch that already has one.
const headRow = await findRow("kottayam@medcity.test");
await headRow.locator("[data-move-person] summary").click();
const headTargets = await headRow.locator('select[name="toOrgId"] option').allInnerTexts();
check(headTargets.some((t) => /Medcity Kochi/.test(t)), `move: a branch head is offered the other branches (${headTargets.join(", ")})`);
await headRow.locator('select[name="toOrgId"]').selectOption(kochi);
if ((await headRow.locator('input[name="studentsChoice"][value="leave"]').count()) > 0) await headRow.locator('input[name="studentsChoice"][value="leave"]').check();
await headRow.getByRole("button", { name: /^Move / }).click();
check(await headRow.getByText(/Medcity Kottayam would be left without a branch head/).waitFor({ timeout: 10000 }).then(() => true, () => false), "move: taking the only head away from a branch is refused in plain words");
check(sql(`select org_id from users where id = '${kottayamHead}'`) === kottayam, "move: and the head is still at Kottayam");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
