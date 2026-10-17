// More than one person on a student's file.
//
// A file has one assigned counsellor, and everybody else working on it goes
// on the people list beside them. That list existed but was the head office's
// alone, on the reasoning that a branch names its own counsellor and nothing
// else. That is wrong about how a branch works: two counsellors sharing a
// student, or one covering while the other is away, is the ordinary case, and
// recording it meant asking the head office.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 200;
const signIn = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, extraHTTPHeaders: { "x-forwarded-for": `10.222.1.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  return page;
};

// A branch that has more than one person who can work a student file, so
// there is somebody to add.
const row = sql(`
  select o.id || '|' || (select u.email from users u where u.org_id = o.id and u.role = 'PARTNER' and u.active limit 1)
  from organizations o
  where o.type <> 'HQ'
    and (select count(*) from users u where u.org_id = o.id and u.active
         and u.role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR')) > 1
    and exists (select 1 from students s where s.org_id = o.id and not s.archived)
  limit 1`);
if (!row) {
  console.log("  ok  no branch with two people and a student, nothing to check");
  await browser.close();
  process.exit(0);
}
const [orgId, branchEmail] = row.split("|");
const studentId = sql(`select id from students where org_id = '${orgId}' and not archived order by created_at desc limit 1`);
const helperId = sql(`
  select id from users where org_id = '${orgId}' and active
    and role in ('COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','PARTNER')
    and email <> '${branchEmail}' order by email limit 1`);
const helperName = sql(`select coalesce(desk_label, name) from users where id = '${helperId}'`);
sql(`delete from student_people where student_id = '${studentId}'`);

const branch = await signIn(branchEmail);
await branch.goto(`${BASE}/students/${studentId}/profile`);
await branch.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
await branch.waitForTimeout(900);

const panel = branch.locator("#team");
const shown = (await panel.count()) === 1;
check(shown, "a branch is shown who is on its own student's file");
// Without the panel there is nothing to drive, and every locator below would
// hang on an element that will never appear rather than say what is wrong.
if (!shown) {
  for (const m of [
    "but not which team carries it, which is the desk's call",
    "and is offered somebody to add",
    "its own branch's people are in the list",
    "a second person goes on the file",
  ]) check(false, m);
  await browser.close();
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
// The section folds when there is nobody on the file yet, which is the state
// this test starts from, so open it before driving what is inside. React owns
// the open state here, so it has to be clicked rather than set.
const openPanel = async (card) => {
  const summary = card.locator("summary").first();
  if (!(await card.locator("details").first().evaluate((d) => d.open))) await summary.click();
  await branch.waitForTimeout(400);
};
await openPanel(panel);
// Deciding which part of the business carries a file is not a branch's call.
check((await panel.locator('select[name="teamId"]').count()) === 0, "but not which team carries it, which is the desk's call");

const picker = panel.locator('select[name="userId"], input[name="userId"]').first();
check((await picker.count()) > 0, "and is offered somebody to add");
check(
  (await panel.locator(`option[value="${helperId}"]`).count()) > 0,
  `${helperName}, from its own branch, is in the list`,
);
// Nobody from the head office: a branch adds its own people only.
const hqId = sql("select id from users where role = 'DOCUMENTATION' and active limit 1");
if (hqId) check((await panel.locator(`option[value="${hqId}"]`).count()) === 0, "and nobody from the head office is");

await picker.selectOption(helperId);
await panel.locator('input[name="part"], select[name="part"]').first().fill("Documents").catch(async () => {
  await panel.locator('select[name="part"]').first().selectOption({ index: 1 });
});
await panel.getByRole("button", { name: /Add|Put on the file/i }).first().click();
const onFile = () => Number(sql(`select count(*) from student_people where student_id = '${studentId}' and user_id = '${helperId}'`));
for (let t0 = Date.now(); onFile() === 0 && Date.now() - t0 < 15000; ) await branch.waitForTimeout(300);
check(onFile() === 1, "a second person goes on the file");
check(
  sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`) !== helperId,
  "beside the assigned counsellor rather than replacing them",
);
check(/student.person.add/.test(sql(`select coalesce(string_agg(action, ','), '') from audit_logs where entity_id = '${studentId}'`)), "and it is written to the audit log");

// A third, because "more than two" was the point.
const thirdId = sql(`
  select id from users where org_id = '${orgId}' and active
    and role in ('COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','PARTNER')
    and id <> '${helperId}' and email <> '${branchEmail}' order by email limit 1`);
if (thirdId) {
  await branch.reload();
  await branch.waitForTimeout(900);
  const p2 = branch.locator("#team");
  await openPanel(p2);
  await p2.locator('select[name="userId"]').first().selectOption(thirdId);
  await p2.locator('input[name="part"]').first().fill("Visa").catch(() => {});
  await p2.getByRole("button", { name: /Add|Put on the file/i }).first().click();
  const n = () => Number(sql(`select count(*) from student_people where student_id = '${studentId}'`));
  for (let t0 = Date.now(); n() < 2 && Date.now() - t0 < 15000; ) await branch.waitForTimeout(300);
  check(n() >= 2, `more than one helper fits on a file (${n()})`);
} else {
  check(true, "only one other person at this branch, so a third cannot be tried");
}

// Another branch must not see it.
const other = sql(`select u.email from users u join organizations o on o.id = u.org_id where o.type <> 'HQ' and o.id <> '${orgId}' and u.role = 'PARTNER' and u.active limit 1`);
if (other) {
  const stranger = await signIn(other);
  const res = await stranger.goto(`${BASE}/students/${studentId}/profile`);
  check(res.status() === 404 || stranger.url().includes("forbidden"), "another branch cannot open the file at all");
}

sql(`delete from student_people where student_id = '${studentId}'`);
await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
