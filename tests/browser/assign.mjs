// Admins handing a student to the documentation team.
//
// Written after the student list showed the assignment control to branches
// only: an admin had no way to say "this file goes to documentation", which is
// exactly the hand-off the portal exists for.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 40;
const signIn = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.253.2.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  return page;
};

const adminEmail = sql("select email from users where role = 'SUPER_ADMIN' and active limit 1");
// The named desk account rather than one of the generated demo officers,
// which are seeded without the demo password and cannot sign in.
const docEmail = sql("select email from users where role = 'DOCUMENTATION' and active and email not like 'docs.person%' order by email limit 1");
const docId = sql(`select id from users where email = '${docEmail}'`);
const docName = sql(`select coalesce(desk_label, name) from users where id = '${docId}'`);
// A branch student nobody has handed anywhere, so the assignment is the change.
const studentId = sql("select s.id from students s join organizations o on o.id = s.org_id where o.type <> 'HQ' and not s.archived order by s.created_at desc limit 1");
const studentName = sql(`select first_name || ' ' || last_name from students where id = '${studentId}'`);
sql(`update students set assigned_to_id = null where id = '${studentId}'`);

const admin = await signIn(adminEmail);
await admin.goto(`${BASE}/students`);
check((await admin.locator('th:text-is("Assigned to")').count()) > 0, "an admin is shown the assignment column");

const row = admin.locator("tr", { has: admin.locator(`a[href="/students/${studentId}/profile"]`) });
const picker = row.locator('select[name="assignedToId"]');
check((await picker.count()) > 0, "the student's row has a picker");
check((await row.locator('optgroup[label="Head office"]').count()) > 0, "the head office is offered");
check((await picker.locator(`option[value="${docId}"]`).count()) > 0, `documentation (${docName}) is in the list`);

// Picking a name is the whole move: there is no Save button beside it any
// more, and a branch reassigning a morning's intake was clicking one per row.
//
// The button is rendered by the server and taken away once the script runs,
// so that a browser which never runs it still has something to press. Asking
// before that has happened is asking too early, and reading it as a failure
// made this check fail about one run in three.
const saveButton = row.locator('form:has(select[name="assignedToId"]) button');
for (let t0 = Date.now(); (await saveButton.count()) > 0 && Date.now() - t0 < 10000; ) await admin.waitForTimeout(200);
check((await saveButton.count()) === 0, "and no second click to confirm it");
await picker.selectOption(docId);
// Poll rather than sleep: the row files the change itself, and how long that
// takes is the server's business.
const assigned = () => sql(`select coalesce(assigned_to_id, '') from students where id = '${studentId}'`);
for (let t0 = Date.now(); assigned() !== docId && Date.now() - t0 < 15000; ) await admin.waitForTimeout(300);
check(assigned() === docId, "choosing a name files it, with nothing else to press");
// Same again: the word arrives when the server answers, not when the
// database row changes, and those are not the same instant.
for (let t0 = Date.now(); !(await row.innerText()).includes("Saved") && Date.now() - t0 < 10000; ) await admin.waitForTimeout(200);
check((await row.innerText()).includes("Saved"), "and the row says so");
check(/student.reassign/.test(sql(`select coalesce(string_agg(action, ','), '') from audit_logs where entity_id = '${studentId}'`)), "it is written to the audit log");

// The point of assigning: that person can now open the file.
const doc = await signIn(docEmail);
const res = await doc.goto(`${BASE}/students/${studentId}/profile`);
check(res.status() === 200 && !doc.url().includes("forbidden"), "the documentation user can open the student");
check((await doc.locator("body").innerText()).includes(studentName.split(" ")[0]), "and sees their name on it");

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
