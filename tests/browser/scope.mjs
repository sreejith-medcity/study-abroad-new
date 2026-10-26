// Whose students somebody sees, on the screens that are not the students list.
//
// A counsellor at Medcity Kottayam opened Students by stage and saw all of
// the branch's students, other counsellors' included, while her dashboard
// said ten. The board, the search palette, the application deadlines and the
// placement tracker now ask the same question the students list asks, and so
// do the pickers that offer a student by name: the student picker API, the
// finder, the search screen, a program's "check a student", events, program
// option requests, the practice interview, a colleague's day and the
// applications export. A branch head and the desk still see everybody.
// Wants the plain seed; adds its own students and takes them away again.
import { chromium } from "playwright";
import { knownWarning, hydrated } from "./_errors.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-qAtc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const check = (c, m) => (c ? console.log("  ok  " + m) : (console.log("FAIL  " + m), fails.push(m)));

const kottayam = sql("select org_id from users where email = 'kottayam@medcity.test'");
const germany = sql("select id from users where email = 'germany@medcity.test'");
const senior = sql("select id from users where email = 'senior@medcity.test'");
const program = sql("select id from programs where status = 'LIVE' and pathway = 'DEGREE' order by name limit 1");
const status = sql(`select id from status_definitions where pathway = 'DEGREE' and "group" = 'IN_PROGRESS' and active order by sort_order limit 1`);

/* ---------------- Three students at Kottayam ---------------- */
// One assigned to the senior counsellor, one to the counsellor under test,
// one given to nobody. The senior's student has an application with a
// deadline next week, which is what the deadlines tab lists.
const cleanup = () => {
  sql("delete from event_registrations where event_id = 'sc_event'");
  sql("delete from events where id = 'sc_event'");
  sql("delete from interview_sessions where id = 'sc_session'");
  sql("delete from tasks where id in ('sc_task_other', 'sc_task_mine')");
  sql("delete from application_deadlines where application_id in ('sc_app_other', 'sc_app_mine')");
  sql("delete from applications where id in ('sc_app_other', 'sc_app_mine')");
  sql("delete from students where id in ('sc_other', 'sc_mine', 'sc_free')");
};
cleanup();
sql(`insert into students (id, org_id, created_by_id, assigned_to_id, portal_token, first_name, last_name, phone)
     values ('sc_other', '${kottayam}', '${senior}', '${senior}', 'sc_t_other', 'Scopecheck', 'Elsewhere', '9100000791'),
            ('sc_mine', '${kottayam}', '${senior}', '${germany}', 'sc_t_mine', 'Scopecheck', 'Mine', '9100000792'),
            ('sc_free', '${kottayam}', '${senior}', null, 'sc_t_free', 'Scopecheck', 'Nobody', '9100000793')`);
sql(`insert into applications (id, ack_no, student_id, program_id, org_id, intake_month, intake_year, status_id, created_by_id)
     values ('sc_app_other', 'SCOPE-OTHER-1', 'sc_other', '${program}', '${kottayam}', 9, 2027, '${status}', '${senior}'),
            ('sc_app_mine', 'SCOPE-MINE-1', 'sc_mine', '${program}', '${kottayam}', 9, 2027, '${status}', '${senior}')`);
sql(`insert into application_deadlines (id, application_id, type, due_on, created_by_id)
     values ('sc_dl_other', 'sc_app_other', 'PAYMENT', current_date + 7, '${senior}'),
            ('sc_dl_mine', 'sc_app_mine', 'PAYMENT', current_date + 7, '${senior}')`);
// A webinar open to students, with the senior's student and the counsellor's
// own both registered by the senior; the events page lists registrations and
// offers the rest of the students to register.
sql(`insert into events (id, title, kind, starts_at, open_to_students, published, created_by_id)
     values ('sc_event', 'Scopecheck webinar', 'WEBINAR', now() + interval '2 days', true, true, '${senior}')`);
sql(`insert into event_registrations (id, event_id, user_id, student_id)
     values ('sc_reg_other', 'sc_event', '${senior}', 'sc_other'),
            ('sc_reg_mine', 'sc_event', '${senior}', 'sc_mine')`);
// A past practice interview the senior ran for their own student.
sql(`insert into interview_sessions (id, org_id, student_id, kind, context, transcript, feedback, created_by_id)
     values ('sc_session', '${kottayam}', 'sc_other', 'visa', 'Scopecheck practice', '[]'::jsonb, 'Scopecheck feedback', '${senior}')`);
// Two tasks on the senior's desk, one about each student, for the day view.
sql(`insert into tasks (id, org_id, student_id, title, due_on, assigned_to_id, created_by_id)
     values ('sc_task_other', '${kottayam}', 'sc_other', 'Scopecheck task elsewhere', current_date, '${senior}', '${senior}'),
            ('sc_task_mine', '${kottayam}', 'sc_mine', 'Scopecheck task mine', current_date, '${senior}', '${senior}')`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 60;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.248.5.${ip++}` } });
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
};
const card = (page, id) => page.locator(`[data-board-card="${id}"]`).count();
const assignees = async (page) => page.locator("[data-board-card]").evaluateAll((els) => els.map((el) => el.getAttribute("data-assigned-to")));
const palette = async (page, q) => (await (await page.request.get(`${BASE}/api/palette?q=${encodeURIComponent(q)}`)).json()).hits;
const deadlinesText = async (page) => {
  await go(page, "/deadlines?tab=applications&days=30");
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};
const pageText = async (page, path) => {
  await go(page, path);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};
const pick = async (page, q) => (await (await page.request.get(`${BASE}/api/pick/students?q=${encodeURIComponent(q)}`)).json()).options.map((o) => o.label);
const options = async (page, selector) => page.locator(`${selector} option`).evaluateAll((els) => els.map((el) => el.value));
const exportText = async (page) => (await page.request.get(`${BASE}/api/applications/export?ack=SCOPE-`)).text();

/* ---------------- A counsellor sees their own and the unassigned ---------------- */
{
  const c = await open("germany@medcity.test");
  await go(c.page, "/students/board");
  check((await card(c.page, "sc_mine")) === 1, "the counsellor's board shows a student assigned to them");
  check((await card(c.page, "sc_free")) === 1, "and a student of the branch nobody has been given");
  check((await card(c.page, "sc_other")) === 0, "and not a student assigned to another counsellor");
  const who = await assignees(c.page);
  check(who.length > 0 && !who.includes(senior), `no card on the board is another counsellor's (${who.length} cards)`);
  check((await c.page.locator('select[name="who"]').count()) === 0, "the counsellor picker is not offered: nobody's students but their own");

  await go(c.page, `/students/board?who=${senior}`);
  check((await card(c.page, "sc_other")) === 0, "asking for another counsellor's students by hand shows none of them");

  const hits = await palette(c.page, "Scopecheck");
  check(hits.some((h) => h.kind === "student" && h.label === "Scopecheck Mine"), "the palette finds the counsellor's own student");
  check(!hits.some((h) => h.label === "Scopecheck Elsewhere"), "and not another counsellor's");
  const acks = await palette(c.page, "SCOPE-");
  check(acks.some((h) => h.kind === "application" && h.label === "SCOPE-MINE-1"), "the palette finds an application on their own student");
  check(!acks.some((h) => h.label === "SCOPE-OTHER-1"), "and not one on another counsellor's");

  const text = await deadlinesText(c.page);
  check(text.includes("Scopecheck Mine"), "the application deadlines list their own student's deadline");
  check(!text.includes("Scopecheck Elsewhere"), "and not the other counsellor's student's");

  // The student picker API, which the search screen's combobox reads from.
  const picked = await pick(c.page, "Scopecheck");
  check(picked.includes("Scopecheck Mine") && picked.includes("Scopecheck Nobody"), "the student picker offers their own student and the branch's unassigned one");
  check(!picked.includes("Scopecheck Elsewhere"), "and not another counsellor's");

  // The finder's "a student's file" select, and the file named in the address.
  await go(c.page, "/finder");
  const finderOptions = await options(c.page, "select#student");
  check(finderOptions.includes("sc_mine") && !finderOptions.includes("sc_other"), "the finder offers their own student and not another counsellor's");
  check(!(await pageText(c.page, "/finder?student=sc_other")).includes("Scopecheck Elsewhere"), "naming another counsellor's student in the finder's address reads nothing of them");

  // The search screen, where the student arrives by the address.
  check((await pageText(c.page, "/search?student=sc_mine")).includes("Scopecheck Mine"), "search checks against their own student when asked");
  check(!(await pageText(c.page, "/search?student=sc_other")).includes("Scopecheck Elsewhere"), "and reads nothing of another counsellor's student named in the address");

  // Events: who is listed as registered, and who can be registered.
  const events = await pageText(c.page, "/events");
  check(events.includes("Scopecheck Mine"), "the events page lists their own student's registration");
  check(!events.includes("Scopecheck Elsewhere"), "and not another counsellor's student's");
  const registerable = await options(c.page, 'select[name="studentId"]');
  check(registerable.includes("sc_free") && !registerable.includes("sc_other"), "the register picker offers the unassigned student and not another counsellor's");

  // Requesting program options for a student.
  await go(c.page, "/program-options/new");
  const requestable = await options(c.page, "select#or-student");
  check(requestable.includes("sc_mine") && !requestable.includes("sc_other"), "the program options request offers their own student and not another counsellor's");

  // A program's "check a student" picker, and the student named in its address.
  await go(c.page, `/programs/${program}`);
  const checkable = await options(c.page, 'select[name="student"]');
  check(checkable.includes("sc_mine") && !checkable.includes("sc_other"), "the program page's student picker offers their own and not another counsellor's");
  check(!(await pageText(c.page, `/programs/${program}?student=sc_other`)).includes("Scopecheck Elsewhere"), "naming another counsellor's student in the program's address reads nothing of them");

  // The practice interview: the applications offered and the past sessions.
  const interview = await pageText(c.page, "/interview");
  check(!interview.includes("SCOPE-OTHER-1") && !interview.includes("Scopecheck Elsewhere"), "the practice interview offers nothing of another counsellor's student");
  await go(c.page, "/interview?session=sc_session");
  check((await c.page.locator("#session").count()) === 0, "and another counsellor's past practice does not open by its address");

  // A colleague's day: only the tasks about students this person may open.
  const day = await pageText(c.page, `/my-day?who=${senior}`);
  check(day.includes("Scopecheck task mine"), "a colleague's day shows their task on the counsellor's own student");
  check(!day.includes("Scopecheck task elsewhere"), "and not their task on a student the counsellor cannot open");

  // The applications export, the same rows as the list.
  const csv = await exportText(c.page);
  check(csv.includes("SCOPE-MINE-1") && !csv.includes("SCOPE-OTHER-1"), "the applications export carries their own file and not the other counsellor's");
  check(c.errors.length === 0, `no errors for the counsellor ${c.errors.slice(0, 2).join(" | ")}`);
  await c.ctx.close();
}

/* ---------------- The branch head sees everybody at the branch ---------------- */
{
  const b = await open("kottayam@medcity.test");
  await go(b.page, "/students/board");
  check((await card(b.page, "sc_mine")) === 1 && (await card(b.page, "sc_free")) === 1 && (await card(b.page, "sc_other")) === 1, "the branch head's board shows all three");
  check((await b.page.locator('select[name="who"]').count()) === 1, "and offers the counsellor picker");
  const hits = await palette(b.page, "Scopecheck");
  check(hits.some((h) => h.label === "Scopecheck Elsewhere"), "the branch head's palette finds every student of the branch");
  const text = await deadlinesText(b.page);
  check(text.includes("Scopecheck Elsewhere") && text.includes("Scopecheck Mine"), "and the deadlines tab lists both deadlines");
  const picked = await pick(b.page, "Scopecheck");
  check(picked.includes("Scopecheck Elsewhere"), "the branch head's student picker offers every student of the branch");
  await go(b.page, "/finder");
  check((await options(b.page, "select#student")).includes("sc_other"), "and so does the finder");
  const events = await pageText(b.page, "/events");
  check(events.includes("Scopecheck Elsewhere") && events.includes("Scopecheck Mine"), "and the events page lists both registrations");
  check((await pageText(b.page, "/interview")).includes("Scopecheck Elsewhere"), "and the practice interview lists the senior's past session");
  const day = await pageText(b.page, `/my-day?who=${senior}`);
  check(day.includes("Scopecheck task elsewhere") && day.includes("Scopecheck task mine"), "and the senior's day shows both tasks");
  const csv = await exportText(b.page);
  check(csv.includes("SCOPE-MINE-1") && csv.includes("SCOPE-OTHER-1"), "and the applications export carries both files");
  check(b.errors.length === 0, `no errors for the branch head ${b.errors.slice(0, 2).join(" | ")}`);
  await b.ctx.close();
}

/* ---------------- The desk sees everybody ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, `/students/board?branch=${kottayam}`);
  check((await card(a.page, "sc_mine")) === 1 && (await card(a.page, "sc_free")) === 1 && (await card(a.page, "sc_other")) === 1, "the desk's board shows all three");
  const hits = await palette(a.page, "Scopecheck");
  check(hits.filter((h) => h.kind === "student").length === 3, "the desk's palette finds all three");
  const text = await deadlinesText(a.page);
  check(text.includes("Scopecheck Elsewhere"), "and the deadlines tab lists the other counsellor's student's deadline");
  check(a.errors.length === 0, `no errors for the desk ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}

cleanup();
await browser.close();
console.log(fails.length === 0 ? "\nall passed" : `\n${fails.length} failed`);
process.exit(fails.length === 0 ? 0 : 1);
