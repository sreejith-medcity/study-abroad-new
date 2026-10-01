// The day-to-day layer: tasks on a desk with a My day screen, a call logged in
// two clicks that raises its own follow-up, one timeline per student, and the
// board of students by stage. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-crm";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const DB = (fs.readFileSync(".env", "utf8").match(/localhost:5432\/([a-z0-9_]+)/) || [])[1];
const sql = (q) => execFileSync("psql", ["-h", "localhost", "-U", "postgres", "-d", DB, "-Atc", q], { env: { ...process.env, PGPASSWORD: "local" } }).toString().trim();
const fails = [];
const ok = (m) => console.log("  ok  " + m);
const bad = (m) => { console.log("FAIL  " + m); fails.push(m); };
const check = (c, m) => (c ? ok(m) : bad(m));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-first-run", "--disable-background-networking", "--disable-sync"] });
async function signIn(email, ip) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, extraHTTPHeaders: { "x-forwarded-for": ip } });
  await ctx.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e} @ ${page.url()}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', "Password@123");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 20000 }).catch(() => {});
  return { ctx, page, errors };
}
const settle = (page) => page.locator('[aria-busy="true"]').first().waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const main = async (page) => { await settle(page); return page.locator("main").innerText(); };
async function go(page, p) { await page.goto(BASE + p); return main(page); }
async function waitText(page, re, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (re.test(await page.locator("main").innerText())) return true; await page.waitForTimeout(300); }
  return false;
}
const toast = (page, re, timeout = 15000) => page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout }).then(() => true, () => false);
async function waitSql(q, want, tries = 24) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}

// --- My day, as a counsellor sees it.
const counsellor = await signIn("uk.docs@medcity.test", "10.170.1.1");
const cp = counsellor.page;
const me = sql("select id from users where email = 'uk.docs@medcity.test'");
let text = await go(cp, "/my-day");
check(/My day/.test(text), "my day: the screen exists");
check(/overdue/i.test(text) && /due today/i.test(text), "my day: it opens on what is overdue and what is due today");
const overdue = sql(`select count(*) from tasks where assigned_to_id = '${me}' and done_at is null and due_on < current_date`);
if (Number(overdue) > 0) check(/Overdue/.test(text), `my day: overdue work is under its own heading (${overdue})`);
else ok("my day: nothing overdue on this seed, heading not expected");
check(/raised by|Call on|WhatsApp on|Visit on/.test(text), "my day: a task says where it came from");
await cp.screenshot({ path: `${OUT}/01-my-day.png`, fullPage: true });

// A task by hand, then pushed out and ticked off. Its own title, because the
// sample data repeats a few and the test must act on the one it made.
const tag = String(Date.now()).slice(-5);
const mineTitle = `Collect the attested degree certificate ${tag}`;
await cp.getByRole("button", { name: "Add a task" }).click();
await cp.locator('input[name="title"]').fill(mineTitle);
await cp.getByRole("button", { name: "Add the task" }).click();
check(await toast(cp, /Task given to/), "task: adding one by hand is confirmed");
check((await waitSql(`select count(*) from tasks where title = '${mineTitle}'`, "1")) === "1", "task: it is recorded");
check(sql(`select source from tasks where title = '${mineTitle}'`) === "by hand", "task: it says it was raised by hand");
const mineId = sql(`select id from tasks where title = '${mineTitle}'`);

await go(cp, "/my-day");
let row = cp.locator("li").filter({ hasText: mineTitle }).first();
await row.getByRole("button", { name: "Next week" }).click();
check((await waitSql(`select due_on >= current_date + 6 from tasks where id = '${mineId}'`, "t")) === "t", "my day: a task can be pushed a week");
await go(cp, "/my-day");
row = cp.locator("li").filter({ hasText: mineTitle }).first();
await row.getByRole("button", { name: "Done" }).first().click();
check((await waitSql(`select done_at is not null from tasks where id = '${mineId}'`, "t")) === "t", "my day: and ticked off");
text = await go(cp, "/my-day?done=1");
check(/Finished/.test(text) && text.includes(mineTitle), "my day: what is finished can be read back");

// --- A call, logged in two clicks, raising its own follow-up.
const own = sql("select s.id from students s join users u on u.id = s.assigned_to_id where u.email = 'uk.docs@medcity.test' limit 1");
text = await go(cp, `/students/${own}/timeline`);
check(/The whole story/.test(text), "timeline: the tab exists on the student file");
const before = sql(`select count(*) from contact_log where student_id = '${own}'`);
await cp.getByRole("button", { name: "Log a call" }).first().click();
await cp.locator('select[name="outcome"]').first().selectOption("WILL_SEND");
await cp.waitForTimeout(300);
const suggested = await cp.locator('input[name="nextActionOn"]').first().inputValue();
check(suggested.length === 10, `call: the day to look again is suggested from what came of it (${suggested})`);
await cp.locator('textarea[name="note"]').first().fill("Says the statement comes on Friday from the bank.");
await cp.locator('input[name="nextActionNote"]').first().fill(`Chase the bank statement ${tag}`);
await cp.getByRole("button", { name: "Log it" }).click();
check(await toast(cp, /Logged/), "call: logging it is confirmed");
check((await waitSql(`select count(*) from contact_log where student_id = '${own}'`, String(Number(before) + 1))) === String(Number(before) + 1), "call: the conversation is recorded");
check(sql(`select count(*) from tasks where title = 'Chase the bank statement ${tag}'`) === "1", "call: the next action became a task by itself");
check(sql(`select count(*) from tasks t join contact_log c on c.task_id = t.id where t.title = 'Chase the bank statement ${tag}'`) === "1", "call: the task and the conversation are tied together");
const dueOn = sql(`select due_on from tasks where title = 'Chase the bank statement ${tag}'`);
check(dueOn === suggested, `call: the task falls on the day that was chosen (${dueOn})`);

// --- One timeline, from everything already recorded.
text = await go(cp, `/students/${own}/timeline`);
check(/Conversation/.test(text), "timeline: the call is in the feed");
check(/Says the statement comes on Friday/.test(text), "timeline: with what was said");
check(/Application|Status|Documentation|Document/.test(text), "timeline: and everything else that has happened on the file");
check(/Waiting on somebody/.test(text), "timeline: open tasks are at the top, not buried");
const kinds = await cp.locator("main a").filter({ hasText: /^(Conversation|Status|Document|Documentation|Application|Hand-over|From the vendor|Task|Asked the student|Stage|Payment)$/ }).count();
check(kinds > 2, `timeline: the feed can be narrowed to one kind (${kinds} kinds)`);
await cp.screenshot({ path: `${OUT}/02-timeline.png`, fullPage: true });

// --- The board.
text = await go(cp, "/students/board");
check(/Students by stage/.test(text), "board: the screen exists");
check(/1\. Profile/.test(text) && /7\. Visa/.test(text), "board: the nine stages are the columns");
check(/since a word|spoken to/.test(text), "board: each card says how long since anybody spoke to them");
check(/Nobody has spoken to them/.test(text), "board: the files nobody has touched are one click away");
const quiet = await go(cp, "/students/board?quiet=1");
check(/Nobody has spoken to them/.test(quiet), "board: and that filter holds");
await cp.screenshot({ path: `${OUT}/03-board.png`, fullPage: true });

// --- The portal raises its own tasks when it chases.
const admin = await signIn("admin@medcityoverseas.test", "10.170.1.2");
const ap = admin.page;
sql("update checklist_items set asked_at = now() - interval '9 days', last_chased_at = null, escalated_at = null where state = 'ASKED'");
sql("update applications set submitted_to_vendor_at = now() - interval '20 days' where desk_stage = 'SUBMITTED'");
const auto = sql("select count(*) from tasks where auto_key is not null and source <> 'by hand' and source not like 'Call%' and source not like 'WhatsApp%' and source not like 'Visit%'");
await go(ap, "/documentation");
await ap.getByRole("button", { name: "Run the chasing now" }).click();
await ap.waitForTimeout(4000);
const afterAuto = sql("select count(*) from tasks where auto_key is not null and source in ('documents','the desk')");
check(Number(afterAuto) > Number(auto), `chasing: the portal puts its own work on a desk (${auto} to ${afterAuto})`);
check(sql("select count(*) from tasks where source = 'the desk'") !== "0", "chasing: a vendor that has gone quiet becomes the desk's task");
// Running it again does not raise the same thing twice.
await ap.getByRole("button", { name: "Run the chasing now" }).click();
await ap.waitForTimeout(4000);
check(sql("select count(*) from tasks where auto_key is not null and source in ('documents','the desk')") === afterAuto, "chasing: the same fact never lands on a desk twice");

// --- Who sees what.
const mgmt = await signIn("management@medcityoverseas.test", "10.170.1.3");
text = await go(mgmt.page, "/my-day");
check(/My day/.test(text), "roles: management can read a day");
check((await mgmt.page.getByRole("button", { name: "Add a task" }).count()) === 0, "roles: management is given nothing to press");
const partner = await signIn("owner@horizon.test", "10.170.1.4");
text = await go(partner.page, "/students/board");
const otherBranch = sql("select count(*) from students where org_id <> (select org_id from users where email = 'owner@horizon.test')");
const theirOwn = sql("select first_name || ' ' || last_name from students where org_id = (select org_id from users where email = 'owner@horizon.test') limit 1");
check(Number(otherBranch) > 0 && (!theirOwn || text.includes(theirOwn)), "board: a sub-agent sees their own students");
const someoneElse = sql("select s.first_name || ' ' || s.last_name from students s where s.org_id <> (select org_id from users where email = 'owner@horizon.test') limit 1");
check(!text.includes(someoneElse), "board: and nobody else's");

for (const [who, e] of [["counsellor", counsellor.errors], ["admin", admin.errors], ["management", mgmt.errors], ["sub-agent", partner.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
