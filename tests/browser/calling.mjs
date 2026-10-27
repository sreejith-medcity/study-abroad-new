// Calling mode and the follow-up work around it: a counsellor's queue of the
// enquiries and students waiting for a call, one at a time, with the seven
// outcomes each setting the next step; the contact history enquiries now keep
// beside students; an enquiry's next follow-up held as one task on My day; the
// branch head's team queue; the counsellor leaderboard with its CSV; and the
// day end report counting enquiry calls among the calls made.
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

const ist = (minutes) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + minutes * 60_000));
const minuteOfDay = (() => {
  const [h, m] = ist(0).split(":").map(Number);
  return h * 60 + m;
})();
// The run takes a few minutes, and the day's counters and the day end report
// both reset at midnight India time.
if (minuteOfDay < 20 || minuteOfDay > 23 * 60 + 30) {
  console.log("SKIPPED: too close to midnight in India for the day's counters to hold still");
  process.exit(0);
}
/** India time, minutes from now, held inside today. */
const istToday = (minutes) => (minuteOfDay + minutes > 23 * 60 + 59 ? "23:59" : ist(minutes));
const today = sql("select (now() at time zone 'Asia/Kolkata')::date::text");
const plus = (days) => sql(`select ('${today}'::date + ${days})::text`);
const yesterday = plus(-1);
const tag = String(Date.now()).slice(-5);
const idOf = (email) => sql(`select id from users where email = '${email}'`);
const uk = idOf("uk.docs@medcity.test");
const germany = idOf("germany@medcity.test");
const head = idOf("kottayam@medcity.test");
const kochiHead = idOf("kochi@medcity.test");
const kottayam = sql(`select org_id from users where id = '${uk}'`);
const kochi = sql(`select org_id from users where id = '${kochiHead}'`);
const inToday = (col) => `${col} >= '${today} 00:00:00+05:30'::timestamptz and ${col} < '${today} 00:00:00+05:30'::timestamptz + interval '1 day'`;
const CONNECTED = "('REACHED','WILL_SEND','WANTS_TIME','NEEDS_COUNSELLING','NOT_INTERESTED','ENROLLED_ELSEWHERE')";
const callsToday = (id) => n(`select count(*) from contact_log where by_id = '${id}' and channel = 'CALL' and ${inToday("created_at")}`);
const connectedToday = (id) => n(`select count(*) from contact_log where by_id = '${id}' and channel = 'CALL' and outcome in ${CONNECTED} and ${inToday("created_at")}`);

// Enquiries for the run, each in a known state.
const enquiry = (name, owner, org, { stage = "CONTACTED", due = null, contacted = true } = {}) => {
  const id = sql(`select substr(md5(random()::text), 1, 24)`);
  sql(`insert into enquiries (id, org_id, created_by_id, assigned_to_id, name, phone, source, stage, next_follow_up_at, last_contacted_at, created_at, updated_at)
       values ('${id}', '${org}', '${owner}', '${owner}', '${name}', '+91 9${tag}${String(Math.floor(Math.random() * 9000) + 1000)}', 'PHONE', '${stage}',
       ${due ? `'${due}T00:00:00Z'` : "null"}, ${contacted ? "now() - interval '3 days'" : "null"}, now() - interval '10 days', now())`);
  return id;
};
const names = {
  overdue: `Calling Overdue${tag}`,
  today: `Calling Today${tag}`,
  later: `Calling Later${tag}`,
  wrong: `Calling Wrong${tag}`,
  enrolled: `Calling Enrolled${tag}`,
  notint: `Calling Notint${tag}`,
  germany: `Calling Germany${tag}`,
  kochi: `Calling Kochi${tag}`,
};
const ids = {
  overdue: enquiry(names.overdue, uk, kottayam, { due: yesterday }),
  today: enquiry(names.today, uk, kottayam, { due: today }),
  later: enquiry(names.later, uk, kottayam, { due: plus(5) }),
  wrong: enquiry(names.wrong, uk, kottayam, { due: today }),
  enrolled: enquiry(names.enrolled, uk, kottayam, { due: today }),
  notint: enquiry(names.notint, uk, kottayam, { due: today }),
  germany: enquiry(names.germany, germany, kottayam, { stage: "NEW", contacted: false }),
  kochi: enquiry(names.kochi, kochiHead, kochi, { stage: "NEW", contacted: false }),
};
const nandana = sql(`select id from enquiries where name = 'Nandana Prakash'`);
// A student of theirs with a call that was due yesterday.
const [studentId, studentName] = sql(
  `select id || '|' || first_name || ' ' || last_name from students where assigned_to_id = '${uk}' and not archived and journey_stage <> 'ARRIVED' order by created_at limit 1`,
).split("|");
sql(`insert into tasks (id, org_id, student_id, kind, title, due_on, assigned_to_id, source)
     values (substr(md5(random()::text), 1, 24), (select org_id from students where id = '${studentId}'), '${studentId}', 'CALL', 'Call about the offer ${tag}', '${yesterday}', '${uk}', 'by hand')`);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking"] });
let ip = 40;
async function open(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, extraHTTPHeaders: { "x-forwarded-for": `10.246.4.${ip++}` } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { if (knownWarning(e, page.url())) return; errors.push(String(e).slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = async (page) => {
  await page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await hydrated(page);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};
const go = async (page, path) => {
  await page.goto(`${BASE}${path}`);
  return settle(page);
};
const cardKey = (page) => page.locator("[data-call-card]").first().getAttribute("data-call-card").catch(() => null);
const counter = async (page, k) => (await page.locator(`[data-counter="${k}"]`).innerText().catch(() => "")).trim();

/* ---------------- 1. Calling mode for a counsellor ---------------- */
{
  const c = await open("uk.docs@medcity.test");
  await go(c.page, "/dashboard");
  check((await c.page.locator('nav[aria-label="Main"]').getByText("Calling mode", { exact: true }).count()) === 1, "a counsellor has Calling mode in the menu");
  const before = callsToday(uk);
  let text = await go(c.page, "/calls");
  check(/Calling mode/.test(text), "the calling page opens for a counsellor");
  check((await counter(c.page, "calls")) === String(before) && (await counter(c.page, "connected")) === String(connectedToday(uk)), `the counters show today's calls and connected calls (${await counter(c.page, "calls")}, ${await counter(c.page, "connected")})`);
  check((await cardKey(c.page)) === `e:${nandana}`, `the first call is the enquiry nobody has contacted yet (${await cardKey(c.page)})`);
  check(/Not contacted yet/.test(await c.page.locator("[data-call-card]").innerText()), "and it says so");
  const tel = await c.page.locator("[data-call-tel]").getAttribute("href");
  const wa = await c.page.locator("[data-call-whatsapp]").getAttribute("href");
  check(tel === "tel:+919847011001", `tap to call dials the number with its country code (${tel})`);
  check(wa === "https://wa.me/919847011001", `WhatsApp opens a chat with the same number, sending nothing itself (${wa})`);
  const upNext = await c.page.locator("[data-up-next]").innerText().catch(() => "");
  check(upNext.includes(names.overdue) && upNext.includes(names.today) && upNext.includes(studentName), "the overdue enquiry, today's and the student whose call is late are queued");
  check(!upNext.includes(names.later) && !text.includes(names.germany) && !text.includes(names.kochi), "a follow-up for a later day and other people's enquiries are not");
  // Overdue before today's, and on the same day an enquiry before a student.
  const order = (await c.page.locator("[data-up-next-name]").allInnerTexts()).map((t) => t.trim());
  check(order.indexOf(names.overdue) >= 0 && order.indexOf(names.overdue) < order.indexOf(studentName) && order.indexOf(studentName) < order.indexOf(names.today), `overdue enquiries, then overdue students, then today's (${order.join(", ")})`);
  // The open follow-up task was raised for the enquiry already holding a date.
  check(n(`select count(*) from tasks where enquiry_id = '${ids.overdue}' and done_at is null and due_on = '${yesterday}' and assigned_to_id = '${uk}'`) === 1, "an enquiry's follow-up date is a task on its owner's desk");

  // Somebody else's enquiry cannot be called by changing the form.
  await c.page.locator('[data-call-card] input[name="key"]').evaluate((el, v) => (el.value = v), `e:${ids.germany}`);
  await c.page.locator('[data-outcome="INTERESTED"]').click();
  await c.page.waitForURL(/error=/, { timeout: 15000 }).catch(() => {});
  await c.page.getByText(/not in your queue/).first().waitFor({ timeout: 10000 }).catch(() => {});
  text = await settle(c.page);
  check(/not in your queue/.test(text), `a counsellor cannot log a call on a colleague's enquiry (${c.page.url().replace(BASE, "")})`);
  check(n(`select count(*) from contact_log where enquiry_id = '${ids.germany}'`) === 0, "and nothing was written against it");
  text = await go(c.page, `/calls?open=e:${ids.kochi}`);
  check(!text.includes(names.kochi), "nor open another branch's enquiry by its address");

  // Work the queue through, one outcome per person.
  const plan = {
    [`e:${nandana}`]: "INTERESTED",
    [`e:${ids.overdue}`]: "NOT_REACHABLE",
    [`e:${ids.today}`]: "SWITCHED_OFF",
    [`e:${ids.wrong}`]: "WRONG_NUMBER",
    [`e:${ids.enrolled}`]: "ENROLLED_ELSEWHERE",
    [`e:${ids.notint}`]: "NOT_INTERESTED",
    [`s:${studentId}`]: "CALL_BACK",
  };
  await go(c.page, "/calls");
  check((await c.page.locator("[data-call-lost-reason] option").count()) > 1, "an enquiry's calling card offers the lost reasons from the list");
  let refused = false;
  const seen = [];
  for (let i = 0; i < 20; i++) {
    const key = await cardKey(c.page);
    if (!key) break;
    seen.push(key);
    const outcome = plan[key] ?? "NOT_REACHABLE";
    if (key === `e:${ids.today}`) await c.page.locator('[data-call-card] input[name="note"]').fill("Asked for the fee details");
    if (outcome === "CALL_BACK") await c.page.locator('[data-call-card] input[name="callbackOn"]').fill(plus(3));
    if (outcome === "ENROLLED_ELSEWHERE" || outcome === "NOT_INTERESTED") {
      if (!refused) {
        // Closing an enquiry as lost without a reason from the list is refused,
        // and nothing is written, the call included.
        refused = true;
        const before = callsToday(uk);
        await c.page.locator(`[data-outcome="${outcome}"]`).click();
        await c.page.waitForURL(/error=/, { timeout: 15000 }).catch(() => {});
        await c.page.getByText(/Pick the reason from the list/).first().waitFor({ timeout: 10000 }).catch(() => {});
        const said = await settle(c.page);
        check(/Pick the reason from the list/.test(said) && callsToday(uk) === before, `a call that closes an enquiry as lost asks for the lost reason first (${c.page.url().replace(BASE, "")})`);
        check((await cardKey(c.page)) === key && sql(`select stage from enquiries where id = '${key.slice(2)}'`) !== "LOST", "and keeps the same person open, still not lost");
      }
      await c.page.locator("[data-call-lost-reason]").selectOption({ label: outcome === "ENROLLED_ELSEWHERE" ? "Chose another agency" : "Postponed" });
    }
    const callsBefore = callsToday(uk);
    await c.page.locator(`[data-outcome="${outcome}"]`).click();
    await c.page.waitForFunction((k) => document.querySelector("[data-call-card]")?.getAttribute("data-call-card") !== k, key, { timeout: 15000 }).catch(() => {});
    await settle(c.page);
    if (callsToday(uk) !== callsBefore + 1) check(false, `the call on ${key} was logged once`);
  }
  check(Object.keys(plan).every((k) => seen.includes(k)), `every queued person opened in turn after the last was logged (${seen.length} calls)`);
  text = await settle(c.page);
  check(/Queue clear/.test(text), "when the last one is logged the queue is clear");
  check((await counter(c.page, "calls")) === String(callsToday(uk)) && callsToday(uk) === before + seen.length, `calls made today counts every call logged (${await counter(c.page, "calls")})`);
  check((await counter(c.page, "connected")) === String(connectedToday(uk)), `connected counts the ones where somebody answered (${await counter(c.page, "connected")})`);
  const outcomes = sql(`select string_agg(distinct outcome::text, ',' order by outcome::text) from contact_log where by_id = '${uk}' and channel = 'CALL' and ${inToday("created_at")} and (enquiry_id in ('${nandana}','${Object.values(ids).join("','")}') or student_id = '${studentId}')`);
  check(outcomes === "ENROLLED_ELSEWHERE,NOT_INTERESTED,NO_ANSWER,REACHED,SWITCHED_OFF,WANTS_TIME,WRONG_NUMBER", `all seven outcomes went on the contact history (${outcomes})`);

  const en = (id) => sql(`select stage || '|' || coalesce(to_char((next_follow_up_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD'), '-') || '|' || coalesce(lost_reason, '-') from enquiries where id = '${id}'`);
  const openTasks = (id) => sql(`select coalesce(string_agg(due_on::text, ','), '-') from tasks where enquiry_id = '${id}' and done_at is null`);
  check(en(nandana) === `QUALIFIED|${plus(2)}|-` && openTasks(nandana) === plus(2), `interested: a new enquiry is qualified and called again in two days, with its task (${en(nandana)}, ${openTasks(nandana)})`);
  check(en(ids.overdue) === `CONTACTED|${plus(1)}|-` && openTasks(ids.overdue) === plus(1), `not reachable: tomorrow, stage left alone (${en(ids.overdue)})`);
  check(en(ids.today) === `CONTACTED|${plus(1)}|-` && sql(`select note from contact_log where enquiry_id = '${ids.today}'`) === "Asked for the fee details", "switched off: tomorrow, with what was said kept on the call");
  check(en(ids.wrong) === "CONTACTED|-|-" && openTasks(ids.wrong) === "-", `wrong number: no next call and no task (${en(ids.wrong)})`);
  check(en(ids.enrolled) === "LOST|-|Already enrolled elsewhere" && openTasks(ids.enrolled) === "-", `already enrolled elsewhere closes the enquiry as lost (${en(ids.enrolled)})`);
  check(en(ids.notint).startsWith("LOST|-|") && openTasks(ids.notint) === "-", "not interested closes it as lost too");
  const lostWith = (id) => sql(`select coalesce(r.label, '-') || '|' || (e.lost_at is not null) from enquiries e left join lost_reasons r on r.id = e.lost_reason_id where e.id = '${id}'`);
  check(lostWith(ids.enrolled) === "Chose another agency|true" && lostWith(ids.notint) === "Postponed|true", `each carries the lost reason picked from the list, with when (${lostWith(ids.enrolled)}, ${lostWith(ids.notint)})`);
  check(n(`select count(*) from record_versions where entity = 'enquiry' and entity_id = '${ids.enrolled}' and action = 'enquiry.lost' and changes @> '[{"field":"stage","after":"LOST"}]'`) === 1, "closing it by a call is a version in the enquiry's record history");
  check(n(`select count(*) from record_versions where entity = 'enquiry' and entity_id = '${ids.overdue}' and action = 'enquiry.call' and changed_by_id = '${uk}'`) === 1, "and a call that moves the follow-up is one too, by the caller");
  check(n(`select count(*) from audit_logs where action = 'enquiry.lost' and entity_id = '${ids.notint}' and meta->>'via' = 'calling mode'`) === 1, "the lost close is audited as made in calling mode");
  check(n(`select count(*) from tasks where student_id = '${studentId}' and done_at is null and kind = 'CALL' and due_on = '${plus(3)}' and assigned_to_id = '${uk}'`) === 1, "call back later on a student sets a call on the day they asked for");
  check(n(`select count(*) from tasks where title = 'Call about the offer ${tag}' and done_at is not null and done_by_id = '${uk}'`) === 1, "and the late call it answered is finished");
  // The follow-up the call answered is finished, not moved.
  check(n(`select count(*) from tasks where enquiry_id = '${ids.overdue}' and done_at is not null and done_by_id = '${uk}' and due_on = '${yesterday}'`) === 1, "the overdue follow-up is finished by the call, and stays on record as done late");
  check(n(`select count(*) from (select enquiry_id from tasks where enquiry_id is not null and done_at is null group by 1 having count(*) > 1) x`) === 0, "no enquiry holds two open follow-ups");
  text = await go(c.page, `/calls?skip=`);
  check(/Queue clear/.test(text), "nobody comes back today once their call is logged");
  check(c.errors.length === 0, `calling mode works without an error ${c.errors.slice(0, 2).join(" | ")}`);

  /* ---------------- 2. Contact history on an enquiry ---------------- */
  text = await go(c.page, `/enquiries/${ids.overdue}`);
  check((await c.page.locator('[data-history="contact"]').count()) === 1 && /Call: No answer/.test(text), "the enquiry's history shows the call and what came of it");
  // A WhatsApp before a follow-up that is not due yet moves it rather than finishing it.
  await go(c.page, `/enquiries/${ids.later}`);
  const followForm = c.page.locator('form:has(textarea[name="body"])');
  await followForm.locator('textarea[name="body"]').fill("Sent the fee structure on WhatsApp.");
  await followForm.locator('select[name="channel"]').selectOption("WHATSAPP");
  await followForm.locator('button[type="submit"]').click();
  await c.page.locator('[role="alert"], [role="status"]').getByText(/Say what came of it/).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(/Say what came of it/.test(await c.page.locator("main").innerText()) && n(`select count(*) from contact_log where enquiry_id = '${ids.later}'`) === 0, "a channel without an outcome is refused, and nothing is logged");
  await followForm.locator('select[name="outcome"]').selectOption("WILL_SEND");
  await followForm.locator('input[name="nextFollowUpAt"]').fill(plus(7));
  await followForm.locator('button[type="submit"]').click();
  await c.page.locator('[role="status"]').getByText(/Logged\. Stage is now/).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(sql(`select channel || '|' || outcome || '|' || coalesce(note, '') from contact_log where enquiry_id = '${ids.later}'`) === "WHATSAPP|WILL_SEND|Sent the fee structure on WhatsApp.", "a WhatsApp on an enquiry is logged with its channel, outcome and what was said");
  check(openTasks(ids.later) === plus(7) && n(`select count(*) from tasks where enquiry_id = '${ids.later}'`) === 1, `the follow-up that was not due yet is moved to the new day, not duplicated (${openTasks(ids.later)})`);
  text = await go(c.page, `/enquiries/${ids.later}`);
  check(/WhatsApp: They will send it/.test(text) && (await c.page.locator('[data-history="note"]').filter({ hasText: "Sent the fee structure" }).count()) === 0, "it shows once in the history, as a conversation");
  // A visit to an enquiry with no follow-up set, with a next date.
  await go(c.page, `/enquiries/${ids.wrong}`);
  await followForm.locator('textarea[name="body"]').fill("Came in with the right number.");
  await followForm.locator('select[name="channel"]').selectOption("VISIT");
  await followForm.locator('select[name="outcome"]').selectOption("REACHED");
  await followForm.locator('input[name="nextFollowUpAt"]').fill(plus(1));
  await followForm.locator('button[type="submit"]').click();
  await c.page.locator('[role="status"]').getByText(/Logged\. Stage is now/).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(sql(`select string_agg(channel::text, ',' order by happened_at) from contact_log where enquiry_id = '${ids.wrong}'`) === "CALL,VISIT", "a visit is logged beside the call");
  check(openTasks(ids.wrong) === plus(1), "and its next date raises the follow-up task");

  /* ---------------- 3. Enquiry follow-ups on My day ---------------- */
  text = await go(c.page, "/my-day");
  check((await c.page.locator(`[data-task-enquiry="${nandana}"]`).count()) === 1, "My day lists the enquiry's follow-up with a link to it");
  // Moving the date on the enquiry moves the task.
  const taskBefore = sql(`select id from tasks where enquiry_id = '${nandana}' and done_at is null`);
  await go(c.page, `/enquiries/${nandana}`);
  const edit = c.page.locator('main form:has(input[name="name"])');
  await edit.locator('input[name="nextFollowUpAt"]').fill(yesterday);
  await edit.locator('button[type="submit"]').first().click();
  await c.page.locator('[role="status"]').getByText(/Saved/).first().waitFor({ timeout: 10000 }).catch(() => {});
  check(openTasks(nandana) === yesterday && sql(`select id from tasks where enquiry_id = '${nandana}' and done_at is null`) === taskBefore, `setting the next follow-up moves the one open task rather than raising another (${openTasks(nandana)})`);
  text = await go(c.page, "/my-day");
  const heading = await c.page
    .locator(`[data-task-enquiry="${nandana}"]`)
    .first()
    .evaluate((el) => el.closest(".rounded-xl")?.querySelector("h2")?.textContent?.trim() ?? "")
    .catch(() => "");
  check(heading === "Overdue", `a late enquiry follow-up is in My day's overdue list (under ${heading || "nothing"})`);
  // Ticked off by hand, it stays off.
  await c.page.locator("li", { has: c.page.locator(`[data-task-enquiry="${nandana}"]`) }).getByRole("button", { name: "Done", exact: true }).first().click();
  await c.page.waitForFunction((id) => !document.querySelector(`[data-task-enquiry="${id}"]`), nandana, { timeout: 10000 }).catch(() => {});
  await go(c.page, "/my-day");
  check((await c.page.locator(`[data-task-enquiry="${nandana}"]`).count()) === 0 && openTasks(nandana) === "-", "a follow-up ticked off by hand is not raised again");
  check(sql(`select coalesce(next_follow_up_at::text, '-') from enquiries where id = '${nandana}'`) === "-", "and the enquiry no longer shows a date for it");
  check(n(`select count(*) from record_versions where entity_id = '${nandana}' and action = 'enquiry.follow_up_task' and changes @> '[{"field":"nextFollowUpAt","after":null}]'`) === 1, "clearing the date that way is recorded in the enquiry's history");
  check(c.errors.length === 0, `no client errors on the enquiry and My day screens ${c.errors.slice(0, 2).join(" | ")}`);

  /* ---------------- The leaderboard is not a counsellor's ---------------- */
  await go(c.page, "/reports/leaderboard");
  check(/\/forbidden/.test(c.page.url()), "a counsellor cannot open the leaderboard");
  const res = await c.page.request.get(`${BASE}/api/reports/leaderboard`);
  check(res.status() === 404, "nor download it");
  await go(c.page, "/calls?team=1");
  check((await c.page.locator("[data-team-row]").count()) === 0, "and has no team queue");
  await c.ctx.close();
}

/* ---------------- 4. The branch head's team queue ---------------- */
{
  const h = await open("kottayam@medcity.test");
  await go(h.page, "/dashboard");
  check((await h.page.locator('nav[aria-label="Main"]').getByText("Calling mode", { exact: true }).count()) === 1, "a branch head has Calling mode in the menu");
  let text = await go(h.page, "/calls");
  check(/Team queue/.test(text), "and a way to the team queue");
  text = await go(h.page, "/calls?team=1");
  const team = sql(`select string_agg(id, ',' order by id) from users where org_id = '${kottayam}' and active and role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR','SUB_AGENT_COUNSELLOR')`).split(",");
  const rows = await h.page.locator("[data-team-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-team-row")).sort());
  check(JSON.stringify(rows) === JSON.stringify([...team].sort()), `every counsellor at the branch has a row (${rows.length})`);
  const ukCells = (await h.page.locator(`[data-team-row="${uk}"] td`).allInnerTexts()).map((t) => t.trim());
  check(ukCells[1] === String(callsToday(uk)) && ukCells[2] === String(connectedToday(uk)), `with their calls and connected calls today (${ukCells.slice(1, 3).join(", ")})`);
  check((await h.page.locator(`[data-team-queue="${germany}"]`).innerText().catch(() => "")).includes(names.germany), "a colleague's waiting enquiry is in their queue");
  check(!text.includes(names.kochi), "another branch's is not");
  // The branch head can make that call.
  await h.page.locator(`[data-team-queue="${germany}"] a[href="/calls?open=${encodeURIComponent(`e:${ids.germany}`)}"]`).click();
  await h.page.waitForURL(/open=/, { timeout: 15000 }).catch(() => {});
  await settle(h.page);
  check((await cardKey(h.page)) === `e:${ids.germany}`, "opening one from the team queue puts it in the calling card");
  await h.page.locator('[data-outcome="CALL_BACK"]').click();
  await h.page.waitForURL(/done=/, { timeout: 15000 }).catch(() => {});
  check(n(`select count(*) from contact_log where enquiry_id = '${ids.germany}' and by_id = '${head}' and outcome = 'WANTS_TIME'`) === 1, "and log what came of it");
  check(sql(`select assigned_to_id from tasks where enquiry_id = '${ids.germany}' and done_at is null`) === germany, "the next follow-up stays on the owner's desk");
  check(h.errors.length === 0, `the team queue works without an error ${h.errors.slice(0, 2).join(" | ")}`);

  /* ---------------- A merged enquiry leaves the queue, its calls move ---------------- */
  {
    const keep = enquiry(`Calling Keep${tag}`, germany, kottayam, { due: today });
    const dupe = enquiry(`Calling Dupe${tag}`, germany, kottayam, { due: yesterday });
    sql(`update enquiries set phone = (select phone from enquiries where id = '${keep}') where id = '${dupe}'`);
    sql(`insert into contact_log (id, org_id, enquiry_id, channel, outcome, by_id, happened_at) values (substr(md5(random()::text), 1, 24), '${kottayam}', '${dupe}', 'CALL', 'NO_ANSWER', '${germany}', now() - interval '2 days')`);
    let q = await go(h.page, "/calls?team=1");
    check(q.includes(`Calling Dupe${tag}`) && q.includes(`Calling Keep${tag}`), "both enquiries wait in the colleague's queue before the merge");
    await go(h.page, `/enquiries/${keep}`);
    await h.page.getByText(`Merge Calling Dupe${tag} into this one`).click();
    await h.page.locator('input[name="confirm"]').check();
    await h.page.getByRole("button", { name: "Merge into this enquiry" }).click();
    for (let i = 0; i < 30 && sql(`select stage from enquiries where id = '${dupe}'`) !== "MERGED"; i++) await h.page.waitForTimeout(500);
    check(sql(`select stage from enquiries where id = '${dupe}'`) === "MERGED", "the branch head merges the duplicate");
    check(n(`select count(*) from contact_log where enquiry_id = '${keep}' and outcome = 'NO_ANSWER'`) === 1 && n(`select count(*) from contact_log where enquiry_id = '${dupe}'`) === 0, "the duplicate's calls move to the enquiry kept");
    check(n(`select count(*) from tasks where enquiry_id = '${dupe}' and done_at is null`) === 0 && n(`select count(*) from tasks where enquiry_id = '${keep}' and done_at is null`) === 1, "and only the enquiry kept holds an open follow-up");
    q = await go(h.page, "/calls?team=1");
    check(!q.includes(`Calling Dupe${tag}`) && q.includes(`Calling Keep${tag}`), "a merged enquiry is out of every queue");
  }

  /* ---------------- A routed enquiry's follow-up is on its new owner's desk ---------------- */
  {
    await go(h.page, "/enquiries/new");
    await h.page.fill('input[name="name"]', `Calling Routed${tag}`);
    await h.page.fill('input[name="phone"]', `+91 8${tag}55011`);
    await h.page.fill('input[name="nextFollowUpAt"]', plus(2));
    await h.page.getByRole("button", { name: "Save enquiry" }).click();
    await h.page.waitForURL((u) => /\/enquiries\/(?!new\b)[^/?]+/.test(new URL(String(u)).pathname), { timeout: 20000 }).catch(() => {});
    const routed = sql(`select id from enquiries where name = 'Calling Routed${tag}'`);
    const owner = sql(`select coalesce(assigned_to_id, created_by_id) from enquiries where id = '${routed}'`);
    check(!!routed && sql(`select assigned_to_id || '|' || due_on from tasks where enquiry_id = '${routed}' and done_at is null`) === `${owner}|${plus(2)}`, `a new enquiry's follow-up is one task, on the desk of whoever it went to (${owner})`);
  }

  /* ---------------- 5. The leaderboard for a branch head ---------------- */
  await go(h.page, "/dashboard");
  check((await h.page.locator('nav[aria-label="Main"]').getByText("Counsellor leaderboard", { exact: true }).count()) === 1, "a branch head has the leaderboard in the menu");
  const groups = await h.page.locator("aside nav > details").evaluateAll((els) => els.map((e) => ({ title: (e.querySelector("summary span")?.textContent ?? "").trim(), items: [...e.querySelectorAll("a")].map((a) => a.getAttribute("href")) })));
  const reports = groups.find((g) => g.items.includes("/reports/leaderboard"));
  check(!!reports && /reports/i.test(reports.title) && reports.items.length <= 5 && reports.items.includes("/reports/lost-reasons"), `under Reports, beside Lost reasons, five or fewer (${reports ? `${reports.title}: ${reports.items.join(", ")}` : "none"})`);
  text = await go(h.page, "/reports/leaderboard");
  check(/Counsellor leaderboard/.test(text), "the branch head opens the counsellor leaderboard");
  check((await h.page.locator('select[name="branch"]').count()) === 0, "held to their own branch");
  const leaders = await h.page.locator("[data-leader-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-leader-row")));
  check(leaders.includes(uk) && leaders.includes(germany) && !leaders.includes(kochiHead), "listing their own people and nobody else's");
  const monthStart = `${today.slice(0, 7)}-01`;
  const within = (col) => `${col} >= '${monthStart} 00:00:00+05:30'::timestamptz and ${col} < '${today} 00:00:00+05:30'::timestamptz + interval '1 day'`;
  const expect = (id) => {
    const calls = n(`select count(*) from contact_log where by_id = '${id}' and channel = 'CALL' and ${within("created_at")}`);
    const conn = n(`select count(*) from contact_log where by_id = '${id}' and channel = 'CALL' and outcome in ${CONNECTED} and ${within("created_at")}`);
    const onTime = n(`select count(*) from tasks where assigned_to_id = '${id}' and kind in ('CALL','FOLLOW_UP') and ${within("done_at")} and (done_at at time zone 'Asia/Kolkata')::date <= due_on`);
    const late = n(`select count(*) from tasks where assigned_to_id = '${id}' and kind in ('CALL','FOLLOW_UP') and ${within("done_at")} and (done_at at time zone 'Asia/Kolkata')::date > due_on`);
    const held = n(`select count(*) from enquiries where coalesce(assigned_to_id, case when submitted_by_org_id is null then created_by_id end) = '${id}' and stage <> 'MERGED'`);
    const conv = n(`select count(*) from enquiries e join students s on s.id = e.student_id where coalesce(e.assigned_to_id, case when e.submitted_by_org_id is null then e.created_by_id end) = '${id}' and e.stage = 'CONVERTED' and ${within("s.created_at")}`);
    const nr = "Not recorded";
    return [calls ? String(calls) : nr, calls ? `${conn} (${Math.round((100 * conn) / calls)}%)` : nr, onTime + late ? String(onTime) : nr, onTime + late ? String(late) : nr, held || conv ? String(conv) : nr];
  };
  const shownRow = async (id) => (await h.page.locator(`[data-leader-row="${id}"] td`).allInnerTexts()).slice(2).map((t) => t.replace(/\s+/g, " ").trim());
  const ukWant = expect(uk);
  check(JSON.stringify(await shownRow(uk)) === JSON.stringify(ukWant), `a counsellor's calls, connected, follow-ups on time and late, and conversions are what was recorded (${(await shownRow(uk)).join(" / ")}; want ${ukWant.join(" / ")})`);
  check(Number(ukWant[3]) >= 1, "the follow-up the overdue call answered counts as done late");
  const quiet = sql(`select u.id from users u where u.org_id = '${kottayam}' and u.active and u.role in ('PARTNER','COUNSELLOR','SENIOR_COUNSELLOR','TRAINEE_COUNSELLOR') and not exists (select 1 from contact_log c where c.by_id = u.id and c.channel = 'CALL' and ${within("c.created_at")}) limit 1`);
  if (quiet) check((await shownRow(quiet))[0] === "Not recorded", "somebody with no calls logged reads Not recorded rather than 0");
  const csvHref = await h.page.locator("[data-leaderboard-csv]").getAttribute("href");
  const csv = await h.page.request.get(`${BASE}${csvHref}`);
  const body = (await csv.text()).replace(/^﻿/, "");
  check(csv.status() === 200 && /text\/csv/.test(csv.headers()["content-type"] ?? ""), "the leaderboard downloads as a CSV");
  check(body.split("\r\n")[0] === '"Counsellor","Branch","Calls made","Connected","Connected %","Follow-ups on time","Follow-ups late","Enquiries converted"', "with a header row");
  const ukName = sql(`select name from users where id = '${uk}'`);
  const ukLine = body.split("\r\n").find((l) => l.startsWith(`"${ukName}"`)) ?? "";
  check(ukLine.includes(`"${ukWant[0]}"`) && !body.includes("Medcity Kochi"), `with the same figures, and only the branch head's own branch (${ukLine})`);
  const otherBranch = await h.page.request.get(`${BASE}/api/reports/leaderboard?branch=${kochi}`);
  check(!(await otherBranch.text()).includes("Medcity Kochi"), "asking for another branch's still gives their own");
  check(h.errors.length === 0, `the leaderboard draws without an error ${h.errors.slice(0, 2).join(" | ")}`);
  await h.ctx.close();
}

/* ---------------- Another branch head sees only their own team ---------------- */
{
  const k = await open("kochi@medcity.test");
  const text = await go(k.page, "/calls?team=1");
  check(!text.includes(names.germany) && (await k.page.locator(`[data-team-row="${uk}"]`).count()) === 0, "the Kochi branch head's team queue holds nobody from Kottayam");
  await go(k.page, `/calls?open=e:${ids.germany}`);
  check((await cardKey(k.page)) !== `e:${ids.germany}`, "and cannot open a Kottayam enquiry to call it");
  await k.ctx.close();
}

/* ---------------- The head office reads every branch ---------------- */
{
  const a = await open("admin@medcityoverseas.test");
  await go(a.page, "/dashboard");
  check((await a.page.locator('nav[aria-label="Main"]').getByText("Counsellor leaderboard", { exact: true }).count()) === 1, "the head office has the leaderboard in the menu");
  const groups = await a.page.locator("aside nav > details").evaluateAll((els) => els.map((e) => ({ title: (e.querySelector("summary span")?.textContent ?? "").trim(), items: [...e.querySelectorAll("a")].map((x) => x.getAttribute("href")) })));
  const reports = groups.find((g) => g.items.includes("/reports/leaderboard"));
  check(!!reports && /reports/i.test(reports.title) && reports.items.length <= 5, `under Reports, which stays at five or fewer (${reports ? `${reports.title}: ${reports.items.join(", ")}` : "none"})`);
  let text = await go(a.page, "/reports/leaderboard");
  check(text.includes("Medcity Kochi") && text.includes("Medcity Kottayam"), "the head office sees every branch's counsellors");
  text = await go(a.page, `/reports/leaderboard?branch=${kochi}&from=${monthStartOf(today)}&to=${today}`);
  const rows = await a.page.locator("[data-leader-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-leader-row")));
  check(rows.includes(kochiHead) && !rows.includes(uk), "and can narrow it to one branch");
  check((await a.page.locator('select[name="branch"]').inputValue()) === kochi, "with the branch filter showing which");
  await go(a.page, "/calls");
  check(/\/forbidden/.test(a.page.url()), "calling mode is for the branches, not the head office admin");
  check(a.errors.length === 0, `no client errors for the head office ${a.errors.slice(0, 2).join(" | ")}`);
  await a.ctx.close();
}
function monthStartOf(day) {
  return `${day.slice(0, 7)}-01`;
}

/* ---------------- 6. The day end report counts enquiry calls ---------------- */
{
  // The day ended ten minutes ago, so the report is open with its figures.
  sql(`insert into app_settings (id) values ('app') on conflict do nothing;
       update app_settings set journal_day_end = '${ist(-10)}', journal_out_of_hours = '${istToday(15)}', journal_cutoff = '${istToday(60)}', journal_on_sundays = true where id = 'app'`);
  const c = await open("uk.docs@medcity.test");
  const text = await go(c.page, "/journal");
  const enquiryCalls = n(`select count(*) from contact_log where by_id = '${uk}' and channel = 'CALL' and enquiry_id is not null and ${inToday("created_at")}`);
  check(enquiryCalls >= 6, `the counsellor's enquiry calls today are there to count (${enquiryCalls})`);
  const made = await c.page.locator('main [data-figure="callsMade"]').inputValue().catch(() => "");
  const conn = await c.page.locator('main [data-figure="connectedCalls"]').inputValue().catch(() => "");
  check(made === String(callsToday(uk)), `calls made is pre-filled with enquiry and student calls together (${made} of ${callsToday(uk)})`);
  check(conn === String(connectedToday(uk)), `connected calls too (${conn} of ${connectedToday(uk)})`);
  check(text.includes(`Call with the enquiry ${names.overdue}: no answer`), "the day's lines include the call to the enquiry");
  // A merged-away duplicate's calls were real calls and still count; nothing
  // here is counted twice.
  check(n(`select count(*) from contact_log c join enquiries e on e.id = c.enquiry_id where e.stage = 'MERGED'`) === 0, "no call is left on a merged enquiry to be counted twice");
  check(c.errors.length === 0, `the day end report draws without an error ${c.errors.slice(0, 2).join(" | ")}`);
  await c.ctx.close();
}

await browser.close();
console.log(fails.length ? `\n${fails.length} failed` : "\nall passed");
process.exit(fails.length ? 1 : 0);
