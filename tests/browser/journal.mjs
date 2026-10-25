// The day end report: what each of Medcity's own people did that day, issued
// at the end of the day to view and verify, with the five figures a counsellor
// types (leads, calls, connected calls, follow-ups, registrations), and a
// consolidated report to the Overseas admin that shows who verified, who
// flagged a problem, who missed it, who signed in after hours, and the figures
// per counsellor with totals per branch and overall.
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
  "the day end report opens at 5 PM, counts sign-ins from 5:45 PM as after hours, and closes at 11:59 PM",
);

const staffCount = n(`select count(*) from users u join organizations o on o.id = u.org_id where u.active and o.type in ('HQ','BRANCH') and u.role not in ('SUPER_ADMIN','MANAGEMENT','STUDENT','PARENT')`);

/* ---------------- Before the day ends ---------------- */
clock(ist(30), ist(45), ist(90));
{
  const c = await open("uk.docs@medcity.test");
  const text = await go(c.page, "/journal");
  check(/The working day ends at/.test(text), "before the day ends, the report says when it will be issued");
  check((await c.page.locator("[data-verify]").count()) === 0, "and cannot be verified yet");
  await go(c.page, "/dashboard");
  check((await c.page.locator("[data-journal-popup], [data-journal-tab]").count()) === 0, "and nothing pops up asking for it");
  check((await c.page.locator('nav[aria-label="Main"]').getByText("Day end report", { exact: true }).count()) === 1, "the menu has the day end report");
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
  check(n(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@medcityoverseas.test' and n.title like 'Day end reports:%missed%'`) === 1, "and the Overseas admin is sent the report, once");
  await go(a.page, `/journal/report?day=${yesterday}`);
  check(n(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@medcityoverseas.test' and n.title like 'Day end reports:%'`) === 1, "opening it again sends nothing more");
  check(a.errors.length === 0, `the report draws without an error ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}

/* ---------------- The day ends: reports are issued ---------------- */
// Day ended ten minutes ago; after hours begins in half an hour, so these
// sign-ins are inside hours.
clock(ist(-10), ist(30), ist(60));
const germany = idOf("germany@medcity.test");
const uk = idOf("uk.docs@medcity.test");
const trainee = idOf("trainee@medcity.test");
// Some of today's work, done by the counsellor. "Two hours ago" is yesterday
// in India for a run just after midnight, so it is never earlier than today's
// first minute (the suite skips the first forty).
const earlier = (interval) => `greatest(now() - interval '${interval}', '${today} 00:01:00+05:30'::timestamptz)`;
const org = sql(`select org_id from users where id = '${uk}'`);
sql(`insert into students (id, org_id, created_by_id, assigned_to_id, portal_token, first_name, last_name, phone, created_at)
     values ('jr_s1', '${org}', '${uk}', '${uk}', 'jr_t1', 'Journal', 'Student', '9100000777', ${earlier("2 hours")})`);
sql(`insert into tasks (id, org_id, student_id, title, due_on, assigned_to_id, created_by_id, done_at, done_by_id)
     values ('jr_k1', '${org}', 'jr_s1', 'Call about the visa', '${today}', '${uk}', '${uk}', ${earlier("1 hour")}, '${uk}')`);
// Two calls and a WhatsApp logged by the counsellor: the calls box counts
// calls only, so it should open at 2, not 3.
sql(`insert into contact_log (id, org_id, student_id, channel, outcome, by_id, created_at)
     values ('jr_c1', '${org}', 'jr_s1', 'CALL', 'REACHED', '${uk}', ${earlier("90 minutes")}),
            ('jr_c2', '${org}', 'jr_s1', 'CALL', 'NO_ANSWER', '${uk}', ${earlier("80 minutes")}),
            ('jr_c3', '${org}', 'jr_s1', 'WHATSAPP', 'WILL_SEND', '${uk}', ${earlier("70 minutes")})`);
const figureValue = (page, scope, key) => page.locator(`${scope} [data-figure="${key}"]`).inputValue();
const fillFigures = async (page, scope, values) => {
  for (const [key, v] of Object.entries(values)) await page.locator(`${scope} [data-figure="${key}"]`).fill(String(v));
};
const storedFigures = (id) =>
  sql(`select coalesce(figures->>'leadsReceived', '-') || '|' || coalesce(figures->>'callsMade', '-') || '|' || coalesce(figures->>'connectedCalls', '-') || '|' || coalesce(figures->>'followUpsDone', '-') || '|' || coalesce(figures->>'registrationsDone', '-')
       from daily_journals where user_id = '${id}' and day = '${today}'`);
// What the portal should count for somebody today, worked out the same way the
// server does. The seed stamps its rows with the time it ran, so a run on the
// day of the seed finds more than the rows this suite adds.
const inToday = (col) => `${col} >= '${today} 00:00:00+05:30'::timestamptz and ${col} < '${today} 00:00:00+05:30'::timestamptz + interval '1 day'`;
const counted = (id) => ({
  calls: n(`select count(*) from contact_log where by_id = '${id}' and channel = 'CALL' and ${inToday("created_at")}`),
  followUps: n(`select count(*) from tasks where done_by_id = '${id}' and ${inToday("done_at")}`),
  registrations: n(`select count(*) from students where created_by_id = '${id}' and ${inToday("created_at")}`),
});
{
  const g = await open("germany@medcity.test");
  await go(g.page, "/dashboard");
  check((await g.page.locator("[data-journal-popup]").count()) === 1, "once the day has ended, the day end report pops up over the page");
  check((await g.page.locator('[data-journal-popup] [role="dialog"]').innerText()).includes("Your day end report for today"), "saying what it is");
  check((await g.page.locator("[data-journal-popup] [data-day-end-figures] [data-figure]").count()) === 5, "a counsellor has the five figure boxes in the popup");
  const gc = counted(germany);
  check((await figureValue(g.page, "[data-journal-popup]", "callsMade")) === String(gc.calls), `with the calls the portal counted for them (${gc.calls})`);
  check((await figureValue(g.page, "[data-journal-popup]", "leadsReceived")) === "", "and leads received left for them to type");
  const text = await go(g.page, "/journal");
  check(/Read every line below/.test(text), "the report page is open to verify");
  check((await g.page.locator("[data-journal-popup]").count()) === 0, "and does not pop up over itself");
  check(n(`select count(*) from notifications where user_id = '${germany}' and title = 'Your day end report for today is ready'`) === 1, "everybody was told it is ready, once");
  check(n(`select count(*) from daily_journals where user_id = '${germany}' and day = '${today}' and viewed_at is not null`) === 1, "opening it is noted");

  // Minimised, it becomes a tab in the corner, and stays minimised from page to page.
  await go(g.page, "/dashboard");
  await g.page.locator("[data-journal-minimise]").click();
  check((await g.page.locator("[data-journal-popup]").count()) === 0 && (await g.page.locator("[data-journal-tab]").count()) === 1, "it can be minimised to a tab");
  await go(g.page, "/students");
  check((await g.page.locator("[data-journal-popup]").count()) === 0 && (await g.page.locator("[data-journal-tab]").count()) === 1, "and stays minimised on the next page");
  await g.page.locator("[data-journal-tab]").click();
  check((await g.page.locator("[data-journal-popup]").count()) === 1, "the tab opens it again");
  await g.page.keyboard.press("Escape");
  check((await g.page.locator("[data-journal-tab]").count()) === 1, "Escape minimises it too");
  await g.page.locator("[data-journal-tab]").click();

  // Answered straight from the popup, figures and all.
  await fillFigures(g.page, "[data-journal-popup]", { leadsReceived: 0, connectedCalls: 0 });
  await g.page.locator("[data-journal-popup] [data-verify]").click();
  await g.page.waitForFunction(() => !document.querySelector("[data-journal-popup]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select state from daily_journals where user_id = '${germany}' and day = '${today}'`) === "VERIFIED", "verifying from the popup records it");
  check(storedFigures(germany) === `0|${gc.calls}|0|${gc.followUps}|${gc.registrations}`, `and keeps the figures given in the popup (${storedFigures(germany)})`);
  await go(g.page, "/dashboard");
  check((await g.page.locator("[data-journal-popup], [data-journal-tab]").count()) === 0, "and once answered it is gone for the day");
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
  check(/Registered Journal Student/.test(text), "the report lists the students they registered today");
  check(/Follow-up done: Call about the visa/.test(text), "and the follow-ups they did");
  check(/Signed in after hours/.test(text), "a sign-in after hours is marked on their report");
  const lines = await c.page.locator("[data-journal-lines] > li").count();
  // The figure boxes open with what the portal counted for the day.
  check((await c.page.locator("[data-day-end-figures] [data-figure]").count()) === 5, "a counsellor sees the five figure boxes");
  const uc = counted(uk);
  check(uc.calls >= 2 && uc.followUps >= 1 && uc.registrations >= 1, `the seeded work is there to count (${uc.calls} calls, ${uc.followUps} follow-ups, ${uc.registrations} registrations)`);
  check((await figureValue(c.page, "main", "callsMade")) === String(uc.calls), `calls made is pre-filled from the calls they logged, not the WhatsApp (${await figureValue(c.page, "main", "callsMade")})`);
  check((await figureValue(c.page, "main", "followUpsDone")) === String(uc.followUps), "follow-ups done from the tasks they completed");
  check((await figureValue(c.page, "main", "registrationsDone")) === String(uc.registrations), "registrations done from the students they registered");
  check((await figureValue(c.page, "main", "leadsReceived")) === "" && (await figureValue(c.page, "main", "connectedCalls")) === "", "leads received and connected calls start empty");
  // Flagging needs a reason.
  await c.page.locator("summary", { hasText: "Something here is wrong" }).click();
  await c.page.locator("[data-flag]").click();
  await c.page.getByText("Say what is wrong").first().waitFor({ timeout: 10000 }).catch(() => {});
  check(sql(`select coalesce(state::text, '') from daily_journals where user_id = '${uk}' and day = '${today}'`) === "", "a flag with no reason is refused");
  // Verifying needs every figure.
  await c.page.locator("[data-verify]").click();
  await c.page.locator('[data-figure-box="leadsReceived"]', { hasText: "whole number" }).waitFor({ timeout: 10000 }).catch(() => {});
  check((await c.page.locator('[data-figure-box="leadsReceived"]').innerText()).includes("Give a whole number"), "verifying with leads received blank is refused, with the message under that box");
  check((await c.page.locator('[data-figure-box="callsMade"]').innerText()).includes("whole number") === false, "and the filled boxes are not complained about");
  check(sql(`select coalesce(state::text, '') from daily_journals where user_id = '${uk}' and day = '${today}'`) === "", "so nothing is recorded yet");
  check((await figureValue(c.page, "main", "callsMade")) === String(uc.calls), "and what was in the boxes is still there");
  // Calls happen outside the portal too, so the counted figure is changed by hand.
  await fillFigures(c.page, "main", { leadsReceived: 4, callsMade: uc.calls + 3, connectedCalls: 2 });
  await c.page.locator("[data-verify]").click();
  await c.page.waitForFunction(() => !document.querySelector("[data-verify]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select state from daily_journals where user_id = '${uk}' and day = '${today}'`) === "VERIFIED", "verifying after hours is still verifying");
  check(storedFigures(uk) === `4|${uc.calls + 3}|2|${uc.followUps}|${uc.registrations}`, `the figures are stored with the answer, the edited calls figure included (${storedFigures(uk)})`);
  // What was verified is kept as it was.
  sql(`insert into students (id, org_id, created_by_id, portal_token, first_name, last_name, phone) values ('jr_s2', '${org}', '${uk}', 'jr_t2', 'Later', 'Student', '9100000778')`);
  await go(c.page, "/journal");
  check((await c.page.locator("[data-journal-lines] > li").count()) === lines, "a change made afterwards does not alter the verified report");
  check((await c.page.locator('[data-figure-given="leadsReceived"]').innerText()).trim() === "4", "the figures given are shown on the answered report");
  check((await c.page.locator("[data-figure]").count()) === 0, "and the boxes are gone once answered");
  check(c.errors.length === 0, `no errors for the counsellor verifying after hours ${c.errors.slice(0, 2).join(" | ")}`);
  await c.ctx.close();
}
{
  const t = await open("trainee@medcity.test");
  await go(t.page, "/journal");
  await t.page.locator("summary", { hasText: "Something here is wrong" }).click();
  await t.page.locator("#journal-note").fill("The call at noon was Rohit's, not mine.");
  // A flag needs the figures as much as a verify does.
  await t.page.locator("[data-flag]").click();
  await t.page.locator('[data-figure-box="connectedCalls"]', { hasText: "whole number" }).waitFor({ timeout: 10000 }).catch(() => {});
  check(sql(`select coalesce(state::text, '') from daily_journals where user_id = '${trainee}' and day = '${today}'`) === "", "a flag with a reason but blank figures is refused");
  await fillFigures(t.page, "main", { leadsReceived: 2, connectedCalls: 1 });
  await t.page.locator("[data-flag]").click();
  await t.page.waitForFunction(() => !document.querySelector("[data-flag]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select state || '|' || note from daily_journals where user_id = '${trainee}' and day = '${today}'`) === "FLAGGED|The call at noon was Rohit's, not mine.", "a flag is kept with its reason");
  const tc = counted(trainee);
  check(storedFigures(trainee) === `2|${tc.calls}|1|${tc.followUps}|${tc.registrations}`, `and with the figures (${storedFigures(trainee)})`);
  await t.ctx.close();
}
{
  // The documentation team is issued a report but not asked for figures.
  const d = await open("documentation@medcityoverseas.test");
  await go(d.page, "/journal");
  check((await d.page.locator("[data-verify]").count()) === 1, "a documentation officer has a report to verify");
  check((await d.page.locator("[data-day-end-figures], [data-figure]").count()) === 0, "and no figure boxes");
  await go(d.page, "/dashboard");
  check((await d.page.locator("[data-journal-popup] [data-figure]").count()) === 0, "nor in the popup");
  await d.ctx.close();
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
  // The figures, per counsellor, with totals.
  const col = async (row, key) => (await a.page.locator(`${row} [data-col="${key}"]`).innerText()).trim();
  check((await a.page.locator("[data-day-end-figures-report]").count()) === 1, "the report has the day's figures");
  check((await col(`[data-figures-row="${uk}"]`, "leadsReceived")) === "4" && (await col(`[data-figures-row="${uk}"]`, "callsMade")) === sql(`select figures->>'callsMade' from daily_journals where user_id = '${uk}' and day = '${today}'`), "with what each counsellor gave");
  check((await col(`[data-figures-row="${trainee}"]`, "connectedCalls")) === "1", "a flagged report's figures included");
  const senior = idOf("senior@medcity.test");
  check((await a.page.locator(`[data-figures-row="${senior}"]`).innerText()).includes("Not given"), "and Not given for a counsellor who has not answered");
  check((await a.page.locator(`[data-figures-row="${idOf("documentation@medcityoverseas.test")}"]`).count()) === 0, "a documentation officer has no figures row");
  // Kottayam so far: the counsellor gave 4 leads and 2 connected calls, the
  // Germany counsellor 0 and 0, the trainee 2 and 1; nobody else has answered.
  check((await col(`[data-figures-branch="${org}"]`, "leadsReceived")) === "6" && (await col(`[data-figures-branch="${org}"]`, "connectedCalls")) === "3", "a branch total adds up its counsellors");
  const summed = n(`select coalesce(sum((figures->>'callsMade')::int), 0) from daily_journals where day = '${today}' and figures is not null`);
  check((await col("[data-figures-total]", "leadsReceived")) === "6" && (await col("[data-figures-total]", "callsMade")) === String(summed), "and the overall total adds up every branch");
  const pending = await a.page.locator('[data-standing="PENDING"]').count();
  check(pending === staffCount - 3, `everybody else is not yet verified (${pending})`);
  check((await a.page.locator("[data-person]").count()) === staffCount, `everybody issued a day end report is on it (${staffCount})`);
  const sub = idOf("staff@horizon.test");
  check((await a.page.locator(`[data-person="${sub}"]`).count()) === 0, "a sub-agent's staff are not issued one");
  check((await a.page.locator(`[data-person="${idOf("sreejith@miak.in")}"]`).count()) === 0, "nor the super admin");
  // Reading somebody's journal from the report.
  await go(a.page, `/journal?user=${uk}`);
  check((await a.page.locator("[data-verify]").count()) === 0, "the admin can read a report but never answer it");
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
       on conflict (user_id, day) do update set state = 'VERIFIED', decided_at = now() where daily_journals.state is null`);
  check(sql(`select coalesce(report_sent_at::text, '') from journal_days where day = '${today}'`) === "", "the report waits while somebody has not answered");
  const s = await open("senior@medcity.test");
  await go(s.page, "/journal");
  await fillFigures(s.page, "main", { leadsReceived: 1, connectedCalls: 1 });
  await s.page.locator("[data-verify]").click();
  await s.page.waitForFunction(() => !document.querySelector("[data-verify]"), null, { timeout: 15000 }).catch(() => {});
  check(sql(`select report_reason from journal_days where day = '${today}'`) === "ALL_DONE", "the last answer sends the report straight away");
  check(n(`select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'admin@medcityoverseas.test' and n.title = 'Every day end report for today is verified'`) === 1, "and the Overseas admin is told every report is in");
  // Yesterday is the history view: closed, everybody missed, so no figures.
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, `/journal/report?day=${yesterday}`);
  check((await a.page.locator("[data-day-end-figures-report]").count()) === 1 && (await a.page.locator(`[data-figures-row="${senior}"]`).innerText()).includes("Not given"), "a past day's report shows its figures too, Not given where nobody answered");
  await a.ctx.close();
  await s.ctx.close();
}

/* ---------------- Who sees what ---------------- */
{
  const sub = await open("staff@horizon.test");
  const text = await go(sub.page, "/journal");
  check(/Day end reports are for Medcity's own staff/.test(text), "a sub-agent's staff are told day end reports are not theirs");
  check((await sub.page.locator('nav[aria-label="Main"]').getByText("Day end report", { exact: true }).count()) === 0, "and have no day end report in the menu");
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
