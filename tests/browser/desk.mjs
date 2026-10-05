// The hand-over: a counsellor builds the file and hands it to the Overseas desk,
// the desk picks the vendor, lodges it in their portal and types in whatever they
// hear back. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-desk";
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

// --- A counsellor creating an application is never asked for a vendor.
const counsellor = await signIn("uk.docs@medcity.test", "10.160.1.1");
const cp = counsellor.page;
const own = sql("select s.id from students s join users u on u.id = s.assigned_to_id where u.email = 'uk.docs@medcity.test' limit 1");
let text = await go(cp, `/students/${own}/applications?tab=apply`);
check(/Overseas desk/.test(text) && /desk/i.test(text), "apply: the screen says the desk picks the vendor");
check((await cp.locator('select[name="routeId"]').count()) === 0, "apply: there is no vendor choice on the form at all");

// --- Handing over, gated on the documents.
const prep = sql("select id from applications where desk_stage = 'PREPARING' order by created_at limit 1");
const prepStudent = sql(`select student_id from applications where id = '${prep}'`);
const prepOrg = sql(`select org_id from students where id = '${prepStudent}'`);
const staffForOrg = sql(`select email from users where org_id = '${prepOrg}' and role in ('PARTNER','COUNSELLOR') limit 1`);
const branch = staffForOrg === "uk.docs@medcity.test" ? counsellor : await signIn(staffForOrg, "10.160.1.2");
const bp = branch.page;
text = await go(bp, `/students/${prepStudent}/applications?app=${prep}`);
check(/Where it is/.test(text), "application: the card says where the file is between the branch and the desk");
check(/With the branch/.test(text), "application: a file nobody has handed over is with the branch");
const refused = /Still needed before this can go/.test(text);
if (refused) {
  ok("handover: the branch is told what is missing instead of being given a button");
  sql(`update checklist_items set state = 'ACCEPTED', decided_at = now() where student_id = '${prepStudent}' and required and state <> 'ACCEPTED'`);
  text = await go(bp, `/students/${prepStudent}/applications?app=${prep}`);
}
check(/Hand it to the Overseas desk/.test(text), "handover: with the paper in, the button appears");
await bp.getByRole("button", { name: "Hand it to the Overseas desk" }).click();
await bp.locator('textarea[name="note"]').fill("Student is pushing for September. Passport renewal is in hand.");
await bp.getByRole("button", { name: "Hand it over" }).click();
check((await toast(bp, /Handed to the Overseas desk/)) || (await waitText(bp, /Waiting for the desk/)), "handover: the branch is told it has gone");
check((await waitSql(`select desk_stage from applications where id = '${prep}'`, "READY")) === "READY", "handover: the file is waiting for the desk");
check(sql(`select handover_note from applications where id = '${prep}'`).includes("September"), "handover: what the branch said is kept");
await bp.screenshot({ path: `${OUT}/01-handed-over.png`, fullPage: true });

// --- The desk's queue.
const docs = await signIn("documentation@medcityoverseas.test", "10.160.1.3");
const dp = docs.page;
// The desk works the files given to it. This suite is about the hand-over and
// the road, not about which files land on whose desk, so give it all of them.
sql(`update applications set officer_id = (select id from users where email = 'documentation@medcityoverseas.test')`);
text = await go(dp, "/admin/desk");
check(/The Overseas desk/.test(text), "desk: the queue exists");
check(/Waiting for the desk/.test(text) && /Lodged with the vendor/.test(text), "desk: the steps are the tabs across the top");
check(/Vendor gone quiet/.test(text), "desk: files the vendor has not answered are findable");
check(text.includes(sql(`select first_name || ' ' || last_name from students where id = '${prepStudent}'`)), "desk: the file just handed over is in the queue");
check(/worked out from the status|Not recorded|hour|day/.test(text), "desk: how long each has waited is on the row");
await dp.screenshot({ path: `${OUT}/02-desk-queue.png`, fullPage: true });

// What each vendor actually takes, from their own dates.
check(/What each vendor actually takes/.test(text), "desk: the queue carries the real turnaround per vendor");
check(/usually takes/i.test(text), "desk: it says what each usually takes");

// --- The desk picks the road.
text = await go(dp, `/students/${prepStudent}/applications?app=${prep}`);
check(/The Overseas desk/.test(text), "desk: the desk's own panel is on the application");
check(/Which road it goes down/.test(text), "desk: the first step is choosing the road");
const routeCount = await dp.locator('input[name="routeId"]').count();
if (routeCount > 0) {
  check(/Commission/.test(text) && /offer in/.test(text), "desk: each road shows what it pays and how fast it answers");
  await dp.locator('input[name="routeId"]').first().check();
  await dp.getByRole("button", { name: "Choose this route" }).click();
  check(await toast(dp, /goes through/), "desk: the choice is confirmed");
  check((await waitSql(`select desk_stage from applications where id = '${prep}'`, "CHOSEN")) === "CHOSEN", "desk: the route is recorded and the file moves on");
  check(sql(`select count(*) from applications where id = '${prep}' and route_chosen_by_id = (select id from users where email = 'documentation@medcityoverseas.test')`) === "1", "desk: who chose it is recorded");

  // --- Lodged in their portal.
  text = await go(dp, `/students/${prepStudent}/applications?app=${prep}`);
  check(/Lodged in their portal/.test(text), "desk: the next step is recording that it was lodged");
  await dp.locator('input[name="vendorReference"]').first().fill("KC/2026/99881");
  await dp.getByRole("button", { name: "It is lodged" }).click();
  check((await toast(dp, /Lodged on|status did not move/)) || (await waitText(dp, /Lodged with the vendor/)), "desk: lodging it is confirmed");
  check((await waitSql(`select desk_stage from applications where id = '${prep}'`, "SUBMITTED")) === "SUBMITTED", "desk: the file is with the vendor");
  check(sql(`select vendor_reference from applications where id = '${prep}'`) === "KC/2026/99881", "desk: their own reference is kept");
  check(sql(`select submitted_to_vendor_at is not null from applications where id = '${prep}'`) === "t", "desk: the day it was lodged is where turnaround starts counting");

  // --- What the vendor came back with.
  text = await go(dp, `/students/${prepStudent}/applications?app=${prep}`);
  check(/What they came back with/.test(text), "desk: an update can be typed in");
  await dp.locator('select[name="outcome"]').first().selectOption("DOCUMENTS_ASKED");
  await dp.waitForTimeout(300);
  await dp.locator('textarea[name="note"]').first().fill("They want the degree certificate attested before they will assess it.");
  await dp.getByRole("button", { name: "Record it" }).click();
  check(await toast(dp, /recorded/), "desk: the update is confirmed");
  check((await waitSql(`select count(*) from vendor_updates where application_id = '${prep}'`, "1")) === "1", "desk: the update is kept");
  check(sql(`select happened_on is not null from vendor_updates where application_id = '${prep}'`) === "t", "desk: the vendor's own date is recorded, not just ours");
  const movedTo = sql(`select coalesce((select label from status_definitions where id = (select to_status_id from vendor_updates where application_id = '${prep}' limit 1)), '')`);
  check(movedTo.length > 0, `desk: the outcome moved the status (${movedTo || "nothing"})`);

  text = await go(dp, `/students/${prepStudent}/applications?app=${prep}`);
  check(/What the vendor has told us/.test(text), "application: everything the vendor has said is on the file");
  check(/attested/.test(text), "application: in their own words");
  check(/the day they acted, not the day it was recorded/.test(text), "application: it says which date is which");

  // The branch hears about it.
  const told = sql(`select count(*) from notifications where href like '%${prep}%' and title like '%More documents asked for%'`);
  check(told !== "0", "desk: the branch is told when the vendor asks for something");
} else {
  bad("desk: no route is recorded for that course, so the choice could not be tested");
}

// --- Sending it back to the branch.
const ready = sql("select id from applications where desk_stage = 'READY' order by handed_over_at limit 1");
if (ready) {
  const readyStudent = sql(`select student_id from applications where id = '${ready}'`);
  await go(dp, `/students/${readyStudent}/applications?app=${ready}`);
  await dp.getByRole("button", { name: "Send it back to the branch" }).click();
  await dp.getByRole("button", { name: "Send it back" }).last().click();
  check(await waitText(dp, /Say what the branch has to fix/), "return: a reason is required");
  await dp.locator('textarea[name="reason"]').first().fill("The transcript is the provisional one. We need the consolidated sheet.");
  await dp.getByRole("button", { name: "Send it back" }).last().click();
  check(await toast(dp, /Sent back/), "return: it goes back with the reason");
  check((await waitSql(`select desk_stage from applications where id = '${ready}'`, "RETURNED")) === "RETURNED", "return: the file is back with the branch");
  // A branch head sees their whole branch, so they are who reads a file back
  // whoever at the branch built it. A counsellor would need it to be their own.
  const readyOrgStaff = sql(`select u.email from users u join students s on s.org_id = u.org_id where s.id = '${readyStudent}' and u.role = 'PARTNER' limit 1`)
    || sql(`select u.email from users u join students s on s.org_id = u.org_id where s.id = '${readyStudent}' and u.id = s.assigned_to_id limit 1`);
  const back = readyOrgStaff === staffForOrg ? bp : (await signIn(readyOrgStaff, "10.160.1.5")).page;
  text = await go(back, `/students/${readyStudent}/applications?app=${ready}`);
  check(/The Overseas desk sent this back/.test(text) && /consolidated sheet/.test(text), "return: the counsellor reads the reason on the file");
  check(/Hand it to the Overseas desk|Still needed before this can go/.test(text), "return: they can hand it over again once it is fixed");
} else {
  bad("return: nothing was waiting for the desk to send back");
}

// --- A counsellor cannot do the desk's work.
text = await go(cp, "/admin/desk");
await cp.waitForURL((u) => !String(u).includes("/admin/desk"), { timeout: 8000 }).catch(() => {});
check(!cp.url().includes("/admin/desk"), "roles: a counsellor is turned away from the desk's queue");
const anySubmitted = sql("select id from applications where desk_stage = 'SUBMITTED' limit 1");
const submittedStudent = sql(`select student_id from applications where id = '${anySubmitted}'`);
// Their own student, since a counsellor reads the files that are theirs.
const submittedOrgStaff = sql(`select u.email from users u join students s on s.org_id = u.org_id where s.id = '${submittedStudent}' and u.role = 'COUNSELLOR' limit 1`);
if (submittedOrgStaff) sql(`update students set assigned_to_id = (select id from users where email = '${submittedOrgStaff}') where id = '${submittedStudent}'`);
if (submittedOrgStaff) {
  const theirs = submittedOrgStaff === "uk.docs@medcity.test" ? cp : (await signIn(submittedOrgStaff, "10.160.1.6")).page;
  text = await go(theirs, `/students/${submittedStudent}/applications?app=${anySubmitted}`);
  check((await theirs.locator('select[name="outcome"]').count()) === 0, "roles: a counsellor cannot type in a vendor update");
  check((await theirs.locator('input[name="routeId"]').count()) === 0, "roles: a counsellor cannot choose the road");
  check(/What the vendor has told us|Applied through/.test(text), "roles: but they can read what the vendor said and which road it went down");
} else {
  ok("roles: no counsellor shares a branch with a lodged application, nothing to check");
}

for (const [who, e] of [["counsellor", counsellor.errors], ["branch", branch.errors], ["desk", docs.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
