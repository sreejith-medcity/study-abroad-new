// The daily journal: what each of Medcity's own people did that day, issued
// at the end of the day to view and verify, with a consolidated report to the
// Overseas admin that shows who verified, who flagged a problem, who missed it
// and who signed in after hours.
//
// The clock is set in platform settings for the run, relative to now, so the
// suite can stand in each part of the day without waiting for 5 PM.
// Wants the plain seed.
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

/** India time, minutes from now, as "HH:MM". */
const ist = (minutes) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + minutes * 60_000));
const minuteOfDay = (() => {
  const [h, m] = ist(0).split(":").map(Number);
  return h * 60 + m;
})();
// The day has to fit around now: twenty minutes back and an hour on.
if (minuteOfDay < 40 || minuteOfDay > 22 * 60 + 30) {
  console.log("SKIPPED: too close to midnight in India to stand inside one working day");
  process.exit(0);
}
const today = sql("select (now() at time zone 'Asia/Kolkata')::date::text");
const yesterday = sql("select ((now() at time zone 'Asia/Kolkata')::date - 1)::text");
const clock = (dayEnd, outOfHours, cutoff) =>
  sql(`insert into app_settings (id) values ('app') on conflict do nothing;
       update app_settings set journal_day_end = '${dayEnd}', journal_out_of_hours = '${outOfHours}', journal_cutoff = '${cutoff}', journal_on_sundays = true where id = 'app'`);
const idOf = (email) => sql(`select id from users where email = '${email}'`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 20;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.245.3.${ip++}` } });
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
  return { ctx, page, errors };
}
const go = async (page, path) => {
  await page.goto(`${BASE}${path}`);
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};
const standingOf = (page, id) => page.locator(`[data-person="${id}"]`).getAttribute("data-standing");

// Out of the box the day ends at 5 PM and the journal can be verified until
// 11:59 PM, India time.
check(
  sql("select string_agg(column_default, ' ' order by column_name) from information_schema.columns where table_name = 'app_settings' and column_name in ('journal_cutoff','journal_day_end','journal_out_of_hours')") ===
    "'23:59'::text '17:00'::text '17:45'::text",
  "the journal opens at 5 PM, counts sign-ins from 5:45 PM as after hours, and closes at 11:59 PM",
);

const staffCount = n(`select count(*) from users u join organizations o on o.id = u.org_id where u.active and o.type in ('HQ','BRANCH') and u.role not in ('SUPER_ADMIN','MANAGEMENT','STUDENT','PARENT')`);

/* ---------------- Before the day ends ---------------- */
clock(ist(30), ist(45), ist(90));
{
  const c = await open("uk.docs@medcity.test");
  const text = await go(c.page, "/journal");
  check(/The working day ends at/.test(text), "before the day ends, the journal says when it will be issued");
  check((await c.page.locator("[data-verify]").count()) === 0, "and cannot be verified yet");
  await go(c.page, "/dashboard");
  check((await c.page.locator("[data-journal-banner]").count()) === 0, "and no banner asks for it");
  check((await c.page.locator('nav[aria-label="Main"]').getByText("Daily journal", { exact: true }).count()) === 1, "the menu has the daily journal");
  await c.ctx.close();
}

/* ---------------- Yesterday closes at its cutoff, with everybody missed ---------------- */
{
  // Journals began yesterday, so yesterday is a day to close.
  sql(`insert into journal_days (day) values ('${yesterday}') on conflict do nothing`);
  const a = await open("admin@medcityoverseas.test");
  const text = await go(a.page, `/journal/report?day=${yesterday}`);
  check(/Closed\. Sent at/.test(text), "a past day is closed and its report sent");
  const missed = n(`select count(*) from daily_journals where day = '${yesterday}' and state = 'MISSED'`);
  check(missed === staffCount, `everybody who did not answer is written down as missed (${missed} of ${staffCount})`);
  check(n(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@medcityoverseas.test' and n.title like 'Daily journals:%missed%'`) === 1, "and the Overseas admin is sent the report, once");
  await go(a.page, `/journal/report?day=${yesterday}`);
  check(n(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@medcityoverseas.test' and n.title like 'Daily journals:%'`) === 1, "opening it again sends nothing more");
  check(a.errors.length === 0, `the report draws without an error ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}

/* ---------------- The day ends: journals are issued ---------------- */
// Day ended ten minutes ago; after hours begins in half an hour, so these
// sign-ins are inside hours.
clock(ist(-10), ist(30), ist(60));
const germany = idOf("germany@medcity.test");
const uk = idOf("uk.docs@medcity.test");
const trainee = idOf("trainee@medcity.test");
// Some of today's work, done by the counsellor.
const org = sql(`select org_id from users where id = '${uk}'`);
sql(`insert into students (id, org_id, created_by_id, assigned_to_id, portal_token, first_name, last_name, phone, created_at)
     values ('jr_s1', '${org}', '${uk}', '${uk}', 'jr_t1', 'Journal', 'Student', '9100000777', now() - interval '2 hours')`);
sql(`insert into tasks (id, org_id, student_id, title, due_on, assigned_to_id, created_by_id, done_at, done_by_id)
     values ('jr_k1', '${org}', 'jr_s1', 'Call about the visa', current_date, '${uk}', '${uk}', now() - interval '1 hour', '${uk}')`);
{
  const g = await open("germany@medcity.test");
  await go(g.page, "/dashboard");
  check((await g.page.locator("[data-journal-banner]").count()) === 1, "once the day has ended, a banner asks for the journal");
  const text = await go(g.page, "/journal");
  check(/Read every line below/.test(text), "the journal is open to verify");
  check(n(`select count(*) from notifications where user_id = '${germany}' and title = 'Your journal for today is ready'`) === 1, "and everybody was told it is ready, once");
  check(n(`select count(*) from daily_journals where user_id = '${germany}' and day = '${today}' and viewed_at is not null`) === 1, "opening it is noted");
  await g.page.locator("[data-verify]").click();
  await g.page.waitForFunction(() => !document.querySelector("[data-verify]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select state from daily_journals where user_id = '${germany}' and day = '${today}'`) === "VERIFIED", "verifying records it");
  await go(g.page, "/dashboard");
  check((await g.page.locator("[data-journal-banner]").count()) === 0, "and the banner goes");
  check(g.errors.length === 0, `no errors for the counsellor who verified ${g.errors.slice(0, 2).join(" | ")}`);
  await g.ctx.close();
}

/* ---------------- After hours ---------------- */
// After hours began five minutes ago: a sign-in now is out of hours. The
// counsellor above verified a couple of minutes after the day ended, which on
// this clock is still in hours.
clock(ist(-10), ist(-5), ist(60));
sql(`update daily_journals set decided_at = now() - interval '8 minutes' where user_id = '${germany}' and day = '${today}'`);
{
  const c = await open("uk.docs@medcity.test");
  const text = await go(c.page, "/journal");
  check(/Registered Journal Student/.test(text), "the journal lists the students they registered today");
  check(/Follow-up done: Call about the visa/.test(text), "and the follow-ups they did");
  check(/Signed in after hours/.test(text), "a sign-in after hours is marked on their journal");
  const lines = await c.page.locator("[data-journal-lines] > li").count();
  // Flagging needs a reason.
  await c.page.locator("summary", { hasText: "Something here is wrong" }).click();
  await c.page.locator("[data-flag]").click();
  await c.page.getByText("Say what is wrong").first().waitFor({ timeout: 10000 }).catch(() => {});
  check(sql(`select coalesce(state::text, '') from daily_journals where user_id = '${uk}' and day = '${today}'`) === "", "a flag with no reason is refused");
  await c.page.locator("[data-verify]").click();
  await c.page.waitForFunction(() => !document.querySelector("[data-verify]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select state from daily_journals where user_id = '${uk}' and day = '${today}'`) === "VERIFIED", "verifying after hours is still verifying");
  // What was verified is kept as it was.
  sql(`insert into students (id, org_id, created_by_id, portal_token, first_name, last_name, phone) values ('jr_s2', '${org}', '${uk}', 'jr_t2', 'Later', 'Student', '9100000778')`);
  await go(c.page, "/journal");
  check((await c.page.locator("[data-journal-lines] > li").count()) === lines, "a change made afterwards does not alter the verified journal");
  check(c.errors.length === 0, `no errors for the counsellor verifying after hours ${c.errors.slice(0, 2).join(" | ")}`);
  await c.ctx.close();
}
{
  const t = await open("trainee@medcity.test");
  await go(t.page, "/journal");
  await t.page.locator("summary", { hasText: "Something here is wrong" }).click();
  await t.page.locator("#journal-note").fill("The call at noon was Rohit's, not mine.");
  await t.page.locator("[data-flag]").click();
  await t.page.waitForFunction(() => !document.querySelector("[data-flag]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select state || '|' || note from daily_journals where user_id = '${trainee}' and day = '${today}'`) === "FLAGGED|The call at noon was Rohit's, not mine.", "a flag is kept with its reason");
  await t.ctx.close();
}

/* ---------------- The consolidated report, live ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, "/journal/report");
  check((await standingOf(a.page, germany)) === "VERIFIED", "the report shows who verified in hours");
  check((await standingOf(a.page, uk)) === "VERIFIED_LATE", "and who verified after hours");
  check((await standingOf(a.page, trainee)) === "FLAGGED", "and who flagged a problem, with what they wrote");
  check((await a.page.locator(`[data-person="${trainee}"]`).innerText()).includes("Rohit's"), "the reason is on the report");
  check((await a.page.locator(`[data-person="${uk}"]`).innerText()).includes("Signed in at"), "and when somebody signed in after hours");
  const pending = await a.page.locator('[data-standing="PENDING"]').count();
  check(pending === staffCount - 3, `everybody else is not yet verified (${pending})`);
  check((await a.page.locator("[data-person]").count()) === staffCount, `everybody issued a journal is on it (${staffCount})`);
  const sub = idOf("staff@horizon.test");
  check((await a.page.locator(`[data-person="${sub}"]`).count()) === 0, "a sub-agent's staff are not issued one");
  check((await a.page.locator(`[data-person="${idOf("sreejith@miak.in")}"]`).count()) === 0, "nor the super admin");
  // Reading somebody's journal from the report.
  await go(a.page, `/journal?user=${uk}`);
  check((await a.page.locator("[data-verify]").count()) === 0, "the admin can read a journal but never answer it");
  check(a.errors.length === 0, `no errors on the report ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}

/* ---------------- When the last person answers, the report goes at once ---------------- */
{
  // Everybody but the senior counsellor answers.
  const senior = idOf("senior@medcity.test");
  sql(`insert into daily_journals (id, user_id, day, state, decided_at, entries)
       select 'jr_' || u.id, u.id, '${today}', 'VERIFIED', now(), '[]'::jsonb
       from users u join organizations o on o.id = u.org_id
       where u.active and o.type in ('HQ','BRANCH') and u.role not in ('SUPER_ADMIN','MANAGEMENT','STUDENT','PARENT') and u.id <> '${senior}'
       on conflict (user_id, day) do nothing`);
  check(sql(`select coalesce(report_sent_at::text, '') from journal_days where day = '${today}'`) === "", "the report waits while somebody has not answered");
  const s = await open("senior@medcity.test");
  await go(s.page, "/journal");
  await s.page.locator("[data-verify]").click();
  await s.page.waitForFunction(() => !document.querySelector("[data-verify]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select report_reason from journal_days where day = '${today}'`) === "ALL_DONE", "the last answer sends the report straight away");
  check(n(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@medcityoverseas.test' and n.title = 'Every journal for today is verified'`) === 1, "and the Overseas admin is told every journal is in");
  await s.ctx.close();
}

/* ---------------- Who sees what ---------------- */
{
  const sub = await open("staff@horizon.test");
  const text = await go(sub.page, "/journal");
  check(/Journals are for Medcity's own staff/.test(text), "a sub-agent's staff are told journals are not theirs");
  check((await sub.page.locator('nav[aria-label="Main"]').getByText("Daily journal", { exact: true }).count()) === 0, "and have no journal in the menu");
  await sub.ctx.close();

  const m = await open("management@medcityoverseas.test");
  await go(m.page, "/journal/report");
  check((await m.page.locator("[data-journal-report]").count()) === 1, "management can read the report");
  await m.ctx.close();

  const c = await open("uk.docs@medcity.test");
  await c.page.goto(`${BASE}/journal/report`);
  await c.page.waitForLoadState("domcontentloaded");
  check(!c.page.url().includes("/journal/report"), "a counsellor cannot open the report");
  await c.ctx.close();

  const res = await fetch(`${BASE}/api/cron/journal`, { method: "POST" });
  check(res.status === 401, "the scheduler's endpoint refuses a call without the secret");
}

clock("17:00", "17:45", "23:59");
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
