// Registering a candidate who came in as an enquiry hands the file to the desk.
//
// Registration used to close the enquiry and stop. The documentation team
// learned a student existed when an application turned up, which can be weeks
// later, and the document list did not exist until somebody opened the tab
// that builds it. So the papers every student needs whatever they apply for
// were chased late, or not at all.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));
const tag = String(Date.now()).slice(-6);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": "10.244.7.21" } });
await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();

const branchEmail = sql("select email from users where role = 'PARTNER' and active limit 1");
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', branchEmail);
await page.fill('input[name="password"]', "Password@123");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });

// An enquiry of this branch's own, which is what a walk-in looks like.
await page.goto(`${BASE}/enquiries/new`);
await page.waitForLoadState("domcontentloaded");
await page.fill('input[name="name"]', `Handover Test ${tag}`);
await page.fill('input[name="phone"]', `+91 73${tag}00`);
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

const enquiryId = sql(`select id from enquiries where name = 'Handover Test ${tag}'`);
check(!!enquiryId, "the enquiry was taken");
if (!enquiryId) {
  await browser.close();
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}

// The enquiry is with one of the branch's counsellors, as a walk-in a
// counsellor has been ringing would be. Converting it must leave the student
// with that counsellor, or the enquiry links them to a file they cannot open.
const branchOrg = sql(`select org_id from users where email = '${branchEmail}'`);
const counsellorId = sql(`select id from users where org_id = '${branchOrg}' and role in ('COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR') and active order by created_at limit 1`);
if (counsellorId) sql(`update enquiries set assigned_to_id = '${counsellorId}' where id = '${enquiryId}'`);

const deskBefore = Number(sql(`
  select count(*) from notifications n join users u on u.id = n.user_id
  where u.role in ('DOCUMENTATION','APPLICATION_TEAM_LEADER')`));

// Register them from the enquiry, which is the path the handover hangs off.
await page.goto(`${BASE}/students/new?enquiryId=${enquiryId}`);
await page.waitForLoadState("domcontentloaded");
await page.fill('input[name="firstName"]', "Handover");
await page.fill('input[name="lastName"]', `Test${tag}`);
await page.fill('input[name="phone"]', `+91 73${tag}00`);
await page.fill('input[name="email"]', `handover${tag}@example.com`);
const consent = page.locator('input[name="consent"]');
if (await consent.count()) await consent.first().check();
await page.click('button[type="submit"]');
await page.waitForURL(/\/students\/[^/]+\/profile/, { timeout: 25000 }).catch(() => {});

const studentId = sql(`select coalesce(student_id, '') from enquiries where id = '${enquiryId}'`);
check(!!studentId, "the enquiry converted into a student");
check(sql(`select stage from enquiries where id = '${enquiryId}'`) === "CONVERTED", "and is closed as converted");
if (counsellorId) {
  check(
    sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`) === counsellorId,
    "the student stays with the counsellor the enquiry was with, though the branch head registered them",
  );
} else {
  console.log("  skip  no counsellor at the branch to hold the enquiry, so the owner check did not run");
}

// 1. The list exists from day one, rather than when somebody opens the tab.
const items = Number(sql(`select count(*) from checklist_items where student_id = '${studentId}'`));
check(items > 0, `the document list is open already (${items} items)`);
check(
  Number(sql(`select count(*) from checklist_items where student_id = '${studentId}' and stage = 'PROFILE'`)) > 0,
  "including the papers asked of everybody at the profile stage",
);

// 2. Somebody at the desk is on the file, beside the branch, not instead of it.
const onFile = sql(`
  select coalesce(u.desk_label, u.name) || '|' || u.role from student_people p
  join users u on u.id = p.user_id where p.student_id = '${studentId}' and p.part = 'Documents'`);
check(!!onFile, `a desk person is on the file (${onFile || "nobody"})`);
if (onFile) check(/DOCUMENTATION|APPLICATION_TEAM_LEADER/.test(onFile), "and they work the desk");
check(
  sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`) !== (onFile ? sql(`select p.user_id from student_people p where p.student_id = '${studentId}' and p.part = 'Documents'`) : "x"),
  "the branch still has the student: this is the desk beside them, not instead of them",
);

// 3. The desk hears about it.
const deskAfter = Number(sql(`
  select count(*) from notifications n join users u on u.id = n.user_id
  where u.role in ('DOCUMENTATION','APPLICATION_TEAM_LEADER')`));
check(deskAfter > deskBefore, `the desk is told (${deskAfter - deskBefore} notifications)`);
check(/student.handover/.test(sql(`select coalesce(string_agg(action, ','), '') from audit_logs where entity_id = '${studentId}'`)), "and the handover is in the audit log");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
