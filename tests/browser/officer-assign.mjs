// Putting an application on an officer's desk.
//
// The officer field used to fill itself in with whoever first moved the file,
// so nobody was ever given one: an application sat in the shared unassigned
// pile until somebody happened to pick it up, and the application team leader,
// whose whole job is deciding who carries what, had no control to do it with.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 80;
const signIn = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": `10.249.4.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 });
  return page;
};

const leadEmail = sql("select email from users where role = 'APPLICATION_TEAM_LEADER' and active limit 1");
// The named desk account rather than one of the generated demo officers,
// which are seeded without the demo password and cannot sign in.
const officerEmail = sql("select email from users where role = 'DOCUMENTATION' and active and email not like 'docs.person%' order by email limit 1");
const officerId = sql(`select id from users where email = '${officerEmail}'`);
const officerName = sql(`select coalesce(desk_label, name) from users where id = '${officerId}'`);
if (!leadEmail || !officerId) {
  console.log("  ok  no desk roles seeded, nothing to check");
  await browser.close();
  process.exit(0);
}

// An open degree application, which is the pathway the queue opens on.
const appId = sql(`
  select a.id from applications a join status_definitions sd on sd.id = a.status_id
  where sd.pathway = 'DEGREE' and sd.group <> 'CLOSED' order by a.status_changed_at limit 1`);
const ackNo = sql(`select ack_no from applications where id = '${appId}'`);
sql(`update applications set officer_id = null where id = '${appId}'`);

const lead = await signIn(leadEmail);
await lead.goto(`${BASE}/admin/queue?officer=all`);
await lead.waitForTimeout(1200);

const picker = lead.locator(`form:has(input[value="${appId}"]) select[name="officerId"]`).first();
const offered = (await picker.count()) > 0;
check(offered, `the team leader is given a control to hand ${ackNo} to somebody`);
if (!offered) {
  check(false, "choosing an officer files it");
  check(false, "the officer is told");
  check(false, "and it is written to the audit log");
} else {
  check((await picker.locator(`option[value="${officerId}"]`).count()) > 0, `${officerName} is in the list`);
  // A branch counsellor is not: a file nobody at the office carries is not an
  // assignment, it is a file that has gone missing.
  const branchId = sql("select id from users where role = 'COUNSELLOR' and active limit 1");
  if (branchId) check((await picker.locator(`option[value="${branchId}"]`).count()) === 0, "a branch counsellor is not offered a desk file");
  const before = Number(sql(`select count(*) from notifications where user_id = '${officerId}'`));
  await picker.selectOption(officerId);
  const now = () => sql(`select coalesce(officer_id, '') from applications where id = '${appId}'`);
  for (let t0 = Date.now(); now() !== officerId && Date.now() - t0 < 15000; ) await lead.waitForTimeout(300);
  check(now() === officerId, "choosing an officer files it, with nothing else to press");
  check(Number(sql(`select count(*) from notifications where user_id = '${officerId}'`)) > before, "the officer is told it is on their desk");
  check(/application.officer/.test(sql(`select coalesce(string_agg(action, ','), '') from audit_logs where entity_id = '${appId}'`)), "and it is written to the audit log");
}

// An officer reads the same board and is shown who has it, not a control.
const officer = await signIn(officerEmail);
await officer.goto(`${BASE}/admin/queue?officer=all`);
await officer.waitForTimeout(1000);
check((await officer.locator('main select[name="officerId"]').count()) === 0, "an officer is shown who carries a file but cannot move it");
check((await officer.locator("main").innerText()).includes(officerName), "and can see their own name against the one they were given");

sql(`update applications set officer_id = null where id = '${appId}'`);
await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
