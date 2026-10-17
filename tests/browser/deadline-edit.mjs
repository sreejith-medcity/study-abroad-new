// Correcting a deadline from the list it is read on.
//
// Deadlines were admin-only. The one person who watches them all day, the
// application team leader, could not change a date at all: an institution
// moving one by a week meant going to an admin, which is how a date gets
// recorded late or not at all. Both lists can now be corrected in place by
// whoever is allowed to.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (cond, m) => (cond ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run"] });
let ip = 60;
const signIn = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.251.9.${ip++}` } });
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
const partnerEmail = sql("select email from users where role = 'PARTNER' and active limit 1");
if (!leadEmail) {
  console.log("  ok  no application team leader seeded, nothing to check");
  await browser.close();
  process.exit(0);
}

// A live institution deadline inside the window the page opens on. The
// seeded catalogue usually has none that near, and a check that quietly does
// not run is worse than no check, so one is put there and taken away after.
const find = () => sql(`
  select d.id || '|' || d.deadline || '|' || d.intake_year || '|' || d.intake_month
  from program_deadlines d join programs p on p.id = d.program_id
  where p.status = 'LIVE' and d.deadline > current_date and d.deadline <= current_date + 60
  order by d.deadline limit 1`);
let planted = null;
if (!find()) {
  const programId = sql("select id from programs where status = 'LIVE' order by created_at limit 1");
  const by = sql(`select id from users where email = '${leadEmail}'`);
  if (programId) {
    planted = "dltest" + String(Date.now()).slice(-10);
    // Far enough into next year that moving it a day either way stays inside
    // its own intake, and inside the 60 day window the page opens on.
    sql(`insert into program_deadlines (id, program_id, intake_year, intake_month, deadline, note, created_by_id)
         values ('${planted}', '${programId}', extract(year from current_date + 200)::int, extract(month from current_date + 200)::int,
                 (current_date + 30)::date, 'Planted by deadline-edit.mjs', '${by}')`);
  }
}
const row = find();

const lead = await signIn(leadEmail);
await lead.goto(`${BASE}/deadlines`);
await lead.waitForTimeout(800);

if (row) {
  const [id, was, year, month] = row.split("|");
  const field = lead.locator(`form:has(input[value="${id}"]) input[type="date"]`).first();
  const offered = (await field.count()) > 0;
  check(offered, "the team leader is given the date to correct");
  // Without the control there is nothing to drive, and the rest of this
  // block would hang on a locator that will never resolve rather than say so.
  if (!offered) {
    check(false, "the correction files itself");
    check(false, "and is written to the audit log");
    check(false, "a date past its own intake is refused rather than stored");
  } else {
    // One day earlier, which is always inside the intake it belongs to.
    const to = new Date(`${was}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() - 1);
    const next = to.toISOString().slice(0, 10);
    await field.fill(next);
    await field.blur();
    const now = () => sql(`select deadline from program_deadlines where id = '${id}'`);
    for (let t0 = Date.now(); now() !== next && Date.now() - t0 < 15000; ) await lead.waitForTimeout(300);
    check(now() === next, `the correction files itself (${was} to ${next})`);
    check(/program.deadline/.test(sql(`select coalesce(string_agg(action, ','), '') from audit_logs where entity_id = (select program_id from program_deadlines where id = '${id}')`)), "and is written to the audit log");
    // A date past the intake it belongs to is a typo in the year, and is refused.
    const silly = `${Number(year) + 1}-${String(month).padStart(2, "0")}-15`;
    await field.fill(silly);
    await field.blur();
    await lead.waitForTimeout(2000);
    check(now() === next, "a date past its own intake is refused rather than stored");
    sql(`update program_deadlines set deadline = '${was}' where id = '${id}'`);
  }
} else {
  check(false, "no institution deadline to correct, and none could be put there");
}
if (planted) sql(`delete from program_deadlines where id = '${planted}'`);

// A branch reads the same list and is given no control on it.
const partner = await signIn(partnerEmail);
await partner.goto(`${BASE}/deadlines`);
await partner.waitForTimeout(800);
check((await partner.locator('main input[type="date"]').count()) === 0, "a branch is shown the dates but cannot change them");

// The application milestones: the branch is working to these, so moving one
// has to tell them.
const appRow = sql(`
  select d.id || '|' || d.due_on
  from application_deadlines d
  where d.done_at is null and d.due_on <= current_date + 60
  order by d.due_on limit 1`);
if (appRow) {
  const [id, was] = appRow.split("|");
  await lead.goto(`${BASE}/deadlines?tab=applications`);
  await lead.waitForTimeout(800);
  const field = lead.locator(`form:has(input[value="${id}"]) input[type="date"]`).first();
  const movable = (await field.count()) > 0;
  check(movable, "and the milestone on an application too");
  if (!movable) {
    check(false, "the milestone moves");
    check(false, "and the branch working to it is told");
  } else {
    const to = new Date(`${was}T00:00:00Z`);
    to.setUTCDate(to.getUTCDate() + 3);
    const next = to.toISOString().slice(0, 10);
    const before = Number(sql("select count(*) from notifications"));
    await field.fill(next);
    await field.blur();
    const now = () => sql(`select due_on from application_deadlines where id = '${id}'`);
    for (let t0 = Date.now(); now() !== next && Date.now() - t0 < 15000; ) await lead.waitForTimeout(300);
    check(now() === next, `the milestone moves (${was} to ${next})`);
    check(Number(sql("select count(*) from notifications")) > before, "and the branch working to it is told");
    sql(`update application_deadlines set due_on = '${was}' where id = '${id}'`);
  }
} else {
  check(true, "no open application milestone to move");
}

await browser.close();
console.log(fails.length === 0 ? "\nall good" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
