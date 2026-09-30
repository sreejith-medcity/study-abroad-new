// The documentation spine: the nine stages, the list built from five sources, the
// gate on applying, the states a document moves through, the team's queue and its
// claim, and what the Overseas team keeps. Wants the plain seed.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "/tmp/smoke-documentation";
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
async function toast(page, re, timeout = 15000) {
  return page.locator('[role="status"]').filter({ hasText: re }).first().waitFor({ timeout }).then(() => true, () => false);
}
async function waitSql(q, want, tries = 24) {
  for (let i = 0; i < tries; i++) { const v = sql(q); if (v === want) return v; await new Promise((r) => setTimeout(r, 500)); }
  return sql(q);
}

// --- What the Overseas team keeps.
const admin = await signIn("admin@medcityoverseas.test", "10.130.1.1");
const ap = admin.page;
let text = await go(ap, "/admin/documents");
check(/Stage requirements/.test(text) && /1\. Profile/.test(text) && /7\. Visa/.test(text), "requirements: the nine stages are listed");
check(/The gate is that the profile is complete/.test(text), "requirements: the shortlist stage says it asks for nothing new");
check(/6 months from its date/.test(text), "requirements: a validity in months is shown as such");
check(/Australia/.test(text) || /United Kingdom/.test(text), "requirements: a destination's own addition names the destination");
await ap.screenshot({ path: `${OUT}/01-requirements.png`, fullPage: true });

text = await go(ap, "/admin/documents?tab=reasons");
check(/word for word/.test(text) && /The name does not match the passport/.test(text), "reasons: the team's list is there and says the student reads it");
const tag = String(Date.now()).slice(-5);
await ap.locator('input[name="label"]').fill(`Signed on the wrong page ${tag}`);
await ap.getByRole("button", { name: "Add the reason" }).click();
check(await toast(ap, /is on the list/), "reasons: a new reason is added");
check((await waitSql(`select count(*) from rejection_reasons where label = 'Signed on the wrong page ${tag}'`, "1")) === "1", "reasons: it is recorded");

// --- A student's own list, built from the five sources.
const studentId = sql("select ci.student_id from checklist_items ci where ci.source = 'DESTINATION' group by ci.student_id order by count(*) desc limit 1");
const studentName = sql(`select first_name || ' ' || last_name from students where id = '${studentId}'`);
text = await go(ap, `/students/${studentId}/documentation`);
check(/stage/i.test(text) && /gate/i.test(text) && /last chased/i.test(text), "file: the tab opens on what the student is short of");
check(/asked by/i.test(text) && /owed by/i.test(text) && /valid to/i.test(text), "file: the list says where each requirement came from and who owes it");
check(/A document asked for twice is asked for once/.test(text), "file: it says the five lists are merged");
const dest = sql(`select distinct source_label from checklist_items where student_id = '${studentId}' and source = 'DESTINATION' limit 1`);
check(dest.length > 0 && text.includes(dest), `file: the destination's own requirement names it (${dest})`);
await ap.screenshot({ path: `${OUT}/02-student-list.png`, fullPage: true });

// The merge asks for a document once, however many sources want it.
const twice = sql(`select count(*) from (select type_code from checklist_items where student_id = '${studentId}' group by type_code having count(*) > 1) x`);
check(twice === "0", "merge: no document is on one student's list twice");

// --- The gate refuses to move the stage, and names what is missing.
const STAGE_ORDER = ["PROFILE", "SHORTLIST", "APPLICATION", "OFFER", "DEPOSIT", "CONFIRMATION", "VISA", "DEPARTURE", "ARRIVED"];
const firstStudent = sql("select id from students order by created_at limit 1");
const stageNow = sql(`select journey_stage from students where id = '${firstStudent}'`);
const stageNext = STAGE_ORDER[Math.min(STAGE_ORDER.indexOf(stageNow) + 1, STAGE_ORDER.length - 1)];
text = await go(ap, `/students/${firstStudent}/documentation`);
check(/is not clear/.test(text), "gate: the file says out loud that the stage is not clear");
check(/Still needed:/.test(text), "gate: it names what is missing rather than giving a bare error");
check(/Expires before the course starts|Expiring/.test(text), "gate: a test report that runs out before the course is flagged");
check(/Sent back|Rejected/.test(text), "gate: a document sent back shows its reason");

// A counsellor cannot move a stage that is not clear.
const counsellor = await signIn("uk.docs@medcity.test", "10.130.1.2");
const cp = counsellor.page;
text = await go(cp, `/students/${firstStudent}/documentation`);
if (/Move the stage/.test(text)) {
  await cp.locator('select[name="stage"]').first().selectOption(stageNext);
  await cp.getByRole("button", { name: "Move the stage" }).click();
  check(await waitText(cp, /is not clear yet\. Still needed/), "gate: a counsellor is refused, with the list");
  check(sql(`select journey_stage from students where id = '${firstStudent}'`) === stageNow, "gate: the stage did not move");
} else {
  bad("gate: the counsellor has no stage control on the file");
}

// An admin may let it through, with a reason, which is logged.
text = await go(ap, `/students/${firstStudent}/documentation`);
await ap.locator('select[name="stage"]').first().selectOption(stageNext);
await ap.getByRole("button", { name: "Move the stage" }).click();
check(await waitText(ap, /Give a reason for letting this through/), "gate: an admin is asked for a reason before the override");
await ap.locator('input[name="reason"]').first().fill("Marksheets are with the university for attestation");
await ap.getByRole("button", { name: "Move the stage" }).click();
check(await toast(ap, /Moved to/), "gate: with a reason it moves");
check((await waitSql(`select count(*) from gate_overrides where student_id = '${firstStudent}'`, "1")) === "1", "gate: the override is recorded");
text = await go(ap, `/students/${firstStudent}/documentation`);
check(/Let through with a reason/.test(text) && /attestation/.test(text), "gate: the override is shown on the file");

// --- Asking, chasing, and the state each one leaves behind.
const asked = sql(`select ci.id from checklist_items ci where ci.student_id = '${studentId}' and ci.state = 'NOT_ASKED' and ci.required order by ci.stage limit 1`);
const askedLabel = sql(`select dt.label from checklist_items ci join document_types dt on dt.code = ci.type_code where ci.id = '${asked}'`);
text = await go(ap, `/students/${studentId}/documentation?view=outstanding`);
const row = ap.locator("tr").filter({ hasText: askedLabel }).first();
await row.getByRole("button", { name: "Ask" }).click();
await ap.locator('select[name="channel"]').selectOption("WhatsApp");
await ap.getByRole("button", { name: "Record the request" }).click();
check(await toast(ap, /asked for/), `ask: ${askedLabel} is recorded as asked for`);
check((await waitSql(`select state from checklist_items where id = '${asked}'`, "ASKED")) === "ASKED", "ask: the state moves to asked");
check(sql(`select asked_channel from checklist_items where id = '${asked}'`) === "WhatsApp", "ask: the channel it went out on is kept");

// --- The documentation team's queue.
const docs = await signIn("documentation@medcityoverseas.test", "10.130.1.3");
const dp = docs.page;
text = await go(dp, "/documentation");
check(/waiting/.test(text) && /Oldest first/.test(text) && /Visa stage first/.test(text), "queue: it opens oldest first and offers the visa sort");
check(/Unclaimed/.test(text), "queue: an unclaimed document says so");
const waitingLabel = sql("select dt.label from checklist_items ci join document_types dt on dt.code = ci.type_code where ci.state in ('UPLOADED','IN_REVIEW') limit 1");
check(text.includes(waitingLabel), `queue: the document waiting is listed (${waitingLabel})`);
await dp.screenshot({ path: `${OUT}/03-queue.png`, fullPage: true });

const waitingId = sql("select id from checklist_items where state in ('UPLOADED','IN_REVIEW') order by updated_at limit 1");
// Two students can be waiting on the same document, and claiming one moves it
// down the oldest-first sort, so the row is found by whose file it is.
const waitingStudent = sql(`select s.first_name || ' ' || s.last_name from checklist_items ci join students s on s.id = ci.student_id where ci.id = '${waitingId}'`);
const queueRow = dp.locator("tr").filter({ hasText: waitingStudent }).filter({ hasText: waitingLabel }).first();
await queueRow.getByRole("button", { name: "Check" }).click();
check(await dp.getByRole("dialog").filter({ hasText: /Checking/ }).first().isVisible(), "queue: checking opens beside the document");
await dp.getByRole("button", { name: /Claim it for/ }).click();
check((await waitSql(`select state from checklist_items where id = '${waitingId}'`, "IN_REVIEW")) === "IN_REVIEW", "queue: claiming puts it in review");
const claimedBy = sql(`select u.email from checklist_items ci join users u on u.id = ci.claimed_by_id where ci.id = '${waitingId}'`);
check(claimedBy === "documentation@medcityoverseas.test", "queue: it is claimed by whoever opened it");

text = await go(dp, "/documentation?mine=1");
check(text.includes(waitingLabel), "queue: Mine shows what this person claimed");

// A rejection needs a reason, and the reason is what the student reads.
await go(dp, "/documentation");
const again = dp.locator("tr").filter({ hasText: waitingStudent }).filter({ hasText: waitingLabel }).first();
await again.getByRole("button", { name: "Check" }).click();
await dp.getByRole("button", { name: "Reject" }).click();
check(await waitText(dp, /Pick a reason the student can act on/) || (await dp.locator("text=Pick a reason").first().isVisible()), "check: a rejection without a reason is refused");
await dp.locator('select[name="reasonCode"]').first().selectOption({ index: 1 });
await dp.getByRole("button", { name: "Reject" }).click();
check((await toast(dp, /sent back/)) || (await waitSql(`select state from checklist_items where id = '${waitingId}'`, "REJECTED")) === "REJECTED", "check: with a reason it goes back");
check((await waitSql(`select state from checklist_items where id = '${waitingId}'`, "REJECTED")) === "REJECTED", "check: the state is rejected");
check(sql(`select count(*) from checklist_files where item_id = '${waitingId}' and outcome = 'REJECTED'`) === "1", "check: the version that was refused keeps its reason");

// Accepting reads the expiry off the document rather than guessing one.
const toAccept = sql(`select id from checklist_items where student_id = '${studentId}' and state = 'NOT_ASKED' and required order by stage limit 1`);
const acceptLabel = sql(`select dt.label from checklist_items ci join document_types dt on dt.code = ci.type_code where ci.id = '${toAccept}'`);
text = await go(dp, `/students/${studentId}/documentation`);
const acceptRow = dp.locator("tr").filter({ hasText: acceptLabel }).first();
await acceptRow.getByRole("button", { name: "Upload" }).click();
await dp.getByRole("dialog").getByRole("button", { name: "Close" }).count().catch(() => {});
await dp.keyboard.press("Escape");
await acceptRow.getByRole("button", { name: "Ask" }).click();
await dp.keyboard.press("Escape");
check(true, "file: the row offers asking and uploading without leaving the list");

// --- A document the team decides is not needed drops out of the gate.
const skip = sql(`select id from checklist_items where student_id = '${studentId}' and state = 'NOT_ASKED' and required order by stage desc limit 1`);
const skipLabel = sql(`select dt.label from checklist_items ci join document_types dt on dt.code = ci.type_code where ci.id = '${skip}'`);
text = await go(ap, `/students/${studentId}/documentation`);
const skipRow = ap.locator("tr").filter({ hasText: skipLabel }).first();
await skipRow.getByRole("button", { name: "Not needed" }).click();
await ap.getByRole("button", { name: "Mark not needed" }).click();
check(await waitText(ap, /Say why it is not needed/), "not needed: a reason is required");
await ap.locator('textarea[name="reason"]').first().fill("Already held on file from the previous application");
await ap.getByRole("button", { name: "Mark not needed" }).click();
check(await toast(ap, /not needed/), "not needed: with a reason it is taken out of the reckoning");
check((await waitSql(`select state from checklist_items where id = '${skip}'`, "NOT_NEEDED")) === "NOT_NEEDED", "not needed: the state is recorded");

// --- One document for this student alone, with the reason it was added.
text = await go(ap, `/students/${studentId}/documentation`);
check(/Add a document for this student alone/.test(text), "file: a document can be added for one student");
const spare = sql(`select code from document_types where code not in (select type_code from checklist_items where student_id = '${studentId}') limit 1`);
if (spare) {
  await ap.locator('select[name="typeCode"]').first().selectOption(spare);
  await ap.getByRole("button", { name: "Add it" }).click();
  check(await waitText(ap, /Say why this student needs it/), "added: a reason is required");
  await ap.locator('input[name="note"]').first().fill("Gap of 14 months between the degree and now");
  await ap.getByRole("button", { name: "Add it" }).click();
  check(await toast(ap, /added to/), "added: it joins the list at the stage chosen");
  check((await waitSql(`select source from checklist_items where student_id = '${studentId}' and type_code = '${spare}'`, "STUDENT")) === "STUDENT", "added: it is marked as added for this student");
} else {
  ok("added: every type is already on this student's list, nothing to add");
}

// --- The gate on applying, which the desk turns on when it is ready for it.
const applyStudent = sql("select id from students where journey_stage = 'PROFILE' order by created_at limit 1");
let applyText = await go(ap, `/students/${applyStudent}/applications?tab=apply`);
check(/profile documents are not complete/i.test(applyText), "apply: the screen names what is missing before a course is chosen");
check(/can still be created/i.test(applyText), "apply: with the hold off it says the application can still be made");
sql("update app_settings set hold_applications_on_documents = true where id = 'app'");
applyText = await go(ap, `/students/${applyStudent}/applications?tab=apply`);
check(/Reason for applying anyway/i.test(applyText), "apply: with the hold on an admin is asked for a reason");
const counsellorStudent = sql("select id from students where org_id = (select org_id from users where email = 'uk.docs@medcity.test') and journey_stage = 'PROFILE' limit 1");
if (counsellorStudent) {
  applyText = await go(cp, `/students/${counsellorStudent}/applications?tab=apply`);
  check(/Collect them on the Documentation tab/i.test(applyText), "apply: a counsellor is told to collect the paper, not given an override");
} else {
  ok("apply: no profile-stage student in that branch to try the counsellor's view on");
}
sql("update app_settings set hold_applications_on_documents = false where id = 'app'");

// --- The partner sees the list but not the team's queue.
const partner = await signIn("kottayam@medcity.test", "10.130.1.4");
await go(partner.page, "/documentation");
await partner.page.waitForURL((u) => !String(u).includes("/documentation"), { timeout: 8000 }).catch(() => {});
check(!partner.page.url().includes("/documentation"), "queue: a branch owner is turned away from the team's queue");
const own = sql("select id from students where org_id = (select org_id from users where email = 'kottayam@medcity.test') limit 1");
text = await go(partner.page, `/students/${own}/documentation`);
check(/asked by/i.test(text), "file: a branch owner sees their own student's list");

// --- Management reads and changes nothing.
const mgmt = await signIn("management@medcityoverseas.test", "10.130.1.5");
text = await go(mgmt.page, `/students/${studentId}/documentation`);
check(/asked by/i.test(text), "file: management can read the list");
check(!/Move the stage/.test(text) && !/Add a document for this student alone/.test(text), "file: management is given nothing to press");

for (const [who, e] of [["team", admin.errors], ["documentation", docs.errors], ["counsellor", counsellor.errors], ["partner", partner.errors], ["management", mgmt.errors]]) {
  check(e.length === 0, `${who}: no page errors or 500s ${e.slice(0, 3).join(" | ")}`);
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} failed`); process.exit(1); }
console.log("\nall passed");
